import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import readline from 'readline';
import iconvLite from 'iconv-lite';
import type {
  PlatformConfig,
  ProgressPatterns
} from './types';
import {
  getToolPath,
  buildToolArgs,
  getGlobalSettings,
  loadToolsConfig,
  isWindows,
  determineFirmwareType,
  killProcessTree,
  executeCommand
} from './utils';
import { enterDownloadMode, findDownloadPort } from './serial';

interface FlashOptions {
  skipDlMode?: boolean;
}

interface RefObject {
  value: boolean;
}

/**
 * Flash firmware
 * @param firmwarePath - Firmware path (optional, will auto-find if not provided)
 * @param options - Options
 * @param options.skipDlMode - Whether to skip auto entering download mode
 */
export async function flashFirmware(firmwarePath: string | null = null, options: FlashOptions = {}): Promise<void> {
  try {
    console.log('Firmware Flash Tool');
    console.log('='.repeat(50));
    
    let filePath = firmwarePath;
    if (!filePath) {
      console.log('Auto searching for firmware...');
      filePath = await findFirmwarePath();
      if (!filePath) {
        throw new Error('Firmware file not found, please specify firmware path or configure firmware-cli.json');
      }
    }
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`Firmware file does not exist: ${filePath}`);
    }
    
    console.log(`Firmware path: ${filePath}`);
    
    console.log('Analyzing firmware type...');
    const firmwareInfo = determineFirmwareType(filePath);
    console.log(`Firmware type: ${firmwareInfo.type.toUpperCase()}`);
    
    const config = loadToolsConfig();
    let platformKey: string | null = null;
    let platformConfig: PlatformConfig | null = null;
    
    for (const [key, platform] of Object.entries(config.platforms || {})) {
      if (platform.type === firmwareInfo.type) {
        platformKey = key;
        platformConfig = platform;
        break;
      }
    }
    
    if (!options.skipDlMode && platformConfig?.serial?.autoEnterDlMode) {
      console.log('Checking download mode...');
      const dlPort = await findDownloadPort(platformKey);
      if (!dlPort) {
        console.log('Download port not detected, auto trying to enter download mode');
        const result = await enterDownloadMode(platformKey || firmwareInfo.type, false, 2);
        if (!result.success) {
          console.log('Failed to auto enter download mode, please manually enter download mode and retry');
          console.log('Continuing with flash...');
        }
        if (result.skipped) {
          console.log(`Warning: ${result.reason}`);
        }
      } else {
        console.log(`Device already in download mode: ${dlPort.path}`);
        if (dlPort.type === 'bus') {
          console.log(`   Type: Bus device (${dlPort.description})`);
        } else {
          console.log(`   Type: Serial device`);
        }
      }
    }
    
    const toolPath = getToolPath(firmwareInfo.type);
    
    if (!fs.existsSync(toolPath)) {
      throw new Error(`Download tool does not exist: ${toolPath}`);
    }
    console.log(`Download tool: ${firmwareInfo.type}`);
    
    console.log('Starting flash...');
    console.log('='.repeat(50));
    
    await executeFlash(toolPath, firmwareInfo.type, firmwareInfo.file);
    
    console.log('='.repeat(50));
    console.log('Flash completed successfully!');
    
  } catch (error) {
    const err = error as Error;
    console.error('Flash failed:', err.message);
    process.exit(1);
  }
}

/**
 * Find firmware path
 */
async function findFirmwarePath(): Promise<string | null> {
  const { findFirmwareAuto } = await import('./utils');
  return findFirmwareAuto();
}

/**
 * Get progress patterns for a specific platform/tool type
 * @param toolType - Tool type
 */
function getProgressPatterns(toolType: string): ProgressPatterns {
  const config = loadToolsConfig();
  
  let platformKey: string | null = null;
  for (const [key, platform] of Object.entries(config.platforms || {})) {
    if (platform.type === toolType) {
      platformKey = key;
      break;
    }
  }
  
  const platformConfig = platformKey ? config.platforms[platformKey] : null;
  
  return platformConfig?.progressPatterns || {
    started: ['init', 'start', 'begin'],
    downloading: ['downloading', 'running', 'burning', 'flashing'],
    completed: ['complete', 'success', 'finished'],
    error: ['error', 'fail', 'timeout']
  };
}

/**
 * Format download progress - unify different tool progress display
 * Reads matching patterns from config, returns status only (no progress bar)
 * Only judges other states if "started" is not matched
 */
function formatDownloadProgress(output: string, toolType: string, hasStartedRef: RefObject): string | null {
  const patterns = getProgressPatterns(toolType);
  
  let status: string | null = null;
  const lowerOutput = output.toLowerCase();
  
  for (const pattern of patterns.started) {
    if (lowerOutput.includes(pattern.toLowerCase())) {
      status = '📥 Started';
      hasStartedRef.value = true;
      break;
    }
  }
  
  if (!hasStartedRef.value) {
    return null;
  }
  
  if (!status) {
    for (const pattern of patterns.downloading) {
      if (lowerOutput.includes(pattern.toLowerCase())) {
        status = '📥 Downloading';
        break;
      }
    }
  }
  
  if (!status) {
    for (const pattern of patterns.completed) {
      if (lowerOutput.includes(pattern.toLowerCase())) {
        status = '✅ Completed';
        break;
      }
    }
  }
  
  if (!status) {
    for (const pattern of patterns.error) {
      if (lowerOutput.includes(pattern.toLowerCase())) {
        status = '❌ Error';
        break;
      }
    }
  }
  
  if (status) {
    return `\n${status}`;
  }
  
  return null;
}

