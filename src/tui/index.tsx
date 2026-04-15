/**
 * Dove TUI - Interactive Terminal UI
 */

import fs from 'fs';
import { spawn } from 'child_process';
import readline from 'readline';
import iconvLite from 'iconv-lite';
import { findWorkspacePath, loadConfig, saveConfig, getToolPath, buildToolArgs, getGlobalSettings, loadToolsConfig, isWindows, determineFirmwareType, killProcessTree } from '../utils';
import { compileFirmware } from '../compile';
import { findAllFirmwares, formatSize } from '../utils';
import { listSerialPorts, enterDownloadMode, findDownloadPort } from '../serial';
import type { FirmwareInfo, SerialPortInfo, PlatformConfig, ProgressPatterns } from '../types';

// State variables
let currentView = 'main';
let selectedMenu = 0;
let outputBuffer: string[] = [];
let isExecuting = false;
let firmwareList: FirmwareInfo[] = [];
let selectedFirmware = 0;
let buildCommands: any[] = [];
let selectedBuild = 0;

// Ports state
let portList: (SerialPortInfo & { tags: string[], isActive: boolean })[] = [];
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
const menuItems = [
  { label: 'Build', action: 'build' },
  { label: 'Flash', action: 'flash' },
  { label: 'Settings', action: 'settings' },
  { label: 'Quit', action: 'quit' },
];

// Predefined port tags
const portTags = ['AT', 'DBG', 'Invalid'];
let selectedTag = 0;

// Settings items (COM Ports replaced by Ports view)
const settingsItems = [
  { key: 'workspacePath', label: 'Workspace Path', type: 'path' },
  { key: 'firmwarePath', label: 'Firmware Path', type: 'path' },
  { key: 'buildCommands', label: 'Build Commands', type: 'array' },
  { key: 'ports', label: 'Ports', type: 'ports' },  // Entry to Ports config
];
let selectedSetting = 0;

// Settings edit state
let editingSettingKey = '';
let editInputBuffer = '';

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

  portList = ports.map(port => {
    const portConfig = comPorts.find((p: any) => p.port === port.path);
    return {
      ...port,
      tags: portConfig?.tags || [],
      isActive: portConfig?.isActive || false
    };
  });
  selectedPort = 0;
}

// Save port tag to config
function savePortTag(portPath: string, tag: string): void {
  const config = loadConfig() as any || {};
  if (!config.comPorts) {
    config.comPorts = [];
  }

  const existing = config.comPorts.find((p: any) => p.port === portPath);
  if (existing) {
    if (!existing.tags.includes(tag)) {
      existing.tags.push(tag);
    }
  } else {
    config.comPorts.push({
      port: portPath,
      tags: [tag],
      isActive: false
    });
  }

  saveConfig(config);
}

