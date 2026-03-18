import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import iconv from 'iconv-lite';
import AdmZip from 'adm-zip';
import type {
  ToolsConfig,
  ToolConfig,
  PlatformConfig,
  GlobalSettings,
  FirmwareInfo,
  CLIConfig,
  FirmwareTypeResult,
  ExecuteCommandOptions,
  ExecuteCommandResult
} from './types';

/** Tool configuration cache */
let toolsConfigCache: ToolsConfig | null = null;

/**
 * Load tools configuration file
 */
export function loadToolsConfig(): ToolsConfig {
  if (toolsConfigCache) {
    return toolsConfigCache;
  }
  
  const toolsDir = getToolsPath();
  const configPath = path.join(toolsDir, 'tools-config.json');
  
  if (fs.existsSync(configPath)) {
    try {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config: ToolsConfig = JSON.parse(configData);
      toolsConfigCache = config;
      return config;
    } catch (error) {
      const err = error as Error;
      console.error('Failed to parse tools config file:', err.message);
    }
  }
  
  // Return default configuration
  return {
    version: '1.0.0',
    description: '',
    tools: {},
    platforms: {},
    settings: {
      defaultPort: 'auto',
      timeout: 300,
      retryCount: 3
    }
  };
}

/**
 * Get tool configuration
 */
export function getToolConfig(toolType: string): ToolConfig | null {
  const config = loadToolsConfig();
  return config.tools[toolType] || null;
}

/**
 * Get platform configuration
 */
export function getPlatformConfig(platformType: string): PlatformConfig | null {
  const config = loadToolsConfig();
  return config.platforms[platformType] || null;
}

/**
 * Get full tool path
 */
export function getToolPath(toolType: string): string {
  const toolConfig = getToolConfig(toolType);
  if (!toolConfig) {
    throw new Error(`Unknown tool type: ${toolType}`);
  }
  
  const toolsDir = getToolsPath();
  return path.join(toolsDir, toolConfig.path);
}

/**
 * Build tool arguments
 */
export function buildToolArgs(
  toolType: string,
  action: string,
  params: Record<string, string> = {}
): string[] {
  const toolConfig = getToolConfig(toolType);
  if (!toolConfig || !toolConfig.args) {
    return [];
  }
  
  const argsTemplate = toolConfig.args[action] || toolConfig.args.default || [];
  
  // Replace parameter placeholders
  return argsTemplate.map(arg => {
    let result = arg;
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(`{${key}}`, value);
    }
    return result;
  });
}

/**
 * Get tools directory path
 */
export function getToolsPath(): string {
  // If packaged as exe, use exe path to calculate tools directory
  if (process.execPath && process.execPath.endsWith('.exe')) {
    const projectRoot = path.dirname(process.execPath);
    const toolsDir = path.join(projectRoot, 'tools');
    
    if (fs.existsSync(toolsDir)) {
      return toolsDir;
    }
  }
  
  // Development environment: use parent directory of current file
  const projectRoot = path.dirname(__dirname);
  const toolsDir = path.join(projectRoot, 'tools');
  
  if (!fs.existsSync(toolsDir)) {
    throw new Error('Tools directory not found: ' + toolsDir);
  }
  
  return toolsDir;
}

/**
 * Format file size
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Create firmware info object
 */
export function createFirmwareInfo(filePath: string): FirmwareInfo {
  const stats = fs.statSync(filePath);
  const fileName = path.basename(filePath);
  
  // Determine type
  let type = 'UNKNOWN';
  const lower = fileName.toLowerCase();
  if (lower.endsWith('_fbf.bin')) {
    type = 'ASR FBF';
  } else if (lower.endsWith('.pac')) {
    type = 'UNISOC PAC';
  } else if (lower.endsWith('.zip')) {
    type = 'ASR ABOOT';
  } else if (lower.endsWith('download_usb.ini')) {
    type = 'Eigen ECF';
  }
  
  return {
    name: fileName,
    path: filePath,
    type: type,
    size: stats.size,
    time: stats.mtime.toLocaleString('zh-CN'),
    mtime: stats.mtime
  };
}

/**
 * Get all supported platform types
 */
export function getSupportedPlatforms(): string[] {
  const config = loadToolsConfig();
  return Object.keys(config.platforms || {});
}

/**
 * Determine platform type by firmware file
 */
