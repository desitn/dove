import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import readline from 'readline';
import iconvLite from 'iconv-lite';
import type {
  PlatformConfig,
  ProgressPatterns,
  FlashProgressCallback
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
  progressMode?: string | null;
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
        throw new Error('Firmware file not found, please specify firmware path or configure dove.json');
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
    
    await executeFlash(toolPath, firmwareInfo.type, firmwareInfo.file, options.progressMode);
    
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
    completed: ['complete', 'finished', 'succeeded'],
    error: ['error', 'fail', 'timeout']
  };
}

/**
 * Format download progress - detect status from tool output
 * Returns status string only, progress is managed separately
 * Only judges other states if "started" is not matched
 */
function formatDownloadProgress(output: string, toolType: string, hasStartedRef: RefObject): string | null {
  const patterns = getProgressPatterns(toolType);
  
  let status: string | null = null;
  const lowerOutput = output.toLowerCase();
  
  // Check for started patterns
  for (const pattern of patterns.started) {
    if (lowerOutput.includes(pattern.toLowerCase())) {
      status = '[STARTED]';
      hasStartedRef.value = true;
      break;
    }
  }
  
  if (!hasStartedRef.value) {
    return null;
  }
  
  // Check for downloading patterns
  if (!status) {
    for (const pattern of patterns.downloading) {
      if (lowerOutput.includes(pattern.toLowerCase())) {
        status = '[DOWNLOADING]';
        break;
      }
    }
  }
  
  // Check for completed patterns
  if (!status) {
    for (const pattern of patterns.completed) {
      if (lowerOutput.includes(pattern.toLowerCase())) {
        status = '[COMPLETED]';
        break;
      }
    }
  }
  
  // Check for error patterns
  if (!status) {
    for (const pattern of patterns.error) {
      if (lowerOutput.includes(pattern.toLowerCase())) {
        status = '[ERROR]';
        break;
      }
    }
  }
  
  return status ? `\r${status}` : null;
}

/**
 * Create a simple progress bar
 */
function createProgressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return '[' + '='.repeat(filled) + ' '.repeat(empty) + ']';
}

/**
 * Execute flash command
 * @param onProgress - Optional callback for TUI progress updates
 */
