import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { findWorkspacePath, loadConfig, saveConfig, isWindows, getGlobalPaths } from './utils';

/**
 * Build command interface
 */
interface BuildCommand {
  name: string;
  command: string;
  description?: string;
  isActive?: boolean;
}

/**
 * Compile firmware
 * @param commandIdentifier - Build command name or index (optional)
 */
export async function compileFirmware(commandIdentifier: string | null = null): Promise<void> {
  try {
    console.log('Dove Firmware Compilation Tool');
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
      // No identifier provided, use active command
      if (config.buildCommands) {
        // Find the active command
        buildCmd = config.buildCommands.find(cmd => cmd.isActive) || null;

        // If no active command found, use first command
        if (!buildCmd && config.buildCommands.length > 0) {
          buildCmd = config.buildCommands[0];
        }
      }

      if (!buildCmd) {
        throw new Error('No build commands configured, please add commands to dove.json');
      }
    }

    console.log(`Build command: [${buildCmd.name}] ${buildCmd.command}`);
    if (buildCmd.description) {
      console.log(`Description: ${buildCmd.description}`);
    }
    console.log('='.repeat(50));

    // Update active command
    if (!buildCmd.isActive && config.buildCommands) {
      config.buildCommands.forEach(cmd => {
        cmd.isActive = cmd.name === buildCmd!.name;
      });
      saveConfig(config);
    }
    
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
    console.log('\nAdd commands to dove.json:');
    console.log('  "buildCommands": [');
    console.log('    { "name": "build", "command": "build.bat", "description": "Production build", "isActive": true },');
    console.log('    { "name": "clean", "command": "clean.bat", "description": "Clean build artifacts" }');
    console.log('  ]');
    return;
  }

  config.buildCommands.forEach((cmd, index) => {
    const marker = cmd.isActive ? ' (active)' : '';
    const desc = cmd.description ? ` - ${cmd.description}` : '';
    console.log(`  ${index + 1}. [${cmd.name}] ${cmd.command}${desc}${marker}`);
  });

  console.log('\nUsage:');
  console.log('  dove build              # Run active command');
  console.log('  dove build --index 1    # Run by index');
  console.log('  dove build --name "clean" # Run by name');
}

/**
 * Execute build using spawn with inherit (subprocess mode)
 * PATH is NOT injected - use system environment directly
 */
