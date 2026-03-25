/**
 * Firmware CLI Type Definitions
 */

/**
 * Tool configuration from tools-config.json
 */
export interface ToolConfig {
  name: string;
  path: string;
  description: string;
  args?: {
    flash?: string[];
    default?: string[];
    [key: string]: string[] | undefined;
  };
}

/**
 * Serial configuration for a platform
 */
export interface PlatformSerialConfig {
  atPortPatterns: string[];
  atCommand: string;
  atCommandForce?: string;
  baudrate: number;
  autoEnterDlMode: boolean;
  downloadPortPatterns: string[];
  downloadPortVidPid?: Array<{ vid: string; pid: string; desc: string }>;
  downloadBusVidPid?: Array<{ vid: string; pid: string; desc: string }>;
}

/**
 * Progress pattern matching configuration
 */
export interface ProgressPatterns {
  started: string[];
  downloading: string[];
  completed: string[];
  error: string[];
}

/**
 * Platform configuration
 */
export interface PlatformConfig {
  type: ToolType;
  extensions: string[];
  description: string;
  autoDetect?: {
    zipContains?: string[];
  };
  serial?: PlatformSerialConfig;
  progressPatterns?: ProgressPatterns;
  downloadDuration?: number;
}

/**
 * Global settings
 */
export interface GlobalSettings {
  defaultPort: string;
  timeout: number;
  retryCount: number;
}

/**
 * Output configuration
 */
export interface OutputConfig {
  progressMode: 'single-line' | 'multi-line' | 'json';
  verbose: boolean;
  timestamp: boolean;
}

/**
 * Serial settings
 */
export interface SerialSettings {
  baudrate: number;
  dataBits: number;
  parity: string;
  stopBits: number;
}

/**
 * Complete tools configuration
 */
export interface ToolsConfig {
  version: string;
  description: string;
  tools: Record<string, ToolConfig>;
  platforms: Record<string, PlatformConfig>;
  settings: GlobalSettings;
  serial?: SerialSettings;
  outputConfig?: OutputConfig;
}

/**
 * Tool type enum
 */
export enum ToolType {
  AD = 'ad',
  FBF = 'fbf',
  PAC = 'pac',
  ECF = 'ecf',
  ESP = 'esp'
}

/**
 * Firmware type enum
 */
export enum FirmwareType {
  ABOOT = 'ASR ABOOT',
  FBF = 'ASR FBF',
  PAC = 'UNISOC PAC',
  ECF = 'Eigen ECF',
  UNKNOWN = 'UNKNOWN'
}

/**
 * Firmware information
 */
export interface FirmwareInfo {
  name: string;
  path: string;
  type: string;
  size: number;
  time: string;
  mtime: Date;
}

/**
 * CLI configuration file (firmware-cli.json)
 */
export interface CLIConfig {
  firmwarePath?: string;
  buildCommand?: string;
  buildGitBashPath?: string;
  defaultComPort?: string;
}

/**
 * Flash firmware type result
 */
export interface FirmwareTypeResult {
  type: string;
  file: string;
}

/**
 * Monitor options for serial port
 */
  export interface MonitorOptions {
    baudRate: number;
    dataBits?: 8 | 5 | 6 | 7;
    parity?: 'none' | 'odd' | 'even' | 'mark' | 'space';
    stopBits?: 1 | 1.5 | 2;
    timeout: number;
    output?: string;
    append: boolean;
    include?: string;
    exclude?: string;
    until?: string;
    untilRegex?: RegExp;
    lines: number;
    json: boolean;
    timestamp: boolean;
  }

/**
 * Serial port information
 */
export interface SerialPortInfo {
  path: string;
  manufacturer: string;
  serialNumber: string;
  pnpId: string;
  locationId: string;
  vendorId: string;
  productId: string;
  fullDescription: string;
}

/**
 * Download port information
 */
export interface DownloadPortInfo {
  path: string;
  description: string;
  vendorId: string | null;
  productId: string | null;
  type: 'serial' | 'bus';
}

/**
 * Enter download mode result
 */
export interface EnterDownloadModeResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  port?: string;
  alreadyInMode?: boolean;
  error?: string;
}

/**
 * Send AT command result
 */
export interface ATCommandResult {
  success: boolean | null;
  response: string;
  timeout?: boolean;
}

/**
 * Execute command options
 */
export interface ExecuteCommandOptions {
  cwd?: string;
  shell?: boolean;
  silent?: boolean;
  autoPressKey?: boolean;
}

/**
 * Execute command result
 */
export interface ExecuteCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Monitor result
 */
export interface MonitorResult {
  success: boolean;
  port: string;
  baudRate: number;
  duration: number;
  stats: {
    bytes: number;
    lines: number;
    filtered: number;
  };
  outputFile?: string;
  data: string;
}