export function determinePlatformByFirmware(filename: string): string | null {
  const config = loadToolsConfig();
  const platforms = config.platforms || {};
  
  for (const [platformKey, platformConfig] of Object.entries(platforms)) {
    // Check extensions
    if (platformConfig.extensions) {
      for (const ext of platformConfig.extensions) {
        if (filename.toLowerCase().endsWith(ext.toLowerCase())) {
          return platformKey;
        }
      }
    }
    
    // Special detection: ASR 160X ZIP files
    if (platformKey === 'asr160x' && filename.toLowerCase().endsWith('.zip')) {
      return 'asr160x_candidate';
    }
  }
  
  return null;
}

/**
 * Get global settings
 */
export function getGlobalSettings(): GlobalSettings {
  const config = loadToolsConfig();
  return config.settings || {
    defaultPort: 'auto',
    timeout: 300,
    retryCount: 3
  };
}

/**
 * Get project root directory
 */
export function getProjectRoot(): string {
  if (process.execPath && process.execPath.endsWith('.exe')) {
    return path.dirname(process.execPath);
  }
  
  const srcDir = __dirname;
  return path.dirname(srcDir);
}

/**
 * Find workspace path
 */
export function findWorkspacePath(): string | null {
  const currentDir = process.cwd();
  
  // Check if current directory is workspace
  if (fs.existsSync(path.join(currentDir, 'quectel_build'))) {
    return currentDir;
  }
  
  // Search upwards
  let dir = currentDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'quectel_build'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  
  return null;
}

/**
 * Check if Windows system
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Find all firmwares
 */
export function findAllFirmwares(): FirmwareInfo[] {
  const firmwares: FirmwareInfo[] = [];
  const config = loadConfig();
  
  // 1. Check config file
  if (config.firmwarePath) {
    if (fs.existsSync(config.firmwarePath)) {
      const stats = fs.statSync(config.firmwarePath);
      if (stats.isDirectory()) {
        const files = fs.readdirSync(config.firmwarePath);
        for (const file of files) {
          const filePath = path.join(config.firmwarePath!, file);
          if (fs.statSync(filePath).isFile() && isFirmwareFile(file)) {
            firmwares.push(createFirmwareInfo(filePath));
          }
        }
      } else if (stats.isFile() && isFirmwareFile(config.firmwarePath)) {
        firmwares.push(createFirmwareInfo(config.firmwarePath));
      }
    }
    return firmwares;
  }
  
  // 2. Check workspace quectel_build/release directory
  const workspacePath = findWorkspacePath();
  if (workspacePath) {
    const releasePath = path.join(workspacePath, 'quectel_build', 'release');
    if (fs.existsSync(releasePath)) {
      const dirs = fs.readdirSync(releasePath);
      for (const dir of dirs) {
        const dirPath = path.join(releasePath, dir);
        if (fs.statSync(dirPath).isDirectory()) {
          const files = fs.readdirSync(dirPath);
          for (const file of files) {
            const filePath = path.join(dirPath, file);
            if (fs.statSync(filePath).isFile() && isFirmwareFile(file)) {
              firmwares.push(createFirmwareInfo(filePath));
            }
          }
        }
      }
    }
  }
  
  return firmwares;
}

/**
 * Auto find firmware path (return optimal one)
 */
export function findFirmwareAuto(): string | null {
  const allFirmwares = findAllFirmwares();
  
  if (allFirmwares.length === 0) {
    return null;
  }
  
  // Sort: prefer non-factory, then by time desc
  const sortedFirmwares = allFirmwares.sort((a, b) => {
    const aIsFactory = a.name.toLowerCase().includes('factory');
    const bIsFactory = b.name.toLowerCase().includes('factory');
    
    if (aIsFactory && !bIsFactory) return 1;
    if (!aIsFactory && bIsFactory) return -1;
    
    return b.mtime.getTime() - a.mtime.getTime();
  });
  
  return sortedFirmwares[0].path;
}

/**
 * Check if firmware file
 */
export function isFirmwareFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith('_fbf.bin') || 
         lower.endsWith('.pac') || 
         lower.endsWith('.zip') || 
         lower.endsWith('download_usb.ini');
}

/**
 * Check if ZIP file is adownload format
 */
export function zipIsAdownloadFile(fileName: string): boolean {
  if (/.*\.zip$/i.test(fileName)) {
    try {
      const zip = new AdmZip(fileName);
      const zipEntries = zip.getEntries();
      const hasDownloadJson = zipEntries.some((entry: { entryName: string }) => {
        return entry.entryName === 'download.json' || 
               entry.entryName.endsWith('/download.json');
      });
      return hasDownloadJson;
    } catch (error) {
      const err = error as Error;
      console.error(`ZIP file check failed: ${err.message}`);
    }
  }
  return false;
}

