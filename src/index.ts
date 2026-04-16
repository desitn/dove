#!/usr/bin/env node

import { flashFirmware, listDevices } from './flash';
import { listFirmware } from './list';
import { compileFirmware, listBuildCommands, setConfig, showConfig } from './compile';
import { loadToolsConfig, loadConfig, initWorkspaceConfig } from './utils';
import { showSerialList, openAndMonitorPort, sendATCommandCLI } from './serial';
import type { MonitorOptions, CLIConfig, ComPortConfig, PortTag } from './types';

/**
 * Get tag from port config
 */
function getPortTag(portConfig: ComPortConfig): PortTag | null {
  return portConfig.tag || null;
}

// TUI is optional - dynamic import to avoid bundling issues
async function startTUI(): Promise<void> {
  const { startTUI: tui } = await import('./tui');
  await tui();
}

/**
 * Generate list of supported firmware types (read from JSON config)
 */
function generateSupportedTypes(): string {
  try {
    const config = loadToolsConfig();
    const platforms = config.platforms || {};

    const lines: string[] = [];
    for (const [key, platform] of Object.entries(platforms)) {
      const extensions = platform.extensions || [];
      const extStr = extensions.map(e => `*${e}`).join(', ');
      lines.push(`  - ${platform.description || key}: ${extStr}`);
    }

    return lines.join('\n') || '  - No config';
  } catch (error) {
    const err = error as Error;
    console.error('Config load error:', err.message);
    return '  - Config load failed';
  }
}

/**
 * Show help information
 */
function showHelp(): void {
  const supportedTypes = generateSupportedTypes();

  console.log(`
Dove Firmware Compilation and Flashing CLI Tool v1.0.0

Usage:
  dove.exe <command> [arguments]

Commands:
  tui                   Start interactive TUI mode
  build [options]       Compile firmware (outputs tool result directly)
    --list              List all available commands (JSON output)
    --index <n>         Run command by index (1-based)
    --name <name>       Run command by name
  build-and-flash       Compile and flash latest firmware
  flash [path] [options]  Flash firmware (auto-find or specify path)
    --list, -l          List available firmware files (JSON output)
    --skip-dl-mode, -s  Skip auto entering download mode
    --progress <mode>   Progress display mode (simple/detailed)
  port <subcommand>      Port operations
    list                List serial ports (JSON output)
    monitor [options]   Monitor serial port (output to file recommended)
      --tag <tag>         Select port by tag (default: DBG)
      -p, --port <port>   Specify port manually
      -b, --baud <rate>   Set baud rate (default 115200)
      -t, --timeout <ms>  Timeout in ms (required, minimum 5000)
      -o, --output <file> Output to file (recommended)
      -a, --append        Append to file (default overwrite)
      --include <keywords> Include keywords (comma separated)
      --exclude <keywords> Exclude keywords (comma separated)
      --until <text>      Exit after receiving this content
      --lines <n>         Capture n lines then exit
      --json              Output summary in JSON format
      --timestamp         Add timestamp to each line
    at [options]        Send AT command (JSON output, auto-select AT port)
      -c, --command <cmd> AT command to send (required)
      --tag <tag>         Select port by tag (default: AT)
      -t, --timeout <ms>  Set timeout (default 5000)
  config                Show current configuration (JSON output)
  config set <key> <value>  Set configuration item (JSON output)
  help                  Show help information

Examples:
  dove.exe build              # Run default build command
  dove.exe build --list       # List all build commands (JSON)
  dove.exe flash              # Flash firmware (auto-find)
  dove.exe flash --list       # List available firmware (JSON)
  dove.exe port list          # List ports with tags (JSON)
  dove.exe port monitor --timeout 30000 -o log.txt  # Auto use DBG port
  dove.exe port at -c "ATI"   # Auto use AT port
  dove.exe config             # Show config (JSON)

Configuration file:
  dove.json (in project root directory)

Supported firmware types:
${supportedTypes}
`);
}

/**
 * Parse command line arguments for monitor command
 */