// Remove port tag from config
function removePortTag(portPath: string, tag: string): void {
  const config = loadConfig() as any || {};
  if (!config.comPorts) return;

  const existing = config.comPorts.find((p: any) => p.port === portPath);
  if (existing) {
    existing.tags = existing.tags.filter((t: string) => t !== tag);
    if (existing.tags.length === 0) {
      config.comPorts = config.comPorts.filter((p: any) => p.port !== portPath);
    }
  }

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

// Helper: update progress line only (without full screen refresh)
function updateProgressLine(): void {
  // If log is shown, need full render to update log content
  if (showFlashLog) {
    renderScreen();
    return;
  }

  const spinner = getSpinner();
  const statusText = getFlashStatusText(flashStatus);
  const statusColor = flashStatus === 'completed' ? '\x1b[32m' : flashStatus === 'error' ? '\x1b[31m' : '\x1b[33m';
  // Progress is on line 5: (header line 1-3, sub-header line 4, progress line 5)
  const line = `\x1b[5H\x1b[2K${spinner} ${flashProgress}% ${statusColor}${statusText}\x1b[0m`;
  process.stdout.write(line);
}

// Helper: get flash status text
function getFlashStatusText(status: string): string {
  switch (status) {
    case 'idle': return 'Preparing...';
    case 'started': return 'Initializing...';
    case 'downloading': return 'Downloading...';
    case 'completed': return 'Completed!';
    case 'error': return 'Error!';
    default: return '';
  }
}

// Get progress patterns for platform
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

// Flash firmware with progress updates for TUI
async function flashFirmwareWithProgress(firmwarePath: string): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
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

      // Check download mode
      if (platformConfig?.serial?.autoEnterDlMode) {
        const dlPort = await findDownloadPort(platformKey);
        if (!dlPort) {
          await enterDownloadMode(platformKey || firmwareInfo.type, false, 2);
        }
      }

      const settings = getGlobalSettings();
      const port = settings.defaultPort || 'auto';
      const toolArgs = buildToolArgs(firmwareInfo.type, 'flash', {
        firmwarePath: firmwarePath,
        port: port
      });

      const cmdStr = `"${toolPath}" ${toolArgs.join(' ')}`;
      const command = 'cmd';
      const args = ['/c', cmdStr];

      flashLogBuffer.push(`Executing: ${cmdStr}`);
      flashStatus = 'started';
      flashProgress = 5;
      renderScreen(); // Initial render

      const child = spawn(command, args, {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let downloadComplete = false;
      let hasStarted = false;
      const patterns = getProgressPatterns(firmwareInfo.type);

      // Get download duration for progress estimation
      const platformDuration = platformConfig?.downloadDuration || 30000;
      const startTime = Date.now();

      // Progress estimation timer - only update progress line
      const progressTimer = setInterval(() => {
        if (!downloadComplete && flashStatus === 'downloading') {
          const elapsed = Date.now() - startTime;
          const estimatedProgress = 5 + Math.min(90, (elapsed / platformDuration) * 90);
          if (estimatedProgress > flashProgress) {
            flashProgress = Math.floor(estimatedProgress);
            updateProgressLine();
          }
        }
      }, 500);

      // Timeout
      const timeout = setTimeout(() => {
        if (!downloadComplete) {
          clearInterval(progressTimer);
          killProcessTree(child, 'SIGKILL');
          flashStatus = 'error';
          flashLogBuffer.push('Timeout - download terminated');
          updateProgressLine();
          reject(new Error('Timeout'));
        }
      }, 60000);

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

        flashLogBuffer.push(output);
        const lowerOutput = output.toLowerCase();

        // Detect status from output - only update progress line
        for (const pattern of patterns.started) {
          if (lowerOutput.includes(pattern.toLowerCase()) && !hasStarted) {
            hasStarted = true;
            flashStatus = 'started';
            flashProgress = 5;
            clearTimeout(timeout);
            updateProgressLine();
            break;
          }
        }

        for (const pattern of patterns.downloading) {
          if (lowerOutput.includes(pattern.toLowerCase())) {
            flashStatus = 'downloading';
            clearTimeout(timeout);
            updateProgressLine();
            break;
          }
        }

        for (const pattern of patterns.completed) {
          if (lowerOutput.includes(pattern.toLowerCase())) {
            flashStatus = 'completed';
            flashProgress = 100;
            downloadComplete = true;
            clearInterval(progressTimer);
            clearTimeout(timeout);
            updateProgressLine();
            break;
          }
        }

        for (const pattern of patterns.error) {
          if (lowerOutput.includes(pattern.toLowerCase())) {
            flashStatus = 'error';
            downloadComplete = true;
            clearInterval(progressTimer);
            clearTimeout(timeout);
            updateProgressLine();
            break;
          }
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        const output = iconvLite.decode(data, 'gbk');
        flashLogBuffer.push(`[ERR] ${output}`);
      });

      child.on('close', (code: number) => {
        clearInterval(progressTimer);
        clearTimeout(timeout);
        downloadComplete = true;

        if (code === 0 && flashStatus !== 'error') {
          flashStatus = 'completed';
          flashProgress = 100;
        } else if (flashStatus !== 'completed') {
          flashStatus = 'error';
        }
        // Final render to show completion/error and allow user interaction
        renderScreen();
        resolve();
      });

      child.on('error', (err: Error) => {
        clearInterval(progressTimer);
        clearTimeout(timeout);
        flashStatus = 'error';
        flashLogBuffer.push(`Process error: ${err.message}`);
        updateProgressLine();
        reject(err);
      });

    } catch (err) {
      flashStatus = 'error';
      const error = err as Error;
      flashLogBuffer.push(`Error: ${error.message}`);
      renderScreen();
      reject(err);
    }
  });
}