export async function executeFlash(
  toolPath: string,
  toolType: string,
  firmwareFile: string,
  progressMode?: string | null,
  onProgress?: FlashProgressCallback
): Promise<void> {
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

    // Log command execution
    if (onProgress) {
      onProgress(0, 'idle', `Executing: ${command} ${args.join(' ')}`);
    } else {
      console.log(`Executing command: ${command} ${args.join(' ')}`);
    }

    const child = spawn(command, args, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let downloadComplete = false;

    const timeout = setTimeout(() => {
      if (!downloadComplete) {
        if (onProgress) {
          onProgress(0, 'error', 'Timeout, terminating download process');
        } else {
          console.log('Timeout, terminating download process');
        }
        killProcessTree(child, 'SIGKILL');
      }
    }, 30000);

    // Log file path: .dove/flash/flash.log
    const cwd = process.cwd();
    const doveFlashDir = path.join(cwd, '.dove', 'flash');
    const logFile = path.join(doveFlashDir, 'flash.log');

    // Create .dove/flash directory if not exists
    if (!fs.existsSync(doveFlashDir)) {
      fs.mkdirSync(doveFlashDir, { recursive: true });
    }
    const logStream = fs.createWriteStream(logFile, { flags: 'w' });

    const hasStartedRef: RefObject = { value: false };

    // Get output configuration
    const config = loadToolsConfig();
    const outputConfig = config.outputConfig || { progressMode: 'single-line', verbose: false, timestamp: false };

    // Override progressMode if specified in options
    if (progressMode) {
      outputConfig.progressMode = progressMode as 'single-line' | 'multi-line' | 'json';
    }

    // Progress tracking - stage-based pseudo progress
    let currentProgress = 0;
    let currentStatus = 'idle';
    let progressInterval: NodeJS.Timeout | null = null;
    let stageStartTime = Date.now();

    // State machine: define state order for linear progression only
    const stateOrder: Record<string, number> = {
      'idle': 0,
      'started': 1,
      'downloading': 2,
      'completed': 3,
      'error': 99
    };

    // Check if state transition is allowed (only forward progression)
    const canTransitionTo = (newStatus: string): boolean => {
      const currentOrder = stateOrder[currentStatus] ?? -1;
      const newOrder = stateOrder[newStatus] ?? -1;
      return newOrder > currentOrder;
    };

    // Get download duration from platform config, default to 30 seconds
    const platformKeyForDuration = Object.keys(config.platforms || {}).find(
      key => config.platforms[key].type === toolType
    );
    const platformDuration = platformKeyForDuration
      ? config.platforms[platformKeyForDuration].downloadDuration
      : undefined;
    const downloadDuration = platformDuration || 30000; // Default 30 seconds

    // Stage configuration: each stage has a fixed progress range
    const stageConfig: Record<string, { min: number; max: number; duration: number }> = {
      'started': { min: 0, max: 5, duration: 5000 },        // 0-5% in 5 seconds
      'downloading': { min: 5, max: 95, duration: downloadDuration },  // 5-95% in configured duration
      'completed': { min: 95, max: 100, duration: 3000 },   // 95-100% in 3 seconds
      'error': { min: 0, max: 0, duration: 0 }
    };

    // Start progress simulation for current stage
    const startStageProgress = (stage: string) => {
      if (progressInterval) {
        clearInterval(progressInterval);
      }

      const cfg = stageConfig[stage];
      if (!cfg || cfg.duration === 0) {
        return;
      }

      stageStartTime = Date.now();
      currentProgress = cfg.min;

      // Update immediately
      outputProgress(currentProgress, currentStatus);

      // Start interval to update progress within the stage
      progressInterval = setInterval(() => {
        if (downloadComplete) {
          return;
        }

        const elapsed = Date.now() - stageStartTime;
        const progress = Math.min(1, elapsed / cfg.duration);
        const newProgress = cfg.min + (cfg.max - cfg.min) * progress;

        if (newProgress > currentProgress) {
          currentProgress = newProgress;
          outputProgress(currentProgress, currentStatus);
        }
      }, 200); // Update every 200ms for smooth animation
    };

    // Auto-start progress when flash begins
    setTimeout(() => {
      if (!hasStartedRef.value && !downloadComplete) {
        hasStartedRef.value = true;
        currentStatus = 'started';
        startStageProgress('started');
      }
    }, 100);

    // Output progress - use callback for TUI, console for CLI
    const outputProgress = (progress: number, status: string) => {
      const progressInt = Math.floor(progress);

      if (onProgress) {
        // TUI mode: use callback
        onProgress(progressInt, status);
      } else {
        // CLI mode: console output
        if (outputConfig.progressMode === 'json') {
          const jsonOutput = {
            progress: progressInt,
            status: status,
            message: getStatusText(status)
          };
          console.log(JSON.stringify(jsonOutput));
        } else if (outputConfig.progressMode === 'single-line') {
          const progressBar = createProgressBar(progressInt);
          const statusText = getStatusText(status);
          process.stdout.write(`\r${progressBar} ${progressInt}% ${statusText}`);
        } else {
          // multi-line mode
          const statusText = getStatusText(status);
          const timestamp = outputConfig.timestamp ? `[${new Date().toISOString()}] ` : '';
          console.log(`${timestamp}Progress: ${progressInt}% ${statusText}`);
        }
      }
    };

    // Get status text
    const getStatusText = (status: string): string => {
      switch (status) {
        case 'started': return 'Initializing...';
        case 'downloading': return 'Downloading...';
        case 'completed': return 'Completed!';
        case 'error': return 'Error!';
        default: return '';
      }
    };

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

      // Send log line to callback for TUI
      if (onProgress) {
        onProgress(Math.floor(currentProgress), currentStatus, output);
      }

      // Parse output to determine status
      const progress = formatDownloadProgress(output, toolType, hasStartedRef);

      // Handle status detection and timeout clearing
      if (progress && !downloadComplete) {
        const statusMatch = progress.match(/\[(\w+)\]/);
        if (statusMatch) {
          const detectedStatus = statusMatch[1].toLowerCase();

          // Clear timeout when download starts (started or downloading)
          if (detectedStatus === 'started' || detectedStatus === 'downloading') {
            clearTimeout(timeout);
          }

          // Mark as complete only when finished or error
          if (detectedStatus === 'completed' || detectedStatus === 'error') {
            downloadComplete = true;
          }
        }
      }

      // Update status based on output (with state machine - only forward progression)
      if (progress) {
        const statusMatch = progress.match(/\[(\w+)\]/);
        if (statusMatch) {
          const newStatus = statusMatch[1].toLowerCase();
          // Only allow state transition if it's forward progression
          if (newStatus !== currentStatus && canTransitionTo(newStatus)) {
            currentStatus = newStatus;
            // Start progress simulation for the new stage
            startStageProgress(currentStatus);
          }
        }
      }

      // Verbose output (CLI only)
      if (!onProgress && outputConfig.verbose) {
        console.log(output);
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

      // Send error log to callback for TUI
      if (onProgress) {
        onProgress(Math.floor(currentProgress), currentStatus, `[ERR] ${errorOutput}`);
      } else {
        process.stderr.write(errorOutput + '\n');
      }
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timeout);

      // Stop progress simulation
      if (progressInterval) {
        clearInterval(progressInterval);
      }

      // Set final progress
      if (code === 0) {
        currentProgress = 100;
        currentStatus = 'completed';
        outputProgress(100, 'completed');
        if (onProgress) {
          onProgress(100, 'completed', `Download completed successfully. Log: ${logFile}`);
        } else {
          console.log('\nDownload completed successfully');
          console.log(`Log saved to: ${logFile}`);
        }
        resolve();
      } else {
        currentStatus = 'error';
        outputProgress(currentProgress, 'error');
        if (onProgress) {
          onProgress(Math.floor(currentProgress), 'error', `Download failed, exit code: ${code}. Log: ${logFile}`);
        } else {
          console.log(`\nLog saved to: ${logFile}`);
        }
        reject(new Error(`Download process failed, exit code: ${code}`));
      }

      logStream.end(`\n[Process exited, exit code: ${code}]\n`);
    });

    child.on('error', (error: Error) => {
      clearTimeout(timeout);

      // Stop progress simulation
      if (progressInterval) {
        clearInterval(progressInterval);
      }

      currentStatus = 'error';
      outputProgress(currentProgress, 'error');
      if (onProgress) {
        onProgress(Math.floor(currentProgress), 'error', `Process error: ${error.message}`);
      } else {
        console.log(`\nLog saved to: ${logFile}`);
      }
      reject(new Error(`Failed to start download process: ${error.message}`));
    });
  });
}

