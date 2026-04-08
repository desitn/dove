import fs from 'fs';
import { findWorkspacePath, loadConfig, saveConfig, isWindows, executeCommand } from './utils';

/**
 * Build command interface
 */
interface BuildCommand {
  name: string;
  command: string;
}

/**
 * Compile firmware
 * @param commandIdentifier - Build command name or index (optional)
 */
export async function compileFirmware(commandIdentifier: string | null = null): Promise<void> {
  try {
    console.log('Firmware Compilation Tool');
    console.log('='.repeat(50));
    
    const workspacePath = findWorkspacePath();
    if (!workspacePath) {
      throw new Error('Workspace not found, please run from project root');
    }
    
    console.log(`Workspace: ${workspacePath}`);
    
    const config = loadConfig();
    
    // Get build command to execute
    let buildCmd: BuildCommand | null = null;
    
    if (commandIdentifier) {
      // Try to find by name first
      buildCmd = findCommandByName(config.buildCommands, commandIdentifier);
      
        // If not found by name, try to parse as index
        if (!buildCmd) {
          const index = parseInt(commandIdentifier, 10);
          if (!isNaN(index) && index > 0 && config.buildCommands && index <= config.buildCommands.length) {
            buildCmd = config.buildCommands[index - 1];
          }
        }
      
      if (!buildCmd) {
        throw new Error(`Build command "${commandIdentifier}" not found`);
      }
    } else {
      // No identifier provided, use lastBuildCommand
      if (config.lastBuildCommand && config.buildCommands) {
        buildCmd = findCommandByName(config.buildCommands, config.lastBuildCommand);
      }
      
      // If lastBuildCommand not found, use first command
      if (!buildCmd && config.buildCommands && config.buildCommands.length > 0) {
        buildCmd = config.buildCommands[0];
      }
      
      if (!buildCmd) {
        throw new Error('No build commands configured, please add commands to firmware-cli.json');
      }
    }
    
    console.log(`Build command: [${buildCmd.name}] ${buildCmd.command}`);
    console.log('='.repeat(50));
    
    // Update lastBuildCommand
    config.lastBuildCommand = buildCmd.name;
    saveConfig(config);
    
    await executeBuild(workspacePath, buildCmd.command, config.buildGitBashPath);
    
    console.log('='.repeat(50));
    console.log('Compilation finished');
    console.log('> 1. Identify command line output');
    console.log('> 2. Check for compilation errors');
    console.log('> 3. Check if new firmware is generated');
    
  } catch (error) {
    const err = error as Error;
    console.error('Compilation failed:', err.message);
    process.exit(1);
  }
}

/**
 * Find command by name in buildCommands array
 */
function findCommandByName(commands: BuildCommand[] | undefined, name: string): BuildCommand | null {
  if (!commands || commands.length === 0) {
    return null;
  }
  
  const found = commands.find(cmd => cmd.name === name);
  return found || null;
}

/**
 * List all available build commands
 */
export async function listBuildCommands(): Promise<void> {
  const config = loadConfig();
  
  console.log('Available Build Commands');
  console.log('='.repeat(50));
  
  if (!config.buildCommands || config.buildCommands.length === 0) {
    console.log('No build commands configured.');
    console.log('\nAdd commands to firmware-cli.json:');
    console.log('  "buildCommands": [');
    console.log('    { "name": "build", "command": "build.bat" },');
    console.log('    { "name": "clean", "command": "clean.bat" }');
    console.log('  ]');
    return;
  }
  
  config.buildCommands.forEach((cmd, index) => {
    const marker = cmd.name === config.lastBuildCommand ? ' (default)' : '';
    console.log(`  ${index + 1}. [${cmd.name}] ${cmd.command}${marker}`);
  });
  
  console.log('\nUsage:');
  console.log('  firmware-cli build              # Run default command');
  console.log('  firmware-cli build -i  1        # Run by index');
  console.log('  firmware-cli build -n  "clean"  # Run by name');
}

/**
 * Execute build
 */
