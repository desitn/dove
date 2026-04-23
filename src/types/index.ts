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
 * Global paths configuration
 */
export interface GlobalPaths {
  gitBash?: string;
  [key: string]: string | undefined;
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
 * Build command item
 */
export interface BuildCommandItem {
  name: string;
  command: string;
  description?: string;
  isActive?: boolean;
}

/**
 * Port tag types for AI recognition
 */
export type PortTag = 'UART_AT' | 'UART_DBG' | 'USB_AT' | 'USB_DIAG' | 'Invalid';

/**
 * COM port configuration
 * Each port can only have one tag
 */
export interface ComPortConfig {
  port: string;
  tag: PortTag;             // Single tag: UART_AT, UART_DBG, USB_AT, USB_DIAG, or Invalid
  description?: string;
}

/**
 * CLI configuration file (dove.json)
 */
export interface CLIConfig {
  firmwarePath?: string;
  buildCommands?: BuildCommandItem[];
  buildGitBashPath?: string;
  comPorts?: ComPortConfig[];
  workspacePath?: string;
  theme?: ThemeConfig;
}

/**
 * Theme configuration
 */
export interface ThemeConfig {
  color?: 'cyan' | 'blue' | 'green' | 'magenta' | 'yellow' | 'red' | 'white';
}

/**
 * Flash firmware type result
 */
export interface FirmwareTypeResult {
  type: string;
  file: string;
}

/**
 * Flash progress callback for TUI integration
 */
export type FlashProgressCallback = (progress: number, status: string, logLine?: string) => void;

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
 * Serial port information (full)
 */
export interface SerialPortInfo {
  path: string;
  manufacturer: string;
  friendlyName: string;
  fullDescription: string;
  tag?: PortTag | null;  // User-defined tag from dove.json
}

/**
 * Port list output (simplified for CLI)
 */
export interface PortListInfo {
  path: string;
  tag: PortTag | null;
  friendlyName: string;
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
  env?: NodeJS.ProcessEnv;
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