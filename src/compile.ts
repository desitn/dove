import fs from 'fs';
import { findWorkspacePath, loadConfig, saveConfig, isWindows, executeCommand } from './utils';

/**
 * Compile firmware
 * @param buildCommand - Build command (optional)
 */
export async function compileFirmware(buildCommand: string | null = null): Promise<void> {
  try {
    console.log('Firmware Compilation Tool');
    console.log('='.repeat(50));
    
    const workspacePath = findWorkspacePath();
    if (!workspacePath) {
      throw new Error('Workspace not found, please run from project root');
    }
    
    console.log(`Workspace: ${workspacePath}`);
    
    let command = buildCommand;
    if (!command) {
      console.log('Auto searching build command...');
      command = await findBuildCommand(workspacePath);
      if (!command) {
        throw new Error('Build command not found, please specify or configure firmware-cli.json');
      }
    }
    
    console.log(`Build command: ${command}`);
    console.log('='.repeat(50));
    
    await executeBuild(workspacePath, command);
    
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
 * Find build command
 */
async function findBuildCommand(workspacePath: string): Promise<string | null> {
  const config = loadConfig();
  if (config.buildCommand) {
    return config.buildCommand;
  }
  
  const batFiles = fs.readdirSync(workspacePath).filter(file => 
    file.toLowerCase().startsWith('build') && 
    file.toLowerCase().includes('optfile') &&
    file.toLowerCase().endsWith('.bat')
  );
  
  if (batFiles.length > 0) {
    console.log(`Found batch file: ${batFiles[0]}`);
    return batFiles[0];
  }
  
  const shFiles = fs.readdirSync(workspacePath).filter(file => 
    file.toLowerCase().startsWith('build') && 
    file.toLowerCase().includes('optfile') &&
    file.toLowerCase().endsWith('.sh')
  );
  
  if (shFiles.length > 0) {
    console.log(`Found shell script: ${shFiles[0]}`);
    return shFiles[0];
  }
  
  return null;
}

/**
 * Execute build
 */
async function executeBuild(workspacePath: string, buildCommand: string): Promise<void> {
  const config = loadConfig();
  const bashPath = config.buildGitBashPath;
  
  let taskCmd: string;
  let args: string[];
  const isBash = buildCommand.toLowerCase().endsWith('.sh');
  
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
      args = ['/c', buildCommand];
    }
  } else {
    taskCmd = '/bin/bash';
    args = ['-c', buildCommand];
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
 * Set config
 */
export async function setConfig(key: string, value: string): Promise<void> {
  const config = loadConfig();
  
  if (key === 'firmwarePath') {
    config.firmwarePath = value;
    console.log(`Set firmware path: ${value}`);
  } else if (key === 'buildCommand') {
    config.buildCommand = value;
    console.log(`Set build command: ${value}`);
  } else if (key === 'buildGitBashPath') {
    config.buildGitBashPath = value;
    console.log(`Set Git Bash path: ${value}`);
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
  console.log(`Build command: ${config.buildCommand || 'Not set'}`);
  console.log(`Git Bash: ${config.buildGitBashPath || 'Not set'}`);
  console.log('='.repeat(50));
  console.log('\nSet config:');
  console.log('  firmware-cli config set firmwarePath <path>');
  console.log('  firmware-cli config set buildCommand <command>');
  console.log('  firmware-cli config set buildGitBashPath <path>');
  console.log('> Not set: use default value (tool auto-handle)');
}