/**
 * Execute flash command
 */
async function executeFlash(toolPath: string, toolType: string, firmwareFile: string): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    let command: string;
    let args: string[];
    
    const settings = getGlobalSettings();
    const port = settings.defaultPort || 'auto';
    
    if (isWindows()) {
      command = 'cmd';
      
      const toolArgs = buildToolArgs(toolType, 'flash', {
        firmwarePath: firmwareFile,
        port: port
      });
      
      const cmdStr = `"${toolPath}" ${toolArgs.join(' ')}`;
      args = ['/c', cmdStr];
    } else {
      command = toolPath;
      
      args = buildToolArgs(toolType, 'flash', {
        firmwarePath: firmwareFile,
        port: port
      });
    }
    
    console.log(`Executing command: ${command} ${args.join(' ')}`);
    
    const child = spawn(command, args, { 
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let downloadComplete = false;
    
    const timeout = setTimeout(() => {
      if (!downloadComplete) {
        console.log('Timeout, terminating download process');
        killProcessTree(child, 'SIGKILL');
      }
    }, 30000);
    
    const logFile = path.join(process.cwd(), 'frimware-cli-tool.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'w' });
    
    let lastStatus = '';
    const hasStartedRef: RefObject = { value: false };
    
    const stdoutRl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    });
    
    stdoutRl.on('line', (line: string) => {
      let output: string;
      if (isWindows()) {
        output = iconvLite.decode(Buffer.from(line, 'binary'), 'gbk');
      } else {
        output = line;
      }
      
      const timestamp = new Date().toISOString();
      logStream.write(`[${timestamp}] ${output}\n`);

      const progress = formatDownloadProgress(output, toolType, hasStartedRef);
      
      if (progress && !downloadComplete) {
        clearTimeout(timeout);
        downloadComplete = true;
      }
      
      if (progress) {
        const currentStatus = progress.trim();
        if (currentStatus !== lastStatus) {
          process.stdout.write(progress);
          lastStatus = currentStatus;
        }
      }
    });
    
    const stderrRl = readline.createInterface({
      input: child.stderr,
      crlfDelay: Infinity
    });
    
    stderrRl.on('line', (line: string) => {
      let errorOutput: string;
      if (isWindows()) {
        errorOutput = iconvLite.decode(Buffer.from(line, 'binary'), 'gbk');
      } else {
        errorOutput = line;
      }
      
      const timestamp = new Date().toISOString();
      logStream.write(`[${timestamp}] [STDERR] ${errorOutput}\n`);
      process.stderr.write(errorOutput + '\n');
    });
    
    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      logStream.end(`\n[Process exited, exit code: ${code}]\n`);
      if (code === 0) {
        console.log('\nDownload process exited successfully');
        resolve();
      } else {
        reject(new Error(`Download process failed, exit code: ${code}`));
      }
    });
    
    child.on('error', (error: Error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start download process: ${error.message}`));
    });
  });
}

/**
 * List USB devices
 */
export async function listDevices(): Promise<string[]> {
  if (!isWindows()) {
    console.log('Device list function only available on Windows');
    return [];
  }
  
  console.log('Searching for USB devices...');
  console.log('='.repeat(50));
  
  const command = 'wmic path Win32_PnPEntity where "Name like \'%USB%\' OR Name like \'%Quectel%\'" get Name';
  
  try {
    const { stdout } = await executeCommand('cmd', ['/c', command], { silent: true });
    
    const lines = stdout.split('\n');
    const devices: string[] = [];
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine && 
          !trimmedLine.includes('Name') &&
          trimmedLine.length > 0) {
        if (!(trimmedLine.includes('Keyboard') || 
              trimmedLine.includes('Mouse') || 
              trimmedLine.includes('Controller') ||
              trimmedLine.includes('Input') ||
              trimmedLine.includes('Hub') ||
              trimmedLine.includes('Oray') ||
              trimmedLine.includes('ECM') ||
              trimmedLine.includes('Composite Device') ||
              trimmedLine.includes('输入设备') ||
              trimmedLine.includes('集线器') ||
              trimmedLine.includes('主机控制器'))) {
          devices.push(trimmedLine);
        }
      }
    }
    
    if (devices.length === 0) {
      console.log('No USB devices found');
    } else {
      devices.sort((a, b) => a.localeCompare(b));
      console.log(`Found ${devices.length} device(s):\n`);
      devices.forEach((device, index) => {
        console.log(`${index + 1}. ${device}`);
      });
    }
    
    return devices;
  } catch (error) {
    const err = error as Error;
    console.error('Failed to get device list:', err.message);
    return [];
  }
}