function parseMonitorArgs(args: string[]): { portPath: string; options: Partial<MonitorOptions> } {
  const getArgValue = (short: string | null, long: string): string | null => {
    const index = args.findIndex(arg => arg === short || arg === long);
    return index !== -1 ? args[index + 1] : null;
  };

  const hasFlag = (short: string | null, long: string): boolean => {
    return args.includes(short || '') || args.includes(long);
  };

  const getAvailableTags = (config: CLIConfig): string => {
    if (!config.comPorts || config.comPorts.length === 0) return 'none';
    // Filter out invalid ports, only show valid tags
    const validTags = config.comPorts
      .map(p => getPortTag(p))
      .filter(t => t && t !== 'Invalid');
    return [...new Set(validTags)].join(', ');
  };

  let portPath = getArgValue('-p', '--port');
  let portSource = 'user_input';
  let tag = getArgValue(null, '--tag');

  if (!portPath) {
    const config = loadConfig() as CLIConfig;

    // Priority 1: User specified tag
    if (tag) {
      if (config.comPorts && config.comPorts.length > 0) {
        const portConfig = config.comPorts.find(p => getPortTag(p) === tag);
        if (portConfig) {
          const portTag = getPortTag(portConfig);
          if (portTag === 'Invalid') {
            throw new Error(`Port '${portConfig.port}' is marked as invalid and cannot be used`);
          }
          portPath = portConfig.port;
          portSource = 'config_tag';
        } else {
          throw new Error(`No port found with tag '${tag}'. Available tags: ${getAvailableTags(config)}`);
        }
      } else {
        throw new Error(`No comPorts configured in dove.json. Please configure ports with tags first.`);
      }
    }

    // Priority 2: Use "DBG" tag port as default for monitoring
    if (!portPath && config.comPorts && config.comPorts.length > 0) {
      const dbgPort = config.comPorts.find(p => getPortTag(p) === 'DBG');
      if (dbgPort) {
        portPath = dbgPort.port;
        portSource = 'config_default_tag';
      }
    }
  }

  if (!portPath) {
    throw new Error('Please specify serial port with -p or --tag, or configure a port with "DBG" tag in dove.json');
  }

  const timeoutValue = parseInt(getArgValue('-t', '--timeout') || '') || 0;

  // Timeout constraint: minimum 5000ms required
  if (timeoutValue === 0) {
    throw new Error('Timeout is required. Use --timeout <ms> (minimum 5000, e.g., --timeout 30000)');
  }
  if (timeoutValue < 5000) {
    throw new Error(`Timeout must be at least 5000ms. Current value: ${timeoutValue}ms`);
  }

  const monitorOptions: Partial<MonitorOptions> = {
    baudRate: parseInt(getArgValue('-b', '--baud') || '') || 115200,
    timeout: timeoutValue,
    output: getArgValue('-o', '--output') || undefined,
    append: hasFlag('-a', '--append'),
    include: getArgValue(null, '--include') || undefined,
    exclude: getArgValue(null, '--exclude') || undefined,
    until: getArgValue(null, '--until') || undefined,
    untilRegex: getArgValue(null, '--until-regex') ? new RegExp(getArgValue(null, '--until-regex') || '') : undefined,
    lines: parseInt(getArgValue(null, '--lines') || '') || 0,
    json: hasFlag(null, '--json'),
    timestamp: hasFlag(null, '--timestamp')
  };

  if (portSource !== 'user_input' && !monitorOptions.json) {
    if (portSource === 'config_tag') {
      console.log(`\nUsing port with tag '${tag}': ${portPath}\n`);
    } else if (portSource === 'config_active') {
      console.log(`\nUsing active port: ${portPath}\n`);
    } else {
      console.log(`\nUsing configured default serial port: ${portPath}\n`);
    }
  }

  return { portPath, options: monitorOptions };
}

/**
 * Parse command line arguments for AT command
 */
function parseATArgs(args: string[]): {
  portPath: string | null;
  command: string;
  timeout: number;
  tag?: string;
} {
  const getArgValue = (short: string | null, long: string): string | null => {
    const index = args.findIndex(arg => arg === short || arg === long);
    return index !== -1 ? args[index + 1] : null;
  };

  const command = getArgValue('-c', '--command');
  if (!command) {
    throw new Error('AT command is required. Use -c or --command to specify (e.g., -c "ATI")');
  }

  const tag = getArgValue(null, '--tag');

  return {
    portPath: getArgValue('-p', '--port'),
    command,
    timeout: parseInt(getArgValue('-t', '--timeout') || '') || 5000,
    tag: tag || undefined
  };
}

/**
 * Handle port list command (JSON output)
 */
async function handlePortList(args: string[]): Promise<number> {
  const hasFlag = (flag: string): boolean => args.includes(flag);
  const showUsb = hasFlag('--usb');
  const showSerial = hasFlag('--serial');
  const showAll = hasFlag('--all');

  // Default to serial if no specific flag
  const listSerial = showAll || showSerial || (!showUsb && !showSerial && !showAll);
  const listUsb = showAll || showUsb;

  if (listUsb && listSerial) {
    // Combine both into single JSON output
    await listDevices({ json: true, returnResult: true });
    await showSerialList({ json: true });
  } else if (listUsb) {
    await listDevices({ json: true, returnResult: true });
  } else if (listSerial) {
    await showSerialList({ json: true });
  }

  return 0;
}

/**
 * Handle port monitor command
 */
async function handlePortMonitor(args: string[]): Promise<number> {
  const { portPath, options } = parseMonitorArgs(args);
  await openAndMonitorPort(portPath, options);
  return 0;
}