async function executeBuild(workspacePath: string, buildCommand: string, bashPath: string | undefined): Promise<void> {
  // Load global config for Git Bash path (only used for .sh scripts)
  const globalPaths = getGlobalPaths();
  let gitBashPath = globalPaths?.gitBash || bashPath;

  // Normalize: if path ends with git-bash.exe, use bin/bash.exe instead (CLI version)
  if (gitBashPath && gitBashPath.toLowerCase().endsWith('git-bash.exe')) {
    const bashExe = path.join(path.dirname(gitBashPath), 'bin', 'bash.exe');
    if (fs.existsSync(bashExe)) {
      gitBashPath = bashExe;
      console.log(`Using CLI bash: ${gitBashPath}`);
    }
  }

  // Check script type
  const isBash = /\.sh(\s|$)/i.test(buildCommand);
  const isPowerShell = /\.ps1(\s|$)/i.test(buildCommand);

  // Build spawn arguments
  let spawnCmd: string;
  let spawnArgs: string[];

  if (isWindows()) {
    if (isBash) {
      if (!gitBashPath || !fs.existsSync(gitBashPath)) {
        throw new Error('Shell script requires Git Bash, please set paths.gitBash in global.json or buildGitBashPath in dove.json');
      }
      console.log(`Using Git Bash: ${gitBashPath}`);
      spawnCmd = gitBashPath;
      spawnArgs = ['-c', `./${buildCommand}`];
    } else if (isPowerShell) {
      console.log('Using PowerShell');
      spawnCmd = 'powershell.exe';
      spawnArgs = ['-ExecutionPolicy', 'Bypass', '-File', buildCommand];
    } else {
      // Batch/CMD command - run via cmd.exe
      spawnCmd = 'cmd.exe';
      spawnArgs = ['/c', buildCommand];
    }
  } else {
    // Linux/Mac
    spawnCmd = '/bin/bash';
    spawnArgs = ['-c', buildCommand];
  }

  console.log(`\nExecuting: ${spawnCmd} ${spawnArgs.join(' ')}`);
  console.log('='.repeat(50));

  // Use spawn with stdio: 'inherit' for real-time terminal output
  await new Promise<void>((resolve, reject) => {
    const child = spawn(spawnCmd, spawnArgs, {
      cwd: workspacePath,
      stdio: 'inherit',  // Direct terminal I/O
      shell: false
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Build failed with exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Build execution error: ${err.message}`));
    });
  });
}

/**
 * Execute build in new terminal window (reserved, not currently used)
 * This function opens a separate cmd window for build output.
 * Exported for potential future use.
 */
export async function executeBuildInNewWindow(workspacePath: string, buildCommand: string, bashPath: string | undefined): Promise<void> {
  // Load global config for Git Bash path (only used for .sh scripts)
  const globalPaths = getGlobalPaths();
  let gitBashPath = globalPaths?.gitBash || bashPath;

  // Normalize: if path ends with git-bash.exe, use bin/bash.exe instead (CLI version)
  if (gitBashPath && gitBashPath.toLowerCase().endsWith('git-bash.exe')) {
    const bashExe = path.join(path.dirname(gitBashPath), 'bin', 'bash.exe');
    if (fs.existsSync(bashExe)) {
      gitBashPath = bashExe;
    }
  }

  // Check script type
  const isBash = /\.sh(\s|$)/i.test(buildCommand);
  const isPowerShell = /\.ps1(\s|$)/i.test(buildCommand);

  // Build command to run
  let commandToRun: string;

  if (isWindows()) {
    if (isBash) {
      if (!gitBashPath || !fs.existsSync(gitBashPath)) {
        throw new Error('Shell script requires Git Bash');
      }
      commandToRun = `"${gitBashPath}" -c "./${buildCommand}"`;
    } else if (isPowerShell) {
      commandToRun = `powershell.exe -ExecutionPolicy Bypass -File "${buildCommand}"`;
    } else {
      commandToRun = buildCommand;
    }
  } else {
    commandToRun = `/bin/bash -c "${buildCommand}"`;
  }

  // Write temp batch file in workspace .dove directory
  const doveDir = path.join(workspacePath, '.dove');
  if (!fs.existsSync(doveDir)) {
    fs.mkdirSync(doveDir, { recursive: true });
  }
  const tempBat = path.join(doveDir, 'build_temp.bat');

  // Batch content - NO PATH injection
  const batContent = `@echo off
cd /d "${workspacePath}"
${commandToRun}
echo.
echo Build completed. You can close this window.
`;
  fs.writeFileSync(tempBat, batContent, 'utf8');

  // Execute in new window using start command
  const winTempBat = tempBat.replace(/\//g, '\\');
  spawn('cmd.exe', ['/c', `start "Dove Build" cmd.exe /k "${winTempBat}"`], {
    detached: true,
    stdio: 'ignore',
    shell: true
  });

  // Cleanup after 1 minute
  setTimeout(() => {
    try { fs.unlinkSync(tempBat); } catch { /* ignore */ }
  }, 60000);

  console.log('Build started in new terminal window.');
}

/**
 * Add build command
 */
export async function addBuildCommand(name: string, command: string, description: string = ''): Promise<void> {
  const config = loadConfig();

  if (!config.buildCommands) {
    config.buildCommands = [];
  }

  // Check if name already exists
  const existingIndex = config.buildCommands.findIndex(cmd => cmd.name === name);
  if (existingIndex >= 0) {
    // Update existing command
    config.buildCommands[existingIndex].command = command;
    config.buildCommands[existingIndex].description = description;
    console.log(`Updated build command: [${name}] ${command}`);
    if (description) {
      console.log(`Description: ${description}`);
    }
  } else {
    // Add new command
    const isActive = config.buildCommands.length === 0; // First command is active by default
    config.buildCommands.push({ name, command, description, isActive });
    console.log(`Added build command: [${name}] ${command}`);
    if (description) {
      console.log(`Description: ${description}`);
    }
  }

  // If this is the first command, set it as active
  if (config.buildCommands.length === 1) {
    console.log(`Set "${name}" as active command`);
  }

  saveConfig(config);
  console.log('Config saved to dove.json');
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

  const wasActive = config.buildCommands[index].isActive;
  config.buildCommands.splice(index, 1);

  // If removed command was active, set first command as active
  if (wasActive && config.buildCommands.length > 0) {
    config.buildCommands[0].isActive = true;
    console.log(`Active command changed to: ${config.buildCommands[0].name}`);
  }

  saveConfig(config);
  console.log(`Removed build command: ${name}`);
}

/**
 * Set active build command
 */
export async function setActiveCommand(name: string): Promise<void> {
  const config = loadConfig();

  if (!config.buildCommands || config.buildCommands.length === 0) {
    throw new Error('No build commands configured');
  }

  const found = config.buildCommands.find(cmd => cmd.name === name);
  if (!found) {
    throw new Error(`Build command "${name}" not found`);
  }

  // Set all commands inactive, then set the specified one active
  config.buildCommands.forEach(cmd => {
    cmd.isActive = cmd.name === name;
  });

  saveConfig(config);
  console.log(`Set "${name}" as active build command`);
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
  } else {
    throw new Error(`Unknown config item: ${key}. Valid items: firmwarePath, buildGitBashPath`);
  }
  
  saveConfig(config);
  console.log('Config saved to dove.json');
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

  if (config.comPorts && config.comPorts.length > 0) {
    console.log('COM Ports:');
    config.comPorts.forEach(p => {
      console.log(`  ${p.port}: [${p.tag}]`);
    });
  }

  if (config.buildCommands && config.buildCommands.length > 0) {
    const activeCmd = config.buildCommands.find(cmd => cmd.isActive);
    console.log(`\nActive command: ${activeCmd?.name || 'None'}`);

    console.log('\nBuild commands:');
    config.buildCommands.forEach((cmd, index) => {
      const marker = cmd.isActive ? ' *' : '';
      const desc = cmd.description ? ` (${cmd.description})` : '';
      console.log(`  ${index + 1}. [${cmd.name}] ${cmd.command}${desc}${marker}`);
    });
  }

  console.log('='.repeat(50));
}