/**
 * Determine firmware type and file
 */
export function determineFirmwareType(fileOrPath: string): FirmwareTypeResult {
  const filePath = fileOrPath;
  const stats = fs.statSync(filePath);
  
  if (stats.isDirectory()) {
    const files = fs.readdirSync(filePath);
    
    // ASR 1X03
    const fbfFile = files.find(f => f.toLowerCase().endsWith('_fbf.bin'));
    if (fbfFile) {
      return {
        type: 'fbf',
        file: path.join(filePath, fbfFile)
      };
    }
    
    // UNISOC 8310 8910
    const pacFile = files.find(f => f.toLowerCase().endsWith('.pac'));
    if (pacFile) {
      return {
        type: 'pac',
        file: path.join(filePath, pacFile)
      };
    }
    
    // ASR 160X
    const zipFile = files.find(f => f.toLowerCase().endsWith('.zip'));
    if (zipFile) {
      const zipPath = path.join(filePath, zipFile);
      if (zipIsAdownloadFile(zipPath)) {
        return {
          type: 'ad',
          file: zipPath
        };
      }
    }
    
    // Eigen
    const ecfFile = files.find(f => f.toLowerCase().endsWith('download_usb.ini'));
    if (ecfFile) {
      return {
        type: 'ecf',
        file: path.join(filePath, ecfFile)
      };
    }
    
    throw new Error('No supported firmware file found');
  } else {
    // Is file
    if (zipIsAdownloadFile(filePath)) {
      return { type: 'ad', file: filePath };
    } else if (/.*\_fbf.bin$/i.test(filePath)) {
      return { type: 'fbf', file: filePath };
    } else if (/.*\.pac$/i.test(filePath)) {
      return { type: 'pac', file: filePath };
    } else if (/.*\_download_usb.ini$/i.test(filePath)) {
      return { type: 'ecf', file: filePath };
    }
    
    throw new Error('Unsupported firmware file type');
  }
}

/**
 * Load configuration file
 */
export function loadConfig(): CLIConfig {
  const configPathWithDot = path.join(process.cwd(), 'firmware-cli.json');
  if (fs.existsSync(configPathWithDot)) {
    try {
      const configData = fs.readFileSync(configPathWithDot, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      const err = error as Error;
      console.error('Failed to parse config file:', err.message);
    }
  }
  
  return {};
}

/**
 * Save configuration file
 */
export function saveConfig(config: CLIConfig): void {
  const configPath = path.join(process.cwd(), 'firmware-cli.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Kill process tree
 */
export function killProcessTree(
  childProcess: ChildProcess,
  signal: NodeJS.Signals = 'SIGKILL'
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!childProcess || !childProcess.pid) {
      resolve();
      return;
    }
    
    if (isWindows()) {
      const taskkill = spawn('taskkill', ['/PID', childProcess.pid.toString(), '/T', '/F'], { shell: true });
      taskkill.on('close', (code) => {
        if (code === 0 || code === 128) {
          resolve();
        } else {
          reject(new Error(`taskkill failed with code ${code}`));
        }
      });
      taskkill.on('error', reject);
    } else {
      try {
        childProcess.kill(signal);
        resolve();
      } catch (error) {
        reject(error);
      }
    }
  });
}

/**
 * Execute command
 */
export function executeCommand(
  command: string,
  args: string[],
  options: ExecuteCommandOptions = {}
): Promise<ExecuteCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { 
      shell: true,
      ...options
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout?.on('data', (data: Buffer) => {
      let output: string;
      if (isWindows()) {
        output = iconv.decode(data, 'gbk');
      } else {
        output = data.toString('utf8');
      }
      stdout += output;
      if (!options.silent) {
        process.stdout.write(output);
      }
      
      // Auto handle pause command
      if (options.autoPressKey !== false) {
        const lowerOutput = output.toLowerCase();
        if (lowerOutput.includes('请按任意键继续') || 
            lowerOutput.includes('press any key') ||
            lowerOutput.includes('pause')) {
          if (child.stdin && !child.stdin.destroyed) {
            child.stdin.write('\n');
          }
        }
      }
    });
    
    child.stderr?.on('data', (data: Buffer) => {
      let output: string;
      if (isWindows()) {
        output = iconv.decode(data, 'gbk');
      } else {
        output = data.toString('utf8');
      }
      stderr += output;
      if (!options.silent) {
        process.stderr.write(output);
      }
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
    
    child.on('error', reject);
  });
}