async function executeBuild(workspacePath: string, buildCommand: string, bashPath: string | undefined): Promise<void> {
  let taskCmd: string;
  let args: string[];
  
  // Check if the command is a bash script (.sh file)
  // Match .sh followed by space or end of string to handle cases like "build.sh -app"
  const isBash = /\.sh(\s|$)/i.test(buildCommand);
  
  if (isWindows()) {
    if (isBash) {
      if (!bashPath || !fs.existsSync(bashPath)) {
        throw new Error('Shell script requires Git Bash, please set buildGitBashPath in config file');
      }
      taskCmd = bashPath;
      args = ['-c', `./${buildCommand}`];
      console.log(`Using Git Bash: ${bashPath}`);
    } else {
      taskCmd = 'cmd';
      args = ['/c', `${buildCommand}`];
    }
  } else {
    taskCmd = '/bin/bash';
    args = ['-c', `${buildCommand}`];
  }
  
  console.log(`\nExecuting command: ${taskCmd} ${args.join(' ')}`);
  console.log('='.repeat(50));
  
  try {
    await executeCommand(taskCmd, args, {
      cwd: workspacePath,
      shell: true
    });
  } catch (error) {
    const err = error as Error;
    throw new Error(`Build command execution failed: ${err.message}`);
  }
}

/**
 * Add build command
 */
export async function addBuildCommand(name: string, command: string): Promise<void> {
  const config = loadConfig();
  
  if (!config.buildCommands) {
    config.buildCommands = [];
  }
  
  // Check if name already exists
  const existingIndex = config.buildCommands.findIndex(cmd => cmd.name === name);
  if (existingIndex >= 0) {
    // Update existing command
    config.buildCommands[existingIndex].command = command;
    console.log(`Updated build command: [${name}] ${command}`);
  } else {
    // Add new command
    config.buildCommands.push({ name, command });
    console.log(`Added build command: [${name}] ${command}`);
  }
  
  // If this is the first command, set it as default
  if (config.buildCommands.length === 1) {
    config.lastBuildCommand = name;
    console.log(`Set "${name}" as default command`);
  }
  
  saveConfig(config);
  console.log('Config saved to firmware-cli.json');
}

/**
 * Remove build command
 */
export async function removeBuildCommand(name: string): Promise<void> {
  const config = loadConfig();
  
  if (!config.buildCommands || config.buildCommands.length === 0) {
    console.log('No build commands to remove');
    return;
  }
  
  const index = config.buildCommands.findIndex(cmd => cmd.name === name);
  if (index < 0) {
    console.log(`Build command "${name}" not found`);
    return;
  }
  
  config.buildCommands.splice(index, 1);
  
  // If removed command was the default, clear lastBuildCommand
  if (config.lastBuildCommand === name) {
    config.lastBuildCommand = config.buildCommands.length > 0 ? config.buildCommands[0].name : undefined;
    if (config.lastBuildCommand) {
      console.log(`Default command changed to: ${config.lastBuildCommand}`);
    }
  }
  
  saveConfig(config);
  console.log(`Removed build command: ${name}`);
}

/**
 * Set default build command
 */
export async function setDefaultCommand(name: string): Promise<void> {
  const config = loadConfig();
  
  if (!config.buildCommands || config.buildCommands.length === 0) {
    throw new Error('No build commands configured');
  }
  
  const found = config.buildCommands.find(cmd => cmd.name === name);
  if (!found) {
    throw new Error(`Build command "${name}" not found`);
  }
  
  config.lastBuildCommand = name;
  saveConfig(config);
  console.log(`Set "${name}" as default build command`);
}

/**
 * Set config
 */
export async function setConfig(key: string, value: string): Promise<void> {
  const config = loadConfig();
  
  if (key === 'firmwarePath') {
    config.firmwarePath = value;
    console.log(`Set firmware path: ${value}`);
  } else if (key === 'buildGitBashPath') {
    config.buildGitBashPath = value;
    console.log(`Set Git Bash path: ${value}`);
  } else if (key === 'defaultComPort') {
    config.defaultComPort = value;
    console.log(`Set default COM port: ${value}`);
  } else {
    throw new Error(`Unknown config item: ${key}`);
  }
  
  saveConfig(config);
  console.log('Config saved to firmware-cli.json');
}

/**
 * Show config
 */
export async function showConfig(): Promise<void> {
  const config = loadConfig();
  
  console.log('Current Config');
  console.log('='.repeat(50));
  console.log(`Firmware path: ${config.firmwarePath || 'Not set'}`);
  console.log(`Git Bash: ${config.buildGitBashPath || 'Not set'}`);
  console.log(`Default COM port: ${config.defaultComPort || 'Not set'}`);
  console.log(`Last build command: ${config.lastBuildCommand || 'Not set'}`);
  
  if (config.buildCommands && config.buildCommands.length > 0) {
    console.log('\nBuild commands:');
    config.buildCommands.forEach((cmd, index) => {
      const marker = cmd.name === config.lastBuildCommand ? ' *' : '';
      console.log(`  ${index + 1}. [${cmd.name}] ${cmd.command}${marker}`);
    });
  }
  
  console.log('='.repeat(50));
}