interface DevicesOptions {
  json?: boolean;
  returnResult?: boolean;
}

/**
 * List USB devices (default JSON output)
 */
export async function listDevices(options: DevicesOptions = {}): Promise<string[] | string> {
  if (!isWindows()) {
    const result = { devices: [], count: 0, error: 'Device list function only available on Windows' };
    if (options.returnResult) return JSON.stringify(result, null, 2);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log('Device list function only available on Windows');
    return [];
  }

  if (!options.json && !options.returnResult) {
    console.log('Searching for USB devices...');
    console.log('='.repeat(50));
  }
  
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
    
    if (options.returnResult) {
      return JSON.stringify({ devices, count: devices.length }, null, 2);
    }
    if (options.json) {
      console.log(JSON.stringify({ devices, count: devices.length }, null, 2));
    } else {
      if (devices.length === 0) {
        console.log('No USB devices found');
      } else {
        devices.sort((a, b) => a.localeCompare(b));
        console.log(`Found ${devices.length} device(s):\n`);
        devices.forEach((device, index) => {
          console.log(`${index + 1}. ${device}`);
        });
      }
    }

    return devices;
  } catch (error) {
    const err = error as Error;
    const result = { devices: [], count: 0, error: err.message };
    if (options.returnResult) return JSON.stringify(result, null, 2);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.error('Failed to get device list:', err.message);
    return [];
  }
}
