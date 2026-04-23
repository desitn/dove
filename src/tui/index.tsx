/**
 * Dove TUI - Interactive Terminal UI
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { loadConfig, saveConfig, getToolPath, loadToolsConfig, determineFirmwareType, findWorkspacePath, findConfigPath, getProjectRoot } from '../utils';
import { compileFirmware } from '../compile';
import { findAllFirmwares, formatSize } from '../utils';
import { executeFlash } from '../flash';
import { enterDownloadMode, findDownloadPort, listSerialPorts } from '../serial';
import type { FirmwareInfo, SerialPortInfo, PlatformConfig } from '../types';

// ============================================================
// List Selector - Universal partial refresh for list navigation
// ============================================================

type ListType = 'main' | 'build' | 'flash' | 'ports' | 'port-tag' | 'settings' | 'theme' | 'diag' | 'skill-hub' | 'skill-agent';

// List base line offsets (line number where first item appears)
const listBaseLines: Record<ListType, number> = {
  'main':       5,  // After header 1-3, title 4
  'build':      6,  // After header 1-3, title 4, count 5
  'flash':      6,  // After header 1-3, title 4, count 5
  'ports':      6,  // After header 1-3, title 4, count 5
  'port-tag':   7,  // After header 1-3, title 4, info 5-6
  'settings':   5,  // After header 1-3, title 4
  'theme':      6,  // After header 1-3, title 4, blank 5
  'diag':       5,  // After header 1-3, title 4
  'skill-hub':  5,  // After header 1-3, title 4
  'skill-agent': 6, // After header 1-3, title 4, skill info 5
};

// Render item line for each list type
function renderListItem(type: ListType, index: number, isSelected: boolean): string {
  const theme = getThemeColor();
  const config = loadConfig() as any || {};
  const mark = isSelected ? theme.primary + '❯' + COLOR_RESET : ' ';

  switch (type) {
    case 'main':
      const mainPrefix = isSelected ? theme.primary + '❯' + COLOR_RESET + ' ' : '  ';
      const mainColor = isSelected ? COLOR_BOLD + theme.primary : '';
      return `${mainPrefix}${mainColor}${index + 1}. ${menuItems[index].label}${COLOR_RESET}`;

    case 'build':
      if (index < buildCommands.length && index < 7) {
        const cmd = buildCommands[index];
        const activeBuild = cmd.isActive ? COLOR_GREEN + ' *' + COLOR_RESET : '';
        return ` ${mark} ${index + 1}. ${cmd.name}: ${cmd.command}${activeBuild}`;
      } else if (index === Math.min(7, buildCommands.length)) {
        // Add option
        return ` ${mark} ${index + 1}. ${COLOR_GREEN}+ Add Command${COLOR_RESET}`;
      }
      return '';

    case 'flash':
      if (firmwareList.length === 0) return '';
      const fw = firmwareList[index];
      const recFlash = index === 0 ? COLOR_GREEN + ' *' + COLOR_RESET : '';
      // Format time
      const fwTime = fw.time || (fw.mtime ? fw.mtime.toLocaleString().replace(/\s\d{4}-\d{2}-\d{2}\s/, ' ') : '');
      // Truncate and pad with spaces (not tabs - ANSI codes break tab alignment)
      const nameWidth = 48;
      const typeWidth = 12;
      const timeWidth = 20;
      const truncatedFwName = truncate(fw.name, nameWidth);
      const paddedFwName = padDisplay(truncatedFwName, nameWidth);
      const paddedFwType = padDisplay(fw.type, typeWidth);
      const paddedFwTime = padDisplay(fwTime, timeWidth);
      return ` ${mark} ${index + 1}. ${paddedFwName}  ${theme.primary}${paddedFwType}${COLOR_RESET}  ${paddedFwTime}  ${formatSize(fw.size)}${recFlash}`;

    case 'ports':
      if (portList.length === 0) return '';
      const port = portList[index];
      const maxPortNameWidth = Math.max(35, ...portList.slice(0, 8).map(p => displayWidth(p.friendlyName)));
      const paddedPortName = padDisplay(port.friendlyName, maxPortNameWidth);
      const tagStr = port.tag ? COLOR_GREEN + '[' + port.tag + ']' + COLOR_RESET : COLOR_DIM + '[未标记]' + COLOR_RESET;
      return ` ${mark} ${index + 1}. ${paddedPortName} ${tagStr}`;

    case 'port-tag':
      const portForTag = portList[selectedPort];
      const tagItem = portTags[index];
      const hasTag = portForTag?.tag === tagItem;
      const checkTag = hasTag ? COLOR_GREEN + '✓' + COLOR_RESET : ' ';
      return ` ${mark} ${index + 1}. ${tagItem} ${checkTag}`;

    case 'settings':
      const settingItem = settingsItems[index];
      let valueStr: string;
      if (settingItem.type === 'ports') {
        valueStr = COLOR_DIM + '(' + portList.length + ' ports)' + COLOR_RESET;
      } else if (settingItem.type === 'array') {
        const value = getConfigValue(config, settingItem.key, settingItem.type);
        valueStr = COLOR_DIM + '(' + value + ' items)' + COLOR_RESET;
      } else if (settingItem.type === 'theme') {
        const currentTheme = config.theme?.color || 'cyan';
        const themeColorCode = themeColorMap[currentTheme]?.primary || themeColorMap.cyan.primary;
        valueStr = themeColorCode + currentTheme + COLOR_RESET;
      } else if (settingItem.type === 'action') {
        valueStr = COLOR_DIM + 'dove.json' + COLOR_RESET;
      } else if (settingItem.type === 'path') {
        const value = getConfigValue(config, settingItem.key, settingItem.type);
        const pathValue = typeof value === 'string' ? value : String(value);
        valueStr = pathValue ? COLOR_DIM + truncatePath(pathValue, 50) + COLOR_RESET : COLOR_DIM + '(will check cwd)' + COLOR_RESET;
      } else {
        const value = getConfigValue(config, settingItem.key, settingItem.type);
        valueStr = value ? COLOR_DIM + truncate(value, 30) + COLOR_RESET : COLOR_DIM + '(not set)' + COLOR_RESET;
      }
      return ` ${mark} ${index + 1}. ${settingItem.label}: ${valueStr}`;

    case 'theme':
      const currentTheme = (config as any).theme?.color || 'cyan';
      const colorName = themeColorNames[index];
      const colorCode = themeColorMap[colorName]?.primary || '';
      const checkTheme = colorName === currentTheme ? COLOR_GREEN + ' ✓' + COLOR_RESET : '';
      return ` ${mark} ${index + 1}. ${colorCode}${colorName}${COLOR_RESET}${checkTheme}`;

    case 'diag':
      const diagItem = diagItems[index];
      const diagPrefix = isSelected ? theme.primary + '❯' + COLOR_RESET + ' ' : '  ';
      const diagColor = isSelected ? COLOR_BOLD + theme.primary : '';
      return `${diagPrefix}${diagColor}${index + 1}. ${diagItem.label}${COLOR_RESET}`;

    case 'skill-hub':
      const skill = skillItems[index];
      const skillPrefix = isSelected ? theme.primary + '❯' + COLOR_RESET + ' ' : '  ';
      const skillColor = isSelected ? COLOR_BOLD + theme.primary : '';
      const skillDescDisplay = skill.desc ? ` ${COLOR_DIM}(${skill.desc})${COLOR_RESET}` : '';
      return `${skillPrefix}${skillColor}${index + 1}. ${skill.name}${COLOR_RESET}${skillDescDisplay}`;

    case 'skill-agent':
      const agent = agentTargets[index];
      const agentPrefix = isSelected ? theme.primary + '❯' + COLOR_RESET + ' ' : '  ';
      const agentColor = isSelected ? COLOR_BOLD + theme.primary : '';
      // Check if skill is installed for this agent
      const agentInstalled = checkSkillInstalled(agent);
      const agentInstallMark = agentInstalled ? COLOR_GREEN + ' ✓' + COLOR_RESET : COLOR_DIM + ' (not installed)' + COLOR_RESET;
      return `${agentPrefix}${agentColor}${index + 1}. ${agent}${COLOR_RESET}${agentInstallMark}`;

    default:
      return '';
  }
}

// Universal update selection - partial refresh without full screen render
function updateListSelection(type: ListType, oldIndex: number, newIndex: number): void {
  const baseLine = listBaseLines[type];

  // Get list length for bounds check
  const listLengths: Record<ListType, number> = {
    'main': menuItems.length,
    'build': Math.min(7, buildCommands.length) + 1, // +1 for Add option
    'flash': Math.min(8, firmwareList.length),
    'ports': Math.min(8, portList.length),
    'port-tag': portTags.length,
    'settings': settingsItems.length,
    'theme': themeColorNames.length,
    'diag': diagItems.length,
    'skill-hub': skillItems.length,
    'skill-agent': agentTargets.length,
  };

  const maxLen = listLengths[type];

  // Clear old selection
  if (oldIndex >= 0 && oldIndex < maxLen) {
    const oldLine = renderListItem(type, oldIndex, false);
    process.stdout.write(`\x1b[${baseLine + oldIndex}H\x1b[2K${oldLine}`);
  }

  // Set new selection
  if (newIndex >= 0 && newIndex < maxLen) {
    const newLine = renderListItem(type, newIndex, true);
    process.stdout.write(`\x1b[${baseLine + newIndex}H\x1b[2K${newLine}`);
  }
}

// ============================================================
// Theme & Color Configuration
// ============================================================

// Theme colors - ANSI escape codes
const themeColorMap: Record<string, { primary: string; accent: string }> = {
  cyan:    { primary: '\x1b[36m', accent: '\x1b[36m' },
  blue:    { primary: '\x1b[34m', accent: '\x1b[34m' },
  green:   { primary: '\x1b[32m', accent: '\x1b[32m' },
  magenta: { primary: '\x1b[35m', accent: '\x1b[35m' },
  yellow:  { primary: '\x1b[33m', accent: '\x1b[33m' },
  red:     { primary: '\x1b[31m', accent: '\x1b[31m' },
  white:   { primary: '\x1b[37m', accent: '\x1b[37m' }
};

// Get theme color from config
function getThemeColor(): { primary: string; accent: string } {
  const config = loadConfig() as any;
  const theme = config?.theme?.color || 'cyan';
  return themeColorMap[theme] || themeColorMap.cyan;
}

// Color constants
const COLOR_RESET = '\x1b[0m';
const COLOR_BOLD = '\x1b[1m';
const COLOR_DIM = '\x1b[2m';
const COLOR_GREEN = '\x1b[32m';
const COLOR_RED = '\x1b[31m';
const COLOR_YELLOW = '\x1b[33m';

// State variables
let currentView: 'main' | 'build' | 'build-add' | 'flash' | 'flash-edit' | 'ports' | 'port-tag' | 'settings' | 'settings-detail' | 'settings-edit' | 'theme-select' | 'diag' | 'skill-hub' | 'skill-agent' = 'main';
let selectedMenu = 0;
let outputBuffer: string[] = [];
let isExecuting = false;
let firmwareList: FirmwareInfo[] = [];
let selectedFirmware = 0;
let buildCommands: any[] = [];
let selectedBuild = 0;

// Ports state
let portList: (SerialPortInfo & { tag: string })[] = [];
let selectedPort = 0;

// Flash state
let flashProgress = 0;
let flashStatus = 'idle';
let flashLogBuffer: string[] = [];
let showFlashLog = false;
let spinnerIndex = 0;

// Spinner characters
const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Menu items
const menuItems: { label: string; action: 'build' | 'flash' | 'ports' | 'settings' | 'diag' | 'quit' }[] = [
  { label: 'Build', action: 'build' },
  { label: 'Flash', action: 'flash' },
  { label: 'Ports', action: 'ports' },
  { label: 'Diagnosis', action: 'diag' },
  { label: 'Settings', action: 'settings' },
  { label: 'Quit', action: 'quit' },
];

// Predefined port tags
const portTags = ['UART_AT', 'UART_DBG', 'USB_AT', 'USB_DIAG', 'Invalid'];
let selectedTag = 0;

// Settings items (Firmware Path moved to Flash menu)
const settingsItems = [
  { key: 'workspacePath', label: 'Workspace Path', type: 'path' },
  { key: 'theme', label: 'Theme Color', type: 'theme' },
  { key: 'skillHub', label: 'Skill Hub', type: 'skill' },
  { key: 'openConfig', label: 'Open Config File', type: 'action' },
];
let selectedSetting = 0;

// Theme color options (color names array)
const themeColorNames = ['cyan', 'blue', 'green', 'magenta', 'yellow', 'red', 'white'];
let selectedThemeColor = 0;

// Diagnosis items (placeholder for future expansion)
const diagItems: { label: string; tool: string; desc: string }[] = [
  { label: 'Run Gonzo Diagnostic', tool: 'gonzo', desc: 'Run gonzo.exe diagnostic tool' },
  { label: 'PATH Environment Doctor', tool: 'env_doctor', desc: 'Check and fix PATH issues' },
];
let selectedDiag = 0;

// Helper: load skill description from SKILL.md frontmatter
function loadSkillDescription(skillName: string): string {
  const projectRoot = getProjectRoot();
  const skillPath = path.join(projectRoot, 'skill', skillName, 'SKILL.md');
  if (!fs.existsSync(skillPath)) return '';

  try {
    const content = fs.readFileSync(skillPath, 'utf8');
    // Extract description from frontmatter (between --- lines)
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const descMatch = frontmatterMatch[1].match(/description:\s*(.+)/);
      if (descMatch) {
        const desc = descMatch[1].trim();
        return desc.length > 15 ? desc.substring(0, 15) : desc;
      }
    }
  } catch {
    return '';
  }
  return '';
}

// Skill Hub items - load descriptions dynamically
const skillItems: { name: string; desc: string; sourcePath: string }[] = [
  { name: 'dove-action', desc: loadSkillDescription('dove-action'), sourcePath: '' },
  { name: 'dove-query', desc: loadSkillDescription('dove-query'), sourcePath: '' },
];
let selectedSkill = 0;

// Agent targets for skill installation
const agentTargets = ['claude-code', 'cline', 'cursor', 'copilot'];
let selectedAgent = 0;

// Settings edit state
let editingSettingKey = '';
let editInputBuffer = '';

// Build add command state
let buildAddStep = 0; // 0: name, 1: command, 2: description
let buildAddName = '';
let buildAddCommand = '';
let buildAddDescription = '';

// Load firmware list
async function loadFirmwareList(): Promise<void> {
  firmwareList = findAllFirmwares();
  // Sort: non-factory first, then by mtime descending
  firmwareList.sort((a, b) => {
    const aIsFactory = a.name.toLowerCase().includes('factory');
    const bIsFactory = b.name.toLowerCase().includes('factory');
    if (aIsFactory && !bIsFactory) return 1;
    if (!aIsFactory && bIsFactory) return -1;
    return b.mtime.getTime() - a.mtime.getTime();
  });
  selectedFirmware = 0;
}

// Load build commands from config
function loadBuildCommands(): void {
  const config = loadConfig() as any || {};
  buildCommands = config.buildCommands || [];
  // Find active command as default selection
  const activeIndex = buildCommands.findIndex(cmd => cmd.isActive);
  selectedBuild = activeIndex >= 0 ? activeIndex : 0;
}

// Load port list with user tags
async function loadPortList(): Promise<void> {
  const ports = await listSerialPorts();
  const config = loadConfig() as any || {};
  const comPorts = config.comPorts || [];

  // Tag priority: UART_AT -> UART_DBG -> USB_AT -> USB_DIAG -> Invalid -> null
  const tagPriority: Record<string, number> = {
    'UART_AT': 1,
    'UART_DBG': 2,
    'USB_AT': 3,
    'USB_DIAG': 4,
    'Invalid': 5
  };

  // Helper: extract COM number for sorting
  const getComNumber = (path: string): number => {
    const match = path.match(/COM(\d+)/i);
    return match ? parseInt(match[1]) : 9999;
  };

  // Filter out COM1, then sort by tag priority and COM number
  portList = ports.map(port => {
    const portConfig = comPorts.find((p: any) => p.port === port.path);
    return {
      ...port,
      tag: portConfig?.tag || null
    };
  }).filter(port => port.path !== 'COM1')
    .sort((a, b) => {
      const priorityA = a.tag ? tagPriority[a.tag] || 6 : 6;
      const priorityB = b.tag ? tagPriority[b.tag] || 6 : 6;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return getComNumber(a.path) - getComNumber(b.path);
    });
  selectedPort = 0;
}

// Save port tag to config (single tag only)
function savePortTag(portPath: string, tag: string): void {
  const config = loadConfig() as any || {};
  if (!config.comPorts) {
    config.comPorts = [];
  }

  const existing = config.comPorts.find((p: any) => p.port === portPath);
  if (existing) {
    existing.tag = tag;
  } else {
    config.comPorts.push({
      port: portPath,
      tag: tag
    });
  }

  saveConfig(config);
}

// Remove port tag from config (set to Invalid or remove entry)
function removePortTag(portPath: string): void {
  const config = loadConfig() as any || {};
  if (!config.comPorts) return;

  config.comPorts = config.comPorts.filter((p: any) => p.port !== portPath);

  saveConfig(config);
}

// Get terminal width with minimum constraint
function getTerminalWidth(): number {
  const width = process.stdout.columns || 80;
  return Math.max(40, Math.min(width, 120)); // min 40, max 120
}

// Helper: get config value by key
function getConfigValue(config: any, key: string, type: string): string | number {
  if (type === 'array') {
    const arr = config[key] || [];
    return arr.length;
  }
  return config[key] || '';
}

// Helper: truncate string
function truncate(str: string | number, maxLen: number): string {
  if (typeof str === 'number') return String(str);
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + '...';
}

// Helper: get agent skill path
function getAgentSkillPath(agent: string): string {
  const userHome = process.env.USERPROFILE || process.env.HOME || '';
  switch (agent) {
    case 'claude-code':
      return path.join(userHome, '.claude', 'skills');
    case 'cline':
      return path.join(userHome, '.agents', 'skills');
    case 'cursor':
      return path.join(userHome, '.cursor', 'skills');
    case 'copilot':
      return path.join(userHome, '.github', 'copilot', 'skills');
    default:
      return '';
  }
}

// Helper: check if skill is installed for agent
function checkSkillInstalled(agent: string): boolean {
  const skillPath = getAgentSkillPath(agent);
  if (!skillPath) return false;

  // Check if dove-action and dove-query exist
  const doveActionPath = path.join(skillPath, 'dove-action', 'SKILL.md');
  const doveQueryPath = path.join(skillPath, 'dove-query', 'SKILL.md');

  return fs.existsSync(doveActionPath) && fs.existsSync(doveQueryPath);
}

// Helper: truncate path string (show beginning and end, omit middle)
function truncatePath(path: string, maxLen: number): string {
  if (!path) return '';
  if (path.length <= maxLen) return path;

  // For Windows paths, try to preserve drive letter and last folder
  const minLen = 10; // Minimum length to show meaningful info
  if (maxLen < minLen) return truncate(path, maxLen);

  // Calculate how much to show at beginning and end
  const ellipsis = '...';
  const available = maxLen - ellipsis.length;
  const frontLen = Math.ceil(available * 0.4); // 40% from start
  const backLen = Math.floor(available * 0.6); // 60% from end

  return path.substring(0, frontLen) + ellipsis + path.substring(path.length - backLen);
}

// Helper: calculate display width (Chinese chars take 2 columns)
function displayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    // Chinese and other wide characters
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(char)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

// Helper: pad string for display alignment
function padDisplay(str: string, targetWidth: number): string {
  const currentWidth = displayWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + ' '.repeat(targetWidth - currentWidth);
}

// Helper: get spinner character
function getSpinner(): string {
  spinnerIndex = (spinnerIndex + 1) % spinnerChars.length;
  return spinnerChars[spinnerIndex];
}

function updateProgressLine(): void {
  // If log is shown, need full render to update log content
  if (showFlashLog) {
    renderScreen();
    return;
  }

  const spinner = getSpinner();
  const statusText = getFlashStatusText(flashStatus);
  const statusColor = flashStatus === 'completed' ? COLOR_GREEN : flashStatus === 'error' ? COLOR_RED : COLOR_YELLOW;
  // Progress is on line 6: (header 1-3, title 4, firmware info 5, progress 6)
  const line = `\x1b[6H\x1b[2K${spinner} ${flashProgress}% ${statusColor}${statusText}${COLOR_RESET}`;
  process.stdout.write(line);
}

// Helper: get flash status text
function getFlashStatusText(status: string): string {
  switch (status) {
    case 'idle': return 'Preparing...';
    case 'started': return 'Initializing...';
    case 'downloading': return 'Downloading...';
    case 'completed': return 'Download OK!';
    case 'error': return 'Error!';
    default: return '';
  }
}

// Flash firmware - reuse executeFlash from flash.ts
async function flashFirmwareWithProgress(firmwarePath: string): Promise<void> {
  try {
    if (!fs.existsSync(firmwarePath)) {
      throw new Error(`Firmware file does not exist: ${firmwarePath}`);
    }

    const firmwareInfo = determineFirmwareType(firmwarePath);
    const toolPath = getToolPath(firmwareInfo.type);

    if (!fs.existsSync(toolPath)) {
      throw new Error(`Download tool does not exist: ${toolPath}`);
    }

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

    // Reset state before flash (including enterDownloadMode logs)
    flashProgress = 0;
    flashStatus = 'idle';
    flashLogBuffer = [];
    renderScreen();

    // Check download mode
    if (platformConfig?.serial?.autoEnterDlMode) {
      const dlPort = await findDownloadPort(platformKey);
      if (!dlPort) {
        await enterDownloadMode(platformKey || firmwareInfo.type, false, 2, (msg) => {
          flashLogBuffer.push(msg);
          renderScreen();
        });
      }
    }

    // Use executeFlash with progress callback
    await executeFlash(toolPath, firmwareInfo.type, firmwareInfo.file, null, (progress, status, logLine) => {
      flashProgress = progress;
      flashStatus = status;
      if (logLine) {
        flashLogBuffer.push(logLine);
      }
      updateProgressLine();
    });

    // Final render to show completion
    renderScreen();

  } catch (err) {
    flashStatus = 'error';
    const error = err as Error;
    flashLogBuffer.push(`Error: ${error.message}`);
    renderScreen();
    throw err;
  }
}

// Track previous view line count for clearing extra lines
let prevViewLines = 0;

function renderScreen(fullClear: boolean = false): void {
  process.stdout.write('\x1b[?25l'); // Hide cursor

  // Only clear screen on exit (fullClear=true)
  if (fullClear) {
    process.stdout.write('\x1b[2J\x1b[H');
  } else {
    // Move cursor to home position without clearing
    process.stdout.write('\x1b[H');
  }

  const workspace = findWorkspacePath() || 'not found';
  // Extract only the last folder name for display
  const workspaceName = workspace !== 'not found' ? workspace.split(/[\\/]/).pop() || workspace : 'not found';
  const config = loadConfig() as any || {};
  const termWidth = getTerminalWidth();

  // Get theme color
  const theme = getThemeColor();

  let lines: string[] = [];

  // Header - centered title with emoji (emoji takes 2 display columns)
  const title = '🕊 Dove TUI';
  const titleWidth = 11;
  const padding = Math.floor((termWidth - titleWidth) / 2);

  lines.push(theme.primary + '─'.repeat(termWidth) + COLOR_RESET);
  lines.push(COLOR_BOLD + theme.primary + ' '.repeat(padding) + title + ' '.repeat(termWidth - padding - titleWidth) + COLOR_RESET);
  lines.push(theme.primary + '─'.repeat(termWidth) + COLOR_RESET);

  if (currentView === 'main') {
    lines.push(COLOR_BOLD + theme.primary + 'What would you like to do?' + COLOR_RESET);
    menuItems.forEach((item, i) => {
      const isSelected = i === selectedMenu;
      const prefix = isSelected ? theme.primary + '❯' + COLOR_RESET + ' ' : '  ';
      const color = isSelected ? COLOR_BOLD + theme.primary : '';
      lines.push(`${prefix}${color}${i + 1}. ${item.label}${COLOR_RESET}`);
    });
    lines.push('');
    lines.push(COLOR_DIM + '↑/↓ navigate | Enter select | Q quit' + COLOR_RESET);
  } else if (currentView === 'build') {
    lines.push(COLOR_BOLD + theme.primary + 'Build Commands' + COLOR_RESET);
    if (isExecuting) {
      lines.push(COLOR_YELLOW + '⏳ Building...' + COLOR_RESET);
      lines.push(COLOR_DIM + 'Please wait...' + COLOR_RESET);
    } else {
      lines.push(`Found ${buildCommands.length} build command(s):`);
      buildCommands.slice(0, 7).forEach((cmd, i) => {
        const mark = i === selectedBuild ? theme.primary + '❯' + COLOR_RESET : ' ';
        const active = cmd.isActive ? COLOR_GREEN + ' *' + COLOR_RESET : '';
        lines.push(` ${mark} ${i + 1}. ${cmd.name}: ${cmd.command}${active}`);
      });
      if (buildCommands.length > 7) {
        lines.push(`   ... and ${buildCommands.length - 7} more`);
      }
      // Add "Add Command" option as last item
      const addIndex = Math.min(7, buildCommands.length);
      const addMark = selectedBuild === addIndex ? theme.primary + '❯' + COLOR_RESET : ' ';
      lines.push(` ${addMark} ${addIndex + 1}. ${COLOR_GREEN}+ Add Command${COLOR_RESET}`);
      lines.push('');
      lines.push(COLOR_DIM + '[↑/↓] navigate | [1-8] select | [Enter] build/add | [D] delete | [Esc] back' + COLOR_RESET);
    }
  } else if (currentView === 'build-add') {
    // Add command view
    lines.push(COLOR_BOLD + theme.primary + 'Build Commands' + COLOR_RESET);
    lines.push(COLOR_DIM + 'Add New Build Command' + COLOR_RESET);
    lines.push('');
    const steps = ['Name', 'Command', 'Description (for AI context)'];
    const values = [buildAddName, buildAddCommand, buildAddDescription];
    steps.forEach((step, i) => {
      const isActive = i === buildAddStep;
      const mark = isActive ? theme.primary + '❯' + COLOR_RESET : ' ';
      const value = values[i] || '';
      lines.push(` ${mark} ${i + 1}. ${step}: ${value}${isActive ? '\x1b[5m_' + COLOR_RESET : ''}`);
    });
    lines.push('');
    lines.push(COLOR_DIM + '[↑/↓] switch field | [Enter] save | [Esc] cancel' + COLOR_RESET);
  } else if (currentView === 'flash') {
    lines.push(COLOR_BOLD + theme.primary + 'Flash Firmware' + COLOR_RESET);

    // Check if showing result (after execution completed/failed)
    if (!isExecuting && (flashStatus === 'completed' || flashStatus === 'error')) {
      // Show result page
      const fw = firmwareList[selectedFirmware];
      if (fw) {
        lines.push(COLOR_DIM + 'Firmware: ' + COLOR_RESET + truncate(fw.name, 40) + ' (' + theme.primary + fw.type + COLOR_RESET + ')');
      }
      lines.push('');

      // Show result status
      const statusColor = flashStatus === 'completed' ? COLOR_GREEN : COLOR_RED;
      const statusText = flashStatus === 'completed' ? '✓ Download OK!' : '✗ Download Failed!';
      lines.push(`${statusColor}${statusText}${COLOR_RESET}`);

      // Show log
      if (flashLogBuffer.length > 0) {
        lines.push('');
        lines.push(COLOR_DIM + '─── Output Log ───' + COLOR_RESET);
        flashLogBuffer.slice(-15).forEach(line => {
          lines.push(COLOR_DIM + truncate(line, termWidth - 4) + COLOR_RESET);
        });
      }

      lines.push('');
      lines.push(COLOR_DIM + '[Enter/Esc] return to firmware list' + COLOR_RESET);
    } else if (isExecuting) {
      // Show firmware info during execution
      const fw = firmwareList[selectedFirmware];
      if (fw) {
        lines.push(COLOR_DIM + 'Firmware: ' + COLOR_RESET + truncate(fw.name, 40) + ' (' + theme.primary + fw.type + COLOR_RESET + ', ' + formatSize(fw.size) + ')');
      }

      // Show progress line
      const spinner = spinnerChars[spinnerIndex];
      const statusText = getFlashStatusText(flashStatus);
      const statusColor = flashStatus === 'completed' ? COLOR_GREEN : flashStatus === 'error' ? COLOR_RED : COLOR_YELLOW;
      lines.push(`${spinner} ${flashProgress}% ${statusColor}${statusText}${COLOR_RESET}`);

      // Show log if enabled (Ctrl+O) - fill remaining terminal space
      if (showFlashLog && flashLogBuffer.length > 0) {
        lines.push('');
        lines.push(COLOR_DIM + '─── Output Log (Ctrl+O to hide) ───' + COLOR_RESET);
        // Show up to 15 lines of log to fill more terminal space
        flashLogBuffer.slice(-15).forEach(line => {
          lines.push(COLOR_DIM + truncate(line, termWidth - 4) + COLOR_RESET);
        });
      } else {
        lines.push('');
        lines.push(COLOR_DIM + 'Press Ctrl+O to view output log' + COLOR_RESET);
      }
      lines.push('');
      lines.push(COLOR_DIM + '[Ctrl+O] toggle log | [Esc] cancel' + COLOR_RESET);
    } else if (firmwareList.length > 0) {
      lines.push(`Found ${firmwareList.length} firmware(s):`);
      firmwareList.slice(0, 8).forEach((fw, i) => {
        const mark = i === selectedFirmware ? theme.primary + '❯' + COLOR_RESET : ' ';
        const rec = i === 0 ? COLOR_GREEN + ' *' + COLOR_RESET : '';
        const fwTime = fw.time || (fw.mtime ? fw.mtime.toLocaleString().replace(/\s\d{4}-\d{2}-\d{2}\s/, ' ') : '');
        // Truncate name if too long, then pad with spaces (not tabs)
        const nameWidth = 48;
        const typeWidth = 12;
        const timeWidth = 20;
        const truncatedName = truncate(fw.name, nameWidth);
        const paddedName = padDisplay(truncatedName, nameWidth);
        const paddedType = padDisplay(fw.type, typeWidth);
        const paddedTime = padDisplay(fwTime, timeWidth);
        // Use space separators, not tabs - ANSI codes break tab alignment
        lines.push(` ${mark} ${i + 1}. ${paddedName}  ${theme.primary}${paddedType}${COLOR_RESET}  ${paddedTime}  ${formatSize(fw.size)}${rec}`);
      });
      if (firmwareList.length > 8) {
        lines.push(`   ... and ${firmwareList.length - 8} more`);
      }
      // Show Firmware Path at bottom
      lines.push('');
      const config = loadConfig() as any || {};
      const fwPath = config.firmwarePath || '';
      const pathStr = fwPath ? COLOR_DIM + truncatePath(fwPath, 50) + COLOR_RESET : COLOR_DIM + '(will check workspace build/release)' + COLOR_RESET;
      lines.push(COLOR_DIM + 'Firmware Path: ' + pathStr + COLOR_RESET);
      lines.push('');
      lines.push(COLOR_DIM + '[↑/↓] navigate | [Enter] flash | [P] edit path | [R] refresh | [Esc] back' + COLOR_RESET);
    } else {
      lines.push(COLOR_DIM + 'No firmware found' + COLOR_RESET);
      // Show Firmware Path at bottom
      const config = loadConfig() as any || {};
      const fwPath = config.firmwarePath || '';
      const pathStr = fwPath ? COLOR_DIM + truncatePath(fwPath, 50) + COLOR_RESET : COLOR_DIM + '(will check workspace build/release)' + COLOR_RESET;
      lines.push(COLOR_DIM + 'Firmware Path: ' + pathStr + COLOR_RESET);
      lines.push('');
      lines.push(COLOR_DIM + '[P] edit path | [R] refresh | [Esc] back' + COLOR_RESET);
    }
  } else if (currentView === 'ports') {
    lines.push(COLOR_BOLD + theme.primary + 'Serial Ports' + COLOR_RESET);
    if (portList.length > 0) {
      lines.push(`Found ${portList.length} port(s):`);
      // Calculate max friendlyName display width for alignment (considering Chinese chars)
      const maxNameWidth = Math.max(35, ...portList.slice(0, 8).map(p => displayWidth(p.friendlyName)));
      portList.slice(0, 8).forEach((port, i) => {
        const mark = i === selectedPort ? theme.primary + '❯' + COLOR_RESET : ' ';
        const paddedName = padDisplay(port.friendlyName, maxNameWidth);
        const tagStr = port.tag ? COLOR_GREEN + '[' + port.tag + ']' + COLOR_RESET : COLOR_DIM + '[未标记]' + COLOR_RESET;
        lines.push(` ${mark} ${i + 1}. ${paddedName} ${tagStr}`);
      });
      if (portList.length > 8) {
        lines.push(`   ... and ${portList.length - 8} more`);
      }
      lines.push('');
      lines.push(COLOR_DIM + '[↑/↓] navigate | [Enter] edit tag | [R] refresh | [Esc] back' + COLOR_RESET);
    } else {
      lines.push(COLOR_DIM + 'No serial ports found' + COLOR_RESET);
      lines.push(COLOR_DIM + '[R] refresh | [Esc] back' + COLOR_RESET);
    }
  } else if (currentView === 'port-tag') {
    // Port tag edit view
    const port = portList[selectedPort];
    lines.push(COLOR_BOLD + theme.primary + 'Edit Port Tag' + COLOR_RESET);
    lines.push(`Port: ${port?.friendlyName || 'Unknown'}`);
    lines.push(`Current Tag: ${port?.tag || '(none)'}`);
    portTags.forEach((tag, i) => {
      const mark = i === selectedTag ? theme.primary + '❯' + COLOR_RESET : ' ';
      const hasTag = port?.tag === tag;
      const check = hasTag ? COLOR_GREEN + '✓' + COLOR_RESET : ' ';
      lines.push(` ${mark} ${i + 1}. ${tag} ${check}`);
    });
    lines.push('');
    lines.push(COLOR_DIM + '[↑/↓] select tag | [Enter] set tag | [D] clear | [Esc] back' + COLOR_RESET);
  } else if (currentView === 'settings') {
    lines.push(COLOR_BOLD + theme.primary + 'Settings' + COLOR_RESET);
    settingsItems.forEach((item, i) => {
      const mark = i === selectedSetting ? theme.primary + '❯' + COLOR_RESET : ' ';
      let valueStr: string;
      if (item.type === 'ports') {
        valueStr = COLOR_DIM + '(' + portList.length + ' ports)' + COLOR_RESET;
      } else if (item.type === 'array') {
        const value = getConfigValue(config, item.key, item.type);
        valueStr = COLOR_DIM + '(' + value + ' items)' + COLOR_RESET;
      } else if (item.type === 'theme') {
        const currentTheme = config.theme?.color || 'cyan';
        const themeColorCode = themeColorMap[currentTheme]?.primary || themeColorMap.cyan.primary;
        valueStr = themeColorCode + currentTheme + COLOR_RESET;
      } else if (item.type === 'skill') {
        // Show installed agents count
        const installedCount = agentTargets.filter(a => checkSkillInstalled(a)).length;
        valueStr = COLOR_DIM + '(' + installedCount + '/' + agentTargets.length + ' agents)' + COLOR_RESET;
      } else if (item.type === 'action') {
        valueStr = COLOR_DIM + 'dove.json' + COLOR_RESET;
      } else if (item.type === 'path') {
        const value = getConfigValue(config, item.key, item.type);
        const pathValue = typeof value === 'string' ? value : String(value);
        valueStr = pathValue ? COLOR_DIM + truncatePath(pathValue, 50) + COLOR_RESET : COLOR_DIM + '(will check cwd)' + COLOR_RESET;
      } else {
        const value = getConfigValue(config, item.key, item.type);
        valueStr = value ? COLOR_DIM + truncate(value, 30) + COLOR_RESET : COLOR_DIM + '(not set)' + COLOR_RESET;
      }
      lines.push(` ${mark} ${i + 1}. ${item.label}: ${valueStr}`);
    });
    lines.push('');
    lines.push(COLOR_DIM + '[↑/↓] navigate | [1-4] select | [Enter] edit | [Esc] back' + COLOR_RESET);
  } else if (currentView === 'theme-select') {
    lines.push(COLOR_BOLD + theme.primary + 'Select Theme Color' + COLOR_RESET);
    lines.push('');
    const currentTheme = (config as any).theme?.color || 'cyan';
    themeColorNames.forEach((colorName: string, i: number) => {
      const mark = i === selectedThemeColor ? theme.primary + '❯' + COLOR_RESET : ' ';
      const isSelected = colorName === currentTheme;
      const colorCode = themeColorMap[colorName]?.primary || '';
      const check = isSelected ? COLOR_GREEN + ' ✓' + COLOR_RESET : '';
      lines.push(` ${mark} ${i + 1}. ${colorCode}${colorName}${COLOR_RESET}${check}`);
    });
    lines.push('');
    lines.push(COLOR_DIM + '[↑/↓] navigate | [Enter] select | [Esc] back' + COLOR_RESET);
  } else if (currentView === 'settings-detail') {
    lines.push(COLOR_BOLD + theme.primary + 'Setting Detail' + COLOR_RESET);
    if (outputBuffer.length > 0) {
      outputBuffer.slice(-10).forEach(line => {
        lines.push(line);
      });
    }
    lines.push('');
    lines.push(COLOR_DIM + '[Enter/Esc] back' + COLOR_RESET);
  } else if (currentView === 'settings-edit') {
    const item = settingsItems.find(s => s.key === editingSettingKey);
    lines.push(COLOR_BOLD + theme.primary + 'Edit: ' + (item?.label || 'Value') + COLOR_RESET);
    lines.push(COLOR_DIM + 'Current: ' + (config[editingSettingKey] || '(not set)') + COLOR_RESET);
    lines.push('New value: ' + editInputBuffer + '\x1b[5m_' + COLOR_RESET);
    lines.push('');
    lines.push(COLOR_DIM + '[Enter] save | [Esc] cancel' + COLOR_RESET);
  } else if (currentView === 'flash-edit') {
    lines.push(COLOR_BOLD + theme.primary + 'Edit Firmware Path' + COLOR_RESET);
    const config = loadConfig() as any || {};
    const currentPath = config.firmwarePath || '';
    lines.push(COLOR_DIM + 'Current: ' + (currentPath || '(will check workspace build/release)') + COLOR_RESET);
    lines.push('New path: ' + editInputBuffer + '\x1b[5m_' + COLOR_RESET);
    lines.push('');
    lines.push(COLOR_DIM + '[Enter] save | [D] clear to default | [Esc] cancel' + COLOR_RESET);
  } else if (currentView === 'diag') {
    lines.push(COLOR_BOLD + theme.primary + 'Diagnosis Tools' + COLOR_RESET);
    diagItems.forEach((item, i) => {
      const isSelected = i === selectedDiag;
      const prefix = isSelected ? theme.primary + '❯' + COLOR_RESET + ' ' : '  ';
      const color = isSelected ? COLOR_BOLD + theme.primary : '';
      lines.push(`${prefix}${color}${i + 1}. ${item.label}${COLOR_RESET}`);
    });
    lines.push('');
    lines.push(COLOR_DIM + '[↑/↓] navigate | [Enter] run | [Esc] back' + COLOR_RESET);
  } else if (currentView === 'skill-hub') {
    lines.push(COLOR_BOLD + theme.primary + 'Skill Hub' + COLOR_RESET);
    skillItems.forEach((item, i) => {
      const isSelected = i === selectedSkill;
      const prefix = isSelected ? theme.primary + '❯' + COLOR_RESET + ' ' : '  ';
      const color = isSelected ? COLOR_BOLD + theme.primary : '';
      const descDisplay = item.desc ? ` ${COLOR_DIM}(${item.desc})${COLOR_RESET}` : '';
      lines.push(`${prefix}${color}${i + 1}. ${item.name}${COLOR_RESET}${descDisplay}`);
    });
    lines.push('');
    lines.push(COLOR_DIM + '[↑/↓] navigate | [Enter] select agent | [Esc] back' + COLOR_RESET);
  } else if (currentView === 'skill-agent') {
    const skill = skillItems[selectedSkill];
    // Title on line 4, desc on line 5, items start on line 6
    lines.push(COLOR_BOLD + theme.primary + 'Install: ' + skill.name + COLOR_RESET);
    // Always output desc line (line 5) to keep baseLine consistent
    if (skill.desc) {
      lines.push(COLOR_DIM + truncate(skill.desc, 60) + COLOR_RESET);
    } else {
      lines.push(''); // Empty line if no desc
    }
    // Items start on line 6
    agentTargets.forEach((agent, i) => {
      const isSelected = i === selectedAgent;
      const prefix = isSelected ? theme.primary + '❯' + COLOR_RESET + ' ' : '  ';
      const color = isSelected ? COLOR_BOLD + theme.primary : '';
      const isInstalled = checkSkillInstalled(agent);
      const installMark = isInstalled ? COLOR_GREEN + ' ✓' + COLOR_RESET : COLOR_DIM + ' (not installed)' + COLOR_RESET;
      lines.push(`${prefix}${color}${i + 1}. ${agent}${COLOR_RESET}${installMark}`);
    });
    lines.push('');
    const installHint = checkSkillInstalled(agentTargets[selectedAgent]) ? '[Enter] uninstall | [Esc] back' : '[Enter] install | [Esc] back';
    lines.push(COLOR_DIM + '[↑/↓] select agent | ' + installHint + COLOR_RESET);
  }

  // Status bar with box lines
  lines.push('');
  lines.push(theme.primary + '─'.repeat(termWidth) + COLOR_RESET);
  lines.push(COLOR_DIM + 'workspace: ' + workspaceName + COLOR_RESET);

  // Output - incrementally update each line
  lines.forEach((line, idx) => {
    process.stdout.write(`\x1b[${idx + 1}H\x1b[2K${line}`);
  });

  // Clear extra lines from previous view (if new view is shorter)
  if (!fullClear && prevViewLines > lines.length) {
    for (let i = lines.length + 1; i <= prevViewLines; i++) {
      process.stdout.write(`\x1b[${i}H\x1b[2K`);
    }
  }

  // Update previous view line count
  prevViewLines = lines.length;
}

export async function startTUI(): Promise<void> {
  renderScreen();

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();

    // Listen for terminal resize
    process.stdout.on('resize', () => {
      renderScreen();
    });

    process.stdin.on('data', async (data: Buffer) => {
      const input = data.toString();

      // Global: Exit
      if (input === '\x03' || input === '\x1b' || (input === 'q' && currentView === 'main')) {
        if (input === '\x1b' && currentView !== 'main') {
          // port-tag view returns to ports (since Ports is in main menu now)
          if (currentView === 'port-tag') {
            currentView = 'ports';
          } else if (currentView === 'ports') {
            currentView = 'main';
          } else if (currentView === 'settings-edit' || currentView === 'theme-select' || currentView === 'skill-hub') {
            currentView = 'settings';
            editInputBuffer = '';
            editingSettingKey = '';
          } else if (currentView === 'skill-agent') {
            currentView = 'skill-hub';
          } else if (currentView === 'flash-edit') {
            currentView = 'flash';
            editInputBuffer = '';
          } else if (currentView === 'settings-detail') {
            currentView = 'settings';
          } else {
            currentView = 'main';
          }
          outputBuffer = [];
          firmwareList = [];
          renderScreen();
          return;
        }
        if (input === '\x03' || (input === 'q' && currentView === 'main') || (input === '\x1b' && currentView === 'main')) {
          process.stdout.write('\x1b[?25h\x1b[2J\x1b[H');
          process.exit(0);
        }
      }

      // Navigation
      if (currentView === 'main') {
        if (input === '\x1b[A') { // Up
          const oldIndex = selectedMenu;
          selectedMenu = Math.max(0, selectedMenu - 1);
          if (oldIndex !== selectedMenu) updateListSelection('main', oldIndex, selectedMenu);
        } else if (input === '\x1b[B') { // Down
          const oldIndex = selectedMenu;
          selectedMenu = Math.min(menuItems.length - 1, selectedMenu + 1);
          if (oldIndex !== selectedMenu) updateListSelection('main', oldIndex, selectedMenu);
        } else if (input === '\r' || input === '\n') { // Enter
          const item = menuItems[selectedMenu];
          if (item.action === 'quit') {
            process.stdout.write('\x1b[?25h\x1b[2J\x1b[H');
            process.exit(0);
          } else {
            currentView = item.action;
            if (item.action === 'build') {
              loadBuildCommands();
            } else if (item.action === 'flash') {
              await loadFirmwareList();
              // Reset flash status when entering flash view
              flashStatus = 'idle';
              flashLogBuffer = [];
              flashProgress = 0;
            } else if (item.action === 'ports') {
              await loadPortList();
            } else if (item.action === 'settings') {
              // Settings view
            } else if (item.action === 'diag') {
              // Diagnosis view
              selectedDiag = 0;
            }
            renderScreen();
          }
        } else if (input >= '1' && input <= '6') {
          // Number keys for menu selection (6 items now)
          const idx = parseInt(input) - 1;
          if (idx >= 0 && idx < menuItems.length && idx !== selectedMenu) {
            const oldIndex = selectedMenu;
            selectedMenu = idx;
            updateListSelection('main', oldIndex, selectedMenu);
            const item = menuItems[idx];
            if (item.action === 'quit') {
              process.stdout.write('\x1b[?25h\x1b[2J\x1b[H');
              process.exit(0);
            } else {
              currentView = item.action;
              if (item.action === 'build') {
                loadBuildCommands();
              } else if (item.action === 'flash') {
                await loadFirmwareList();
              } else if (item.action === 'ports') {
                await loadPortList();
              } else if (item.action === 'settings') {
                // Settings view
              } else if (item.action === 'diag') {
                selectedDiag = 0;
              }
              renderScreen();
            }
          }
        }
      } else if (currentView === 'flash') {
        // Flash view - firmware selection or result display
        if (isExecuting) {
          // During execution, handle Ctrl+O to toggle log
          if (input === '\x0f') { // Ctrl+O
            showFlashLog = !showFlashLog;
            renderScreen();
          }
        } else if (flashStatus === 'completed' || flashStatus === 'error') {
          // Showing result - Enter/Esc to return to list
          if (input === '\r' || input === '\n' || input === '\x1b') {
            flashStatus = 'idle';
            flashLogBuffer = [];
            renderScreen();
          }
        } else {
          // Normal firmware selection
          if (input === 'r' || input === 'R') {
            await loadFirmwareList();
            renderScreen();
          } else if (input === 'p' || input === 'P') {
            // Edit firmware path
            currentView = 'flash-edit';
            editInputBuffer = '';
            renderScreen();
          } else if (input === '\x1b[A') { // Up
            const oldIndex = selectedFirmware;
            selectedFirmware = Math.max(0, selectedFirmware - 1);
            if (oldIndex !== selectedFirmware) updateListSelection('flash', oldIndex, selectedFirmware);
          } else if (input === '\x1b[B') { // Down
            const oldIndex = selectedFirmware;
            selectedFirmware = Math.min(Math.min(8, firmwareList.length) - 1, selectedFirmware + 1);
            if (oldIndex !== selectedFirmware) updateListSelection('flash', oldIndex, selectedFirmware);
          } else if (input >= '1' && input <= '8') {
            // Number keys to select firmware
            const idx = parseInt(input) - 1;
            if (idx >= 0 && idx < Math.min(8, firmwareList.length) && idx !== selectedFirmware) {
              const oldIndex = selectedFirmware;
              selectedFirmware = idx;
              updateListSelection('flash', oldIndex, selectedFirmware);
            }
          } else if (input === '\r' || input === '\n') {
            // Enter to flash selected firmware
            if (firmwareList.length > 0) {
              const fw = firmwareList[selectedFirmware];
              isExecuting = true;
              flashProgress = 0;
              flashStatus = 'idle';
              flashLogBuffer = [];
              showFlashLog = false;
              renderScreen();
              try {
                await flashFirmwareWithProgress(fw.path);
                // After completion, show result and wait for user input
              } catch (err) {
                // Error already handled, flashStatus will be 'error'
              }
              isExecuting = false;
              // Don't return to list immediately - stay in flash view showing result
              // User can press Enter/Esc to return
            }
          }
        }
      } else if (currentView === 'build') {
        // Build view - command selection
        if (!isExecuting) {
          const totalItems = Math.min(7, buildCommands.length) + 1; // +1 for Add option
          if (input === '\x1b[A') { // Up
            const oldIndex = selectedBuild;
            selectedBuild = Math.max(0, selectedBuild - 1);
            if (oldIndex !== selectedBuild) updateListSelection('build', oldIndex, selectedBuild);
          } else if (input === '\x1b[B') { // Down
            const oldIndex = selectedBuild;
            selectedBuild = Math.min(totalItems - 1, selectedBuild + 1);
            if (oldIndex !== selectedBuild) updateListSelection('build', oldIndex, selectedBuild);
          } else if (input >= '1' && input <= '8') {
            // Number keys to select command
            const idx = parseInt(input) - 1;
            if (idx >= 0 && idx < totalItems && idx !== selectedBuild) {
              const oldIndex = selectedBuild;
              selectedBuild = idx;
              updateListSelection('build', oldIndex, selectedBuild);
            }
          } else if (input === '\r' || input === '\n') {
            // Check if selecting "Add" option
            const addIndex = Math.min(7, buildCommands.length);
            if (selectedBuild === addIndex) {
              // Enter add command mode
              currentView = 'build-add';
              buildAddStep = 0;
              buildAddName = '';
              buildAddCommand = '';
              buildAddDescription = '';
              renderScreen();
            } else if (buildCommands.length > 0) {
              // Execute selected command
              const cmd = buildCommands[selectedBuild];
              isExecuting = true;
              renderScreen();
              try {
                await compileFirmware(cmd.name);
              } catch (err) {
                // Error already handled in compileFirmware
              }
              isExecuting = false;
              currentView = 'main';
              renderScreen();
            }
          } else if (input === 'd' || input === 'D') {
            // Delete selected command (not the Add option)
            const addIndex = Math.min(7, buildCommands.length);
            if (selectedBuild < addIndex && buildCommands.length > 0) {
              // Delete from config
              const config = loadConfig() as any || {};
              if (config.buildCommands) {
                config.buildCommands.splice(selectedBuild, 1);
                saveConfig(config);
                // Reload and adjust selection
                loadBuildCommands();
                selectedBuild = Math.min(selectedBuild, Math.min(7, buildCommands.length));
                renderScreen();
              }
            }
          }
          }
        } else if (currentView === 'build-add') {
          // Add command input handling
          if (input === '\x1b') { // Esc - cancel
            currentView = 'build';
            loadBuildCommands();
            renderScreen();
          } else if (input === '\x1b[A') { // Up - previous field
            buildAddStep = Math.max(0, buildAddStep - 1);
            renderScreen();
          } else if (input === '\x1b[B') { // Down - next field
            buildAddStep = Math.min(2, buildAddStep + 1);
            renderScreen();
          } else if (input === '\r' || input === '\n') { // Enter - save
            if (buildAddName && buildAddCommand) {
              // Save new command to config
              const config = loadConfig() as any || {};
              if (!config.buildCommands) {
                config.buildCommands = [];
              }
              config.buildCommands.push({
                name: buildAddName,
                command: buildAddCommand,
                description: buildAddDescription || '',
                isActive: false
              });
              saveConfig(config);
              // Return to build view
              currentView = 'build';
              loadBuildCommands();
              renderScreen();
            }
          } else if (input === '\x7f' || input === '\b') { // Backspace
            // Remove last char from current field
            if (buildAddStep === 0) {
              buildAddName = buildAddName.slice(0, -1);
            } else if (buildAddStep === 1) {
              buildAddCommand = buildAddCommand.slice(0, -1);
            } else {
              buildAddDescription = buildAddDescription.slice(0, -1);
            }
          renderScreen();
          } else if (input.length > 0) { // Handle paste or single char
            // Filter printable characters
            const printable = input.replace(/[^\x20-\x7E]/g, '');
            if (printable.length > 0) {
              // Add to current field
              if (buildAddStep === 0) {
                buildAddName += printable;
              } else if (buildAddStep === 1) {
                buildAddCommand += printable;
              } else {
                buildAddDescription += printable;
              }
              renderScreen();
            }
          }
        } else if (currentView === 'ports') {
        // Ports view
        if (!isExecuting) {
          if (input === 'r' || input === 'R') {
            await loadPortList();
            renderScreen();
          } else if (input === '\x1b[A') { // Up
            const oldIndex = selectedPort;
            selectedPort = Math.max(0, selectedPort - 1);
            if (oldIndex !== selectedPort) updateListSelection('ports', oldIndex, selectedPort);
          } else if (input === '\x1b[B') { // Down
            const oldIndex = selectedPort;
            selectedPort = Math.min(Math.min(8, portList.length) - 1, selectedPort + 1);
            if (oldIndex !== selectedPort) updateListSelection('ports', oldIndex, selectedPort);
          } else if (input >= '1' && input <= '8') {
            const idx = parseInt(input) - 1;
            if (idx >= 0 && idx < Math.min(8, portList.length) && idx !== selectedPort) {
              const oldIndex = selectedPort;
              selectedPort = idx;
              updateListSelection('ports', oldIndex, selectedPort);
            }
          } else if (input === '\r' || input === '\n') {
            // Enter to edit port tags
            if (portList.length > 0) {
              selectedTag = 0;
              currentView = 'port-tag';
              renderScreen();
            }
          }
        }
      } else if (currentView === 'port-tag') {
        // Port tag edit view
        const port = portList[selectedPort];
        if (input === '\x1b[A') { // Up
          const oldIndex = selectedTag;
          selectedTag = Math.max(0, selectedTag - 1);
          if (oldIndex !== selectedTag) updateListSelection('port-tag', oldIndex, selectedTag);
        } else if (input === '\x1b[B') { // Down
          const oldIndex = selectedTag;
          selectedTag = Math.min(portTags.length - 1, selectedTag + 1);
          if (oldIndex !== selectedTag) updateListSelection('port-tag', oldIndex, selectedTag);
        } else if (input >= '1' && input <= '5') {
          const idx = parseInt(input) - 1;
          if (idx >= 0 && idx < portTags.length && idx !== selectedTag) {
            const oldIndex = selectedTag;
            selectedTag = idx;
            updateListSelection('port-tag', oldIndex, selectedTag);
          }
        } else if (input === '\r' || input === '\n') {
          // Set selected tag for this port
          const tag = portTags[selectedTag];
          savePortTag(port.path, tag);
          // Reload port list to reflect changes
          await loadPortList();
          currentView = 'ports';
          renderScreen();
        } else if (input === 'd' || input === 'D') {
          // Clear tag for this port (remove from config)
          removePortTag(port.path);
          await loadPortList();
          currentView = 'ports';
          renderScreen();
        }
      } else if (currentView === 'settings') {
        // Settings view - navigation
        if (input === '\x1b[A') { // Up
          const oldIndex = selectedSetting;
          selectedSetting = Math.max(0, selectedSetting - 1);
          if (oldIndex !== selectedSetting) updateListSelection('settings', oldIndex, selectedSetting);
        } else if (input === '\x1b[B') { // Down
          const oldIndex = selectedSetting;
          selectedSetting = Math.min(settingsItems.length - 1, selectedSetting + 1);
          if (oldIndex !== selectedSetting) updateListSelection('settings', oldIndex, selectedSetting);
        } else if (input >= '1' && input <= '4') {
          // Number keys to select setting (4 items now)
          const idx = parseInt(input) - 1;
          if (idx >= 0 && idx < settingsItems.length && idx !== selectedSetting) {
            const oldIndex = selectedSetting;
            selectedSetting = idx;
            updateListSelection('settings', oldIndex, selectedSetting);
          }
        } else if (input === '\r' || input === '\n') {
          // Enter to show/edit setting
          const item = settingsItems[selectedSetting];
          if (item.type === 'theme') {
            // Enter theme color selection
            const config = loadConfig() as any || {};
            const currentTheme = config.theme?.color || 'cyan';
            selectedThemeColor = themeColorNames.indexOf(currentTheme);
            if (selectedThemeColor < 0) selectedThemeColor = 0;
            currentView = 'theme-select';
            renderScreen();
          } else if (item.type === 'skill') {
            // Enter skill hub
            selectedSkill = 0;
            currentView = 'skill-hub';
            renderScreen();
          } else if (item.type === 'action') {
            // Open config file with notepad
            const configPath = findConfigPath();
            if (configPath) {
              spawn('notepad', [configPath], { detached: true, stdio: 'ignore' });
            } else {
              // Create default config in current directory
              const defaultPath = process.cwd() + '/dove.json';
              spawn('notepad', [defaultPath], { detached: true, stdio: 'ignore' });
            }
          } else if (item.type === 'path') {
            // Enter edit mode for path settings
            editingSettingKey = item.key;
            const config = loadConfig() as any || {};
            editInputBuffer = config[item.key] || '';
            currentView = 'settings-edit';
            renderScreen();
          } else {
            // Show detail for other settings
            const config = loadConfig() as any || {};
            const value = config[item.key];
            outputBuffer = [];
            if (item.type === 'array') {
              const arr = value || [];
              outputBuffer.push(COLOR_BOLD + item.label + ' (' + arr.length + ' items):' + COLOR_RESET);
              arr.forEach((elem: any, i: number) => {
                const str = typeof elem === 'object' ? JSON.stringify(elem) : String(elem);
                outputBuffer.push(`  ${i + 1}. ${truncate(str, 40)}`);
              });
              if (arr.length === 0) {
                outputBuffer.push('  ' + COLOR_DIM + '(empty)' + COLOR_RESET);
              }
            } else {
              outputBuffer.push(COLOR_BOLD + item.label + ':' + COLOR_RESET);
              outputBuffer.push(`  ${value || COLOR_DIM + '(not set)' + COLOR_RESET}`);
            }
            outputBuffer.push('');
            outputBuffer.push(COLOR_DIM + 'Edit in dove.json file' + COLOR_RESET);
            currentView = 'settings-detail';
            renderScreen();
          }
        }
      } else if (currentView === 'theme-select') {
        // Theme color selection
        if (input === '\x1b[A') { // Up
          const oldIndex = selectedThemeColor;
          selectedThemeColor = Math.max(0, selectedThemeColor - 1);
          if (oldIndex !== selectedThemeColor) updateListSelection('theme', oldIndex, selectedThemeColor);
        } else if (input === '\x1b[B') { // Down
          const oldIndex = selectedThemeColor;
          selectedThemeColor = Math.min(themeColorNames.length - 1, selectedThemeColor + 1);
          if (oldIndex !== selectedThemeColor) updateListSelection('theme', oldIndex, selectedThemeColor);
        } else if (input >= '1' && input <= '7') {
          // Number keys to select theme
          const idx = parseInt(input) - 1;
          if (idx >= 0 && idx < themeColorNames.length && idx !== selectedThemeColor) {
            const oldIndex = selectedThemeColor;
            selectedThemeColor = idx;
            updateListSelection('theme', oldIndex, selectedThemeColor);
          }
        } else if (input === '\r' || input === '\n') {
          // Enter to select theme
          const config = loadConfig() as any || {};
          config.theme = { color: themeColorNames[selectedThemeColor] };
          saveConfig(config);
          currentView = 'settings';
          renderScreen();
        }
      } else if (currentView === 'settings-detail') {
        // Settings detail view - just show info, press any key to go back
        if (input === '\x1b' || input === '\r' || input === '\n') {
          currentView = 'settings';
          outputBuffer = [];
          renderScreen();
        }
      } else if (currentView === 'settings-edit') {
        // Settings edit view - text input
        if (input === '\x1b') {
          // Escape - cancel
          currentView = 'settings';
          editInputBuffer = '';
          editingSettingKey = '';
          renderScreen();
        } else if (input === '\r' || input === '\n') {
          // Enter - save
          const config = loadConfig() as any || {};
          config[editingSettingKey] = editInputBuffer;
          saveConfig(config);
          currentView = 'settings';
          editInputBuffer = '';
          editingSettingKey = '';
          renderScreen();
        } else if (input === '\x7f' || input === '\b') {
          // Backspace
          editInputBuffer = editInputBuffer.slice(0, -1);
          renderScreen();
        } else if (input.length > 0) {
          // Handle paste (multi-char) or single character
          // Filter printable characters (ASCII 32-126)
          const printable = input.replace(/[^\x20-\x7E]/g, '');
          if (printable.length > 0) {
            editInputBuffer += printable;
            renderScreen();
          }
        }
      } else if (currentView === 'flash-edit') {
        // Flash edit view - firmware path input
        if (input === '\x1b') {
          // Escape - cancel
          currentView = 'flash';
          editInputBuffer = '';
          renderScreen();
        } else if (input === 'd' || input === 'D') {
          // D - clear to default
          const config = loadConfig() as any || {};
          config.firmwarePath = '';
          saveConfig(config);
          currentView = 'flash';
          editInputBuffer = '';
          await loadFirmwareList();
          renderScreen();
        } else if (input === '\r' || input === '\n') {
          // Enter - save and refresh firmware list
          const config = loadConfig() as any || {};
          config.firmwarePath = editInputBuffer;
          saveConfig(config);
          currentView = 'flash';
          editInputBuffer = '';
          await loadFirmwareList();
          renderScreen();
        } else if (input === '\x7f' || input === '\b') {
          // Backspace
          editInputBuffer = editInputBuffer.slice(0, -1);
          renderScreen();
        } else if (input.length > 0) {
          // Handle paste (multi-char) or single character
          // Filter printable characters (ASCII 32-126)
          const printable = input.replace(/[^\x20-\x7E]/g, '');
          if (printable.length > 0) {
            editInputBuffer += printable;
            renderScreen();
          }
        }
      } else if (currentView === 'diag') {
        // Diagnosis view - tool selection
        if (input === '\x1b[A') { // Up
          const oldIndex = selectedDiag;
          selectedDiag = Math.max(0, selectedDiag - 1);
          if (oldIndex !== selectedDiag) updateListSelection('diag', oldIndex, selectedDiag);
        } else if (input === '\x1b[B') { // Down
          const oldIndex = selectedDiag;
          selectedDiag = Math.min(diagItems.length - 1, selectedDiag + 1);
          if (oldIndex !== selectedDiag) updateListSelection('diag', oldIndex, selectedDiag);
        } else if (input >= '1' && input <= '2') {
          // Number keys to select tool
          const idx = parseInt(input) - 1;
          if (idx >= 0 && idx < diagItems.length && idx !== selectedDiag) {
            const oldIndex = selectedDiag;
            selectedDiag = idx;
            updateListSelection('diag', oldIndex, selectedDiag);
          }
        } else if (input === '\r' || input === '\n') {
          // Enter - run selected diagnostic tool
          const item = diagItems[selectedDiag];
          const projectRoot = getProjectRoot();

          if (item.tool === 'gonzo') {
            // Run gonzo.exe in new window
            const gonzoPath = path.join(projectRoot, 'tools', 'diag', 'gonzo.exe');
            spawn('cmd', ['/c', 'start', 'cmd', '/k', gonzoPath], { detached: true, stdio: 'ignore' });
          } else if (item.tool === 'env_doctor') {
            // Run env_doctor.ps1 in new window
            const ps1Path = path.join(projectRoot, 'env', 'env_doctor.ps1');
            spawn('cmd', ['/c', 'start', 'powershell', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', ps1Path], { detached: true, stdio: 'ignore' });
          }
          // Return to main menu after launching
          currentView = 'main';
          renderScreen();
        }
      } else if (currentView === 'skill-hub') {
        // Skill Hub view - skill selection
        if (input === '\x1b[A') { // Up
          const oldIndex = selectedSkill;
          selectedSkill = Math.max(0, selectedSkill - 1);
          if (oldIndex !== selectedSkill) updateListSelection('skill-hub', oldIndex, selectedSkill);
        } else if (input === '\x1b[B') { // Down
          const oldIndex = selectedSkill;
          selectedSkill = Math.min(skillItems.length - 1, selectedSkill + 1);
          if (oldIndex !== selectedSkill) updateListSelection('skill-hub', oldIndex, selectedSkill);
        } else if (input >= '1' && input <= '2') {
          const idx = parseInt(input) - 1;
          if (idx >= 0 && idx < skillItems.length && idx !== selectedSkill) {
            const oldIndex = selectedSkill;
            selectedSkill = idx;
            updateListSelection('skill-hub', oldIndex, selectedSkill);
          }
        } else if (input === '\r' || input === '\n') {
          // Enter - go to agent selection
          selectedAgent = 0;
          currentView = 'skill-agent';
          renderScreen();
        }
      } else if (currentView === 'skill-agent') {
        // Skill Agent view - select agent and install/uninstall
        if (input === '\x1b[A') { // Up
          const oldIndex = selectedAgent;
          selectedAgent = Math.max(0, selectedAgent - 1);
          if (oldIndex !== selectedAgent) updateListSelection('skill-agent', oldIndex, selectedAgent);
        } else if (input === '\x1b[B') { // Down
          const oldIndex = selectedAgent;
          selectedAgent = Math.min(agentTargets.length - 1, selectedAgent + 1);
          if (oldIndex !== selectedAgent) updateListSelection('skill-agent', oldIndex, selectedAgent);
        } else if (input >= '1' && input <= '4') {
          const idx = parseInt(input) - 1;
          if (idx >= 0 && idx < agentTargets.length && idx !== selectedAgent) {
            const oldIndex = selectedAgent;
            selectedAgent = idx;
            updateListSelection('skill-agent', oldIndex, selectedAgent);
          }
        } else if (input === '\r' || input === '\n') {
          // Enter - install or uninstall skill for selected agent
          const agent = agentTargets[selectedAgent];
          const skillPath = getAgentSkillPath(agent);
          const isInstalled = checkSkillInstalled(agent);
          const projectRoot = getProjectRoot();

          if (isInstalled) {
            // Uninstall: remove skill files
            const skillNames = ['dove-action', 'dove-query'];
            for (const skillName of skillNames) {
              const skillDir = path.join(skillPath, skillName);
              if (fs.existsSync(skillDir)) {
                fs.rmSync(skillDir, { recursive: true, force: true });
              }
            }
            // Show success briefly then return
            renderScreen();
          } else {
            // Install: copy skill files
            const skillNames = ['dove-action', 'dove-query'];
            for (const skillName of skillNames) {
              const srcPath = path.join(projectRoot, 'skill', skillName, 'SKILL.md');
              if (fs.existsSync(srcPath)) {
                const destDir = path.join(skillPath, skillName);
                fs.mkdirSync(destDir, { recursive: true });
                fs.copyFileSync(srcPath, path.join(destDir, 'SKILL.md'));
              }
            }
            // Show success then return
            renderScreen();
          }
        }
      }
    });
  }

  // Keep running
  await new Promise(() => {});
}