/**
 * Handle port at command (JSON output)
 */
async function handlePortAt(args: string[]): Promise<number> {
  const { portPath, command, timeout, tag } = parseATArgs(args);

  let actualPortPath = portPath;

  if (!actualPortPath) {
    const config = loadConfig() as CLIConfig;

    // Priority 1: User specified tag
    if (tag) {
      if (config.comPorts && config.comPorts.length > 0) {
        const portConfig = config.comPorts.find(p => getPortTag(p) === tag);
        if (portConfig) {
          const portTag = getPortTag(portConfig);
          if (portTag === 'Invalid') {
            throw new Error(`Port '${portConfig.port}' is marked as invalid and cannot be used`);
          }
          actualPortPath = portConfig.port;
        } else {
          const validTags = config.comPorts
            .map(p => getPortTag(p))
            .filter(t => t && t !== 'Invalid');
          throw new Error(`No port found with tag '${tag}'. Available tags: ${validTags.join(', ')}`);
        }
      } else {
        throw new Error('No comPorts configured in dove.json. Please configure ports with tags first.');
      }
    }

    // Priority 2: Default use "AT" tag port
    if (!actualPortPath && config.comPorts && config.comPorts.length > 0) {
      const atPort = config.comPorts.find(p => getPortTag(p) === 'AT');
      if (atPort) {
        actualPortPath = atPort.port;
      }
    }

    // Priority 3: Error with clear guidance
    if (!actualPortPath) {
      throw new Error('AT port not found. Please configure a port with "AT" tag in dove.json.');
    }
  }

  const result = await sendATCommandCLI(actualPortPath, command, timeout);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

/**
 * Handle port subcommand
 */
async function handlePortCommand(subcommand: string, args: string[]): Promise<number> {
  switch (subcommand) {
    case 'list':
      return await handlePortList(args);
    case 'monitor':
      return await handlePortMonitor(args);
    case 'at':
      return await handlePortAt(args);
    default:
      console.error('Error:', `Unknown port subcommand: ${subcommand}`);
      console.error('Available subcommands: list, monitor, at');
      return 1;
  }
}

/**
 * Main function
 */
async function main(): Promise<number> {
  // Initialize workspace config on startup
  initWorkspaceConfig();

  const command = process.argv[2];
  const args = process.argv.slice(3);

  try {
    switch (command) {
      case 'flash': {
        const hasFlag = (flag: string): boolean => args.includes(flag);

        if (hasFlag('--list') || hasFlag('-l')) {
          await listFirmware({ json: true });
          return 0;
        }

        const skipDlMode = args.includes('--skip-dl-mode') || args.includes('-s');
        const progressIndex = args.findIndex(arg => arg === '--progress');
        const progressMode = progressIndex !== -1 ? args[progressIndex + 1] : null;
        const firmwarePath = args.find(arg => !arg.startsWith('-') && (progressIndex === -1 || args.indexOf(arg) !== progressIndex + 1)) || null;
        await flashFirmware(firmwarePath, { skipDlMode, progressMode });
        return 0;
      }
      case 'port': {
        const subcommand = args[0];
        const subArgs = args.slice(1);
        if (!subcommand) {
          console.error('Error:', 'port requires a subcommand (list, monitor, at)');
          return 1;
        }
        return await handlePortCommand(subcommand, subArgs);
      }
      case 'build': {
        const getArgValue = (long: string): string | null => {
          const index = args.findIndex(arg => arg === long);
          return index !== -1 ? args[index + 1] : null;
        };

        const hasFlag = (long: string): boolean => args.includes(long);

        if (hasFlag('--list')) {
          await listBuildCommands();
          return 0;
        }

        const indexValue = getArgValue('--index');
        if (indexValue) {
          await compileFirmware(indexValue);
          return 0;
        }

        const nameValue = getArgValue('--name');
        if (nameValue) {
          await compileFirmware(nameValue);
          return 0;
        }

        await compileFirmware(null);
        return 0;
      }
      case 'build-and-flash':
        await compileFirmware(args[0] || null);
        await flashFirmware(null);
        return 0;
      case 'config':
        if (args[0] === 'set' && args.length >= 3) {
          await setConfig(args[1], args[2]);
        } else {
          await showConfig();
        }
        return 0;
      case 'tui':
        await startTUI();
        return 0;
      case 'help':
        showHelp();
        return 0;
      default:
        if (!command) {
          showHelp();
          return 0;
        } else {
          console.error('Error:', `Unknown command: ${command}`);
          console.error('Available commands: build, flash, port, config, tui, help');
          return 1;
        }
    }
  } catch (error) {
    const err = error as Error;
    console.error('Error:', err.message);
    return 1;
  }
}

if (require.main === module) {
  main().then(exitCode => {
    process.exit(exitCode);
  }).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { main, showHelp };