function renderScreen(): void {
  process.stdout.write('\x1b[?25l'); // Hide cursor
  process.stdout.write('\x1b[2J\x1b[H'); // Clear screen

  const workspace = findWorkspacePath() || 'not found';
  // Extract only the last folder name for display
  const workspaceName = workspace !== 'not found' ? workspace.split(/[\\/]/).pop() || workspace : 'not found';
  const config = loadConfig() as any || {};
  const termWidth = getTerminalWidth();

  let lines: string[] = [];

  // Header - centered title with emoji (emoji takes 2 display columns)
  const title = '🕊 Dove TUI';
  const titleWidth = 11;
  const padding = Math.floor((termWidth - titleWidth) / 2);

  lines.push('\x1b[36m' + '─'.repeat(termWidth) + '\x1b[0m');
  lines.push('\x1b[1m\x1b[36m' + ' '.repeat(padding) + title + ' '.repeat(termWidth - padding - titleWidth) + '\x1b[0m');
  lines.push('\x1b[36m' + '─'.repeat(termWidth) + '\x1b[0m');

  if (currentView === 'main') {
    lines.push('\x1b[1m\x1b[36mWhat would you like to do?\x1b[0m');
    menuItems.forEach((item, i) => {
      const isSelected = i === selectedMenu;
      const prefix = isSelected ? '\x1b[36m❯\x1b[0m ' : '  ';
      const color = isSelected ? '\x1b[1m\x1b[36m' : '';
      lines.push(`${prefix}${color}${i + 1}. ${item.label}\x1b[0m`);
    });
    lines.push('');
    lines.push('\x1b[2m↑/↓ navigate | Enter select | Q quit\x1b[0m');
  } else if (currentView === 'build') {
    lines.push('\x1b[1m\x1b[36mBuild Commands\x1b[0m');
    if (isExecuting) {
      lines.push('\x1b[33m⏳ Building...\x1b[0m');
      lines.push('\x1b[2mPlease wait...\x1b[0m');
    } else if (buildCommands.length > 0) {
      lines.push(`Found ${buildCommands.length} build command(s):`);
      buildCommands.slice(0, 8).forEach((cmd, i) => {
        const mark = i === selectedBuild ? '\x1b[36m❯\x1b[0m' : ' ';
        const active = cmd.isActive ? '\x1b[32m *\x1b[0m' : '';
        lines.push(` ${mark} ${i + 1}. ${cmd.name}: ${cmd.command}${active}`);
      });
      if (buildCommands.length > 8) {
        lines.push(`   ... and ${buildCommands.length - 8} more`);
      }
      lines.push('');
      lines.push('\x1b[2m[↑/↓] navigate | [1-8] select | [Enter] build | [Esc] back\x1b[0m');
    } else {
      lines.push('\x1b[2mNo build commands configured\x1b[0m');
      lines.push('\x1b[2mAdd commands in dove.json | [Esc] back\x1b[0m');
    }
  } else if (currentView === 'flash') {
    lines.push('\x1b[1m\x1b[36mFlash Firmware\x1b[0m');
    if (isExecuting) {
      // Show progress during execution
      const spinner = spinnerChars[spinnerIndex];
      const statusText = getFlashStatusText(flashStatus);
      const statusColor = flashStatus === 'completed' ? '\x1b[32m' : flashStatus === 'error' ? '\x1b[31m' : '\x1b[33m';
      lines.push(`${spinner} ${flashProgress}% ${statusColor}${statusText}\x1b[0m`);

      // Show log if enabled (Ctrl+O)
      if (showFlashLog && flashLogBuffer.length > 0) {
        lines.push('');
        lines.push('\x1b[2m─── Output Log (Ctrl+O to hide) ───\x1b[0m');
        flashLogBuffer.slice(-10).forEach(line => {
          lines.push('\x1b[2m' + truncate(line, termWidth - 4) + '\x1b[0m');
        });
      }
      lines.push('');
      lines.push('\x1b[2m[Ctrl+O] toggle log | [Esc] cancel\x1b[0m');
    } else if (firmwareList.length > 0) {
      lines.push(`Found ${firmwareList.length} firmware(s):`);
      firmwareList.slice(0, 8).forEach((fw, i) => {
        const mark = i === selectedFirmware ? '\x1b[36m❯\x1b[0m' : ' ';
        const rec = i === 0 ? '\x1b[32m *\x1b[0m' : '';
        lines.push(` ${mark} ${i + 1}. ${fw.name} (${fw.type}) ${formatSize(fw.size)}${rec}`);
      });
      if (firmwareList.length > 8) {
        lines.push(`   ... and ${firmwareList.length - 8} more`);
      }
      lines.push('');
      lines.push('\x1b[2m[↑/↓] navigate | [1-8] select | [Enter] flash | [R] refresh | [Esc] back\x1b[0m');
    } else {
      lines.push('\x1b[2mNo firmware found\x1b[0m');
      lines.push('\x1b[2m[R] refresh | [Esc] back\x1b[0m');
    }
  } else if (currentView === 'ports') {
    lines.push('\x1b[1m\x1b[36mSerial Ports\x1b[0m');
    if (portList.length > 0) {
      lines.push(`Found ${portList.length} port(s):`);
      // Calculate max friendlyName display width for alignment (considering Chinese chars)
      const maxNameWidth = Math.max(35, ...portList.slice(0, 8).map(p => displayWidth(p.friendlyName)));
      portList.slice(0, 8).forEach((port, i) => {
        const mark = i === selectedPort ? '\x1b[36m❯\x1b[0m' : ' ';
        const paddedName = padDisplay(port.friendlyName, maxNameWidth);
        const tags = port.tags.length > 0 ? `\x1b[32m[${port.tags.join(', ')}]\x1b[0m` : '\x1b[2m[未标记]\x1b[0m';
        lines.push(` ${mark} ${i + 1}. ${paddedName} ${tags}`);
      });
      if (portList.length > 8) {
        lines.push(`   ... and ${portList.length - 8} more`);
      }
      lines.push('');
      lines.push('\x1b[2m[↑/↓] navigate | [Enter] edit tag | [R] refresh | [Esc] back\x1b[0m');
    } else {
      lines.push('\x1b[2mNo serial ports found\x1b[0m');
      lines.push('\x1b[2m[R] refresh | [Esc] back\x1b[0m');
    }
  } else if (currentView === 'port-tag') {
    // Port tag edit view
    const port = portList[selectedPort];
    lines.push('\x1b[1m\x1b[36mEdit Port Tag\x1b[0m');
    lines.push(`Port: ${port?.friendlyName || 'Unknown'}`);
    lines.push(`Tags: ${port?.tags.length > 0 ? port.tags.join(', ') : '(none)'}`);
    portTags.forEach((tag, i) => {
      const mark = i === selectedTag ? '\x1b[36m❯\x1b[0m' : ' ';
      const hasTag = port?.tags.includes(tag);
      const check = hasTag ? '\x1b[32m✓\x1b[0m' : ' ';
      lines.push(` ${mark} ${i + 1}. ${tag} ${check}`);
    });
    lines.push('');
    lines.push('\x1b[2m[↑/↓] select tag | [Enter] add/remove | [D] clear all | [Esc] back\x1b[0m');
  } else if (currentView === 'settings') {
    lines.push('\x1b[1m\x1b[36mSettings\x1b[0m');
    settingsItems.forEach((item, i) => {
      const mark = i === selectedSetting ? '\x1b[36m❯\x1b[0m' : ' ';
      let valueStr: string;
      if (item.type === 'ports') {
        // Show port count
        valueStr = `\x1b[2m(${portList.length} ports)\x1b[0m`;
      } else if (item.type === 'array') {
        const value = getConfigValue(config, item.key, item.type);
        valueStr = `\x1b[2m(${value} items)\x1b[0m`;
      } else {
        const value = getConfigValue(config, item.key, item.type);
        valueStr = value ? `\x1b[2m${truncate(value, 30)}\x1b[0m` : '\x1b[2m(not set)\x1b[0m';
      }
      lines.push(` ${mark} ${i + 1}. ${item.label}: ${valueStr}`);
    });
    lines.push('');
    lines.push('\x1b[2m[↑/↓] navigate | [1-4] select | [Enter] edit | [Esc] back\x1b[0m');
  } else if (currentView === 'settings-detail') {
    lines.push('\x1b[1m\x1b[36mSetting Detail\x1b[0m');
    if (outputBuffer.length > 0) {
      outputBuffer.slice(-10).forEach(line => {
        lines.push(line);
      });
    }
    lines.push('');
    lines.push('\x1b[2m[Enter/Esc] back\x1b[0m');
  } else if (currentView === 'settings-edit') {
    const item = settingsItems.find(s => s.key === editingSettingKey);
    lines.push('\x1b[1m\x1b[36mEdit: ' + (item?.label || 'Value') + '\x1b[0m');
    lines.push('\x1b[2mCurrent: ' + (config[editingSettingKey] || '(not set)') + '\x1b[0m');
    lines.push('New value: ' + editInputBuffer + '\x1b[5m_\x1b[0m');
    lines.push('');
    lines.push('\x1b[2m[Enter] save | [Esc] cancel\x1b[0m');
  }

  // Status bar with box lines
  lines.push('');
  lines.push('\x1b[36m' + '─'.repeat(termWidth) + '\x1b[0m');
  lines.push(`\x1b[2mWorkspace: ${workspaceName}\x1b[0m`);

  // Output
  lines.forEach((line, idx) => {
    process.stdout.write(`\x1b[${idx + 1}H${line}`);
  });
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
          // Ports and port-tag views return to settings
          if (currentView === 'ports' || currentView === 'port-tag' || currentView === 'settings-edit') {
            currentView = 'settings';
            editInputBuffer = '';
            editingSettingKey = '';
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
          selectedMenu = Math.max(0, selectedMenu - 1);
          renderScreen();
        } else if (input === '\x1b[B') { // Down
          selectedMenu = Math.min(menuItems.length - 1, selectedMenu + 1);
          renderScreen();
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
            } else if (item.action === 'settings') {
              await loadPortList();  // Preload ports for Settings display
            }
            renderScreen();
          }
        } else if (input >= '1' && input <= '4') {
          // Number keys for menu selection
          const idx = parseInt(input) - 1;
          if (idx >= 0 && idx < menuItems.length) {
            selectedMenu = idx;
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
              } else if (item.action === 'settings') {
                await loadPortList();  // Preload ports for Settings display
              }
              renderScreen();
            }
          }
        }
      } else if (currentView === 'flash') {
        // Flash view - firmware selection
        if (isExecuting) {
          // During execution, handle Ctrl+O to toggle log
          if (input === '\x0f') { // Ctrl+O
            showFlashLog = !showFlashLog;
            renderScreen();
          }
        } else {
          if (input === 'r' || input === 'R') {
            await loadFirmwareList();
            renderScreen();
          } else if (input === '\x1b[A') { // Up
            selectedFirmware = Math.max(0, selectedFirmware - 1);
            renderScreen();
          } else if (input === '\x1b[B') { // Down
            selectedFirmware = Math.min(Math.min(8, firmwareList.length) - 1, selectedFirmware + 1);
            renderScreen();
          } else if (input >= '1' && input <= '8') {
            // Number keys to select firmware
            const idx = parseInt(input) - 1;
            if (idx >= 0 && idx < Math.min(8, firmwareList.length)) {
              selectedFirmware = idx;
              renderScreen();
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
              } catch (err) {
                // Error already handled
              }
              isExecuting = false;
              renderScreen();
            }
          }
        }
      } else if (currentView === 'build') {
        // Build view - command selection
        if (!isExecuting) {
          if (input === '\x1b[A') { // Up
            selectedBuild = Math.max(0, selectedBuild - 1);
            renderScreen();
          } else if (input === '\x1b[B') { // Down
            selectedBuild = Math.min(Math.min(8, buildCommands.length) - 1, selectedBuild + 1);
            renderScreen();
          } else if (input >= '1' && input <= '8') {
            // Number keys to select command
            const idx = parseInt(input) - 1;
            if (idx >= 0 && idx < Math.min(8, buildCommands.length)) {
              selectedBuild = idx;
              renderScreen();
            }
          } else if (input === '\r' || input === '\n') {
            // Enter to execute selected command
            if (buildCommands.length > 0) {
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
          }
        }
      } else if (currentView === 'ports') {
        // Ports view
        if (!isExecuting) {
          if (input === 'r' || input === 'R') {
            await loadPortList();
            renderScreen();
          } else if (input === '\x1b[A') { // Up
            selectedPort = Math.max(0, selectedPort - 1);
            renderScreen();
          } else if (input === '\x1b[B') { // Down
            selectedPort = Math.min(Math.min(8, portList.length) - 1, selectedPort + 1);
            renderScreen();
          } else if (input >= '1' && input <= '8') {
            const idx = parseInt(input) - 1;
            if (idx >= 0 && idx < Math.min(8, portList.length)) {
              selectedPort = idx;
              renderScreen();
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
          selectedTag = Math.max(0, selectedTag - 1);
          renderScreen();
        } else if (input === '\x1b[B') { // Down
          selectedTag = Math.min(portTags.length - 1, selectedTag + 1);
          renderScreen();
        } else if (input >= '1' && input <= '3') {
          const idx = parseInt(input) - 1;
          if (idx >= 0 && idx < portTags.length) {
            selectedTag = idx;
            renderScreen();
          }
        } else if (input === '\r' || input === '\n') {
          // Add or remove selected tag
          const tag = portTags[selectedTag];
          if (port.tags.includes(tag)) {
            removePortTag(port.path, tag);
          } else {
            savePortTag(port.path, tag);
          }
          // Reload port list to reflect changes
          await loadPortList();
          currentView = 'ports';
          renderScreen();
        } else if (input === 'd' || input === 'D') {
          // Clear all tags for this port
          const config = loadConfig() as any || {};
          if (config.comPorts) {
            config.comPorts = config.comPorts.filter((p: any) => p.port !== port.path);
            saveConfig(config);
          }
          await loadPortList();
          currentView = 'ports';
          renderScreen();
        }
      } else if (currentView === 'settings') {
        // Settings view - navigation
        if (input === '\x1b[A') { // Up
          selectedSetting = Math.max(0, selectedSetting - 1);
          renderScreen();
        } else if (input === '\x1b[B') { // Down
          selectedSetting = Math.min(settingsItems.length - 1, selectedSetting + 1);
          renderScreen();
        } else if (input >= '1' && input <= '4') {
          // Number keys to select setting
          const idx = parseInt(input) - 1;
          if (idx >= 0 && idx < settingsItems.length) {
            selectedSetting = idx;
            renderScreen();
          }
        } else if (input === '\r' || input === '\n') {
          // Enter to show/edit setting
          const item = settingsItems[selectedSetting];
          if (item.type === 'ports') {
            // Enter Ports configuration view
            await loadPortList();
            currentView = 'ports';
            renderScreen();
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
              outputBuffer.push(`\x1b[1m${item.label} (${arr.length} items):\x1b[0m`);
              arr.forEach((elem: any, i: number) => {
                const str = typeof elem === 'object' ? JSON.stringify(elem) : String(elem);
                outputBuffer.push(`  ${i + 1}. ${truncate(str, 40)}`);
              });
              if (arr.length === 0) {
                outputBuffer.push('  \x1b[2m(empty)\x1b[0m');
              }
            } else {
              outputBuffer.push(`\x1b[1m${item.label}:\x1b[0m`);
              outputBuffer.push(`  ${value || '\x1b[2m(not set)\x1b[0m'}`);
            }
            outputBuffer.push('');
            outputBuffer.push('\x1b[2mEdit in dove.json file\x1b[0m');
            currentView = 'settings-detail';
            renderScreen();
          }
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
        } else if (input.length === 1 && input.charCodeAt(0) >= 32) {
          // Regular character input
          editInputBuffer += input;
          renderScreen();
        }
      }
    });
  }

  // Keep running
  await new Promise(() => {});
}