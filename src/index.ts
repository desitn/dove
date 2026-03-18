#!/usr/bin/env node

import { flashFirmware, listDevices } from './flash';
import { listFirmware } from './list';
import { compileFirmware, setConfig, showConfig } from './compile';
import { loadToolsConfig, loadConfig } from './utils';
import { showSerialList, openAndMonitorPort } from './serial';
import type { MonitorOptions, CLIConfig } from './types';

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
Firmware Compilation and Flashing CLI Tool v1.0.0

Usage:
  firmware-cli.exe <command> [arguments]

Commands:
  flash [path] [options]  Flash firmware (auto-find or specify path)
    --skip-dl-mode, -s  Skip auto entering download mode
  list                 List available firmware
  devices              List USB devices
  serial               List serial port devices
  monitor [options]    Open serial port and monitor data
    -p, --port <port>   Serial port (e.g., COM107, use config default if not specified)
    --baud, -b <rate>   Set baud rate (default 115200)
    --timeout, -t <ms>  Set timeout in milliseconds (default 0 means no timeout)
    --output, -o <file> Output to file
    --append, -a        Append to file (default overwrite)
    --include <keywords> Include keywords (comma separated)
    --exclude <keywords> Exclude keywords (comma separated)
    --until <text>      Exit after receiving this content
    --until-regex <pattern> Exit after regex match
    --lines <n>         Capture n lines then exit
    --json              Output results in JSON format
    --timestamp         Add timestamp to each line
  build [command]       Compile firmware
  build-and-flash       Compile and flash latest firmware
  config                Show current configuration
  config set <key> <value>  Set configuration item
  help                  Show help information

Examples:
  firmware-cli.exe flash
  firmware-cli.exe build
  firmware-cli.exe build-and-flash
  firmware-cli.exe list
  firmware-cli.exe serial
  firmware-cli.exe monitor -p COM9
  firmware-cli.exe monitor -p COM9 -b 9600 -t 5000
  firmware-cli.exe monitor -p COM9 --include "ERROR,WARN" -o errors.log
  firmware-cli.exe monitor -p COM9 --until "Done" -o boot.log
  firmware-cli.exe monitor -p COM9 --lines 100 -o debug.log
  firmware-cli.exe monitor -p COM9 --json --timeout 5000

Configuration file:
  firmware-cli.json (in project root directory)

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
  
  let portPath = getArgValue('-p', '--port');
  let portSource = 'user_input';
  
  if (!portPath) {
    const config = loadConfig() as CLIConfig;
    if (config.defaultComPort) {
      portPath = config.defaultComPort;
      portSource = 'config_default';
    }
  }
  
  if (!portPath) {
    throw new Error('Please specify serial port with -p (e.g., -p COM107), or configure defaultComPort in firmware-cli.json');
  }
  
  const monitorOptions: Partial<MonitorOptions> = {
    baudRate: parseInt(getArgValue('-b', '--baud') || '') || 115200,
    timeout: parseInt(getArgValue('-t', '--timeout') || '') || 0,
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
  
  if (portSource === 'config_default' && !monitorOptions.json) {
    console.log(`\nUsing configured default serial port: ${portPath}\n`);
  }
  
  return { portPath, options: monitorOptions };
}

/**
 * Main function
 */
async function main(): Promise<number> {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  try {
    switch (command) {
      case 'flash': {
        const skipDlMode = args.includes('--skip-dl-mode') || args.includes('-s');
        const firmwarePath = args.find(arg => !arg.startsWith('-')) || null;
        await flashFirmware(firmwarePath, { skipDlMode });
        return 0;
      }
      case 'list':
        await listFirmware();
        return 0;
      case 'devices':
        await listDevices();
        return 0;
      case 'serial':
        await showSerialList();
        return 0;
      case 'monitor': {
        const { portPath, options } = parseMonitorArgs(args);
        await openAndMonitorPort(portPath, options);
        return 0;
      }
      case 'build':
        await compileFirmware(args[0] || null);
        return 0;
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
      case 'help':
      case '--help':
      case '-h':
        showHelp();
        return 0;
      default:
        if (!command) {
          showHelp();
          return 0;
        } else {
          console.error('Error:', `Unknown command: ${command}`);
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