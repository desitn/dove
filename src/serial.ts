import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import { execSync } from 'child_process';
import fs from 'fs';
import type { Writable } from 'stream';
import type {
  SerialPortInfo,
  PortListInfo,
  DownloadPortInfo,
  ATCommandResult,
  EnterDownloadModeResult,
  MonitorOptions,
  MonitorResult,
  PlatformSerialConfig,
  ComPortConfig,
  PortTag
} from './types';
import { loadToolsConfig, loadConfig } from './utils';

/**
 * Get tag from port config
 */
function getPortTag(portConfig: ComPortConfig): PortTag | null {
  return portConfig.tag || null;
}

interface PortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  locationId?: string;
  vendorId?: string;
  productId?: string;
  friendlyName?: string;
}

/**
 * List all serial ports
 */
export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  try {
    const ports = await SerialPort.list();
    return ports.map((port: PortInfo) => {
      const friendlyName = (port as any).friendlyName || port.path;
      const fullDesc = [
        port.pnpId || '',
        port.manufacturer || '',
        friendlyName
      ].join(' ').trim();

      return {
        path: port.path,
        manufacturer: port.manufacturer || 'Unknown',
        friendlyName: friendlyName,
        fullDescription: fullDesc
      };
    });
  } catch (error) {
    const err = error as Error;
    console.error('Failed to list serial ports:', err.message);
    return [];
  }
}

/**
 * Get platform download port configuration
 */
function getDownloadPortConfig(platform: string | null): PlatformSerialConfig | null {
  const config = loadToolsConfig();
  const platformConfig = config.platforms?.[platform || ''];
  return platformConfig?.serial || null;
}

/**
 * Find download port
 */
export async function findDownloadPort(platform: string | null = null): Promise<DownloadPortInfo | null> {
  try {
    const ports = await SerialPort.list();
    const serialConfig = platform ? getDownloadPortConfig(platform) : null;
    const patterns = serialConfig?.downloadPortPatterns || ['download'];
    const vidPidList = serialConfig?.downloadPortVidPid || [];
    
    for (const port of ports) {
      const descriptions = [
        port.pnpId || '',
        port.manufacturer || '',
        (port as PortInfo).friendlyName || ''
      ].join(' ').toLowerCase();
      
      let isDownloadPort = false;
      
      for (const pattern of patterns) {
        if (descriptions.includes(pattern.toLowerCase())) {
          isDownloadPort = true;
          break;
        }
      }
      
      if (!isDownloadPort && vidPidList && vidPidList.length > 0) {
        for (const { vid, pid } of vidPidList) {
          if (port.vendorId?.toLowerCase() === vid.toLowerCase() && 
              port.productId?.toLowerCase() === pid.toLowerCase()) {
            isDownloadPort = true;
            break;
          }
        }
      }
      
      if (isDownloadPort) {
        return {
          path: port.path,
          description: (port.pnpId || port.manufacturer || 'Download Port').trim(),
          vendorId: port.vendorId || null,
          productId: port.productId || null,
          type: 'serial'
        };
      }
    }
    
    const busDevice = await findDownloadBusDevice(platform);
    if (busDevice) {
      return busDevice;
    }
    
    return null;
  } catch (error) {
    const err = error as Error;
    console.error('Failed to find download port:', err.message);
    return null;
  }
}

/**
 * Find download bus device
 */
async function findDownloadBusDevice(platform: string | null = null): Promise<DownloadPortInfo | null> {
  if (process.platform !== 'win32') {
    return null;
  }
  
  try {
    const serialConfig = platform ? getDownloadPortConfig(platform) : null;
    const busVidPidList = serialConfig?.downloadBusVidPid || [];
    const patterns = serialConfig?.downloadPortPatterns || ['download'];
    
    const command = 'wmic path Win32_PnPEntity where "Name like \'%USB%\' OR Name like \'%Quectel%\'" get Name';
    const output = execSync(command, { encoding: 'utf8', timeout: 5000 });
    const lines = output.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.includes('Name')) continue;
      
      const lowerLine = trimmedLine.toLowerCase();
      
      for (const pattern of patterns) {
        if (lowerLine.includes(pattern.toLowerCase())) {
          return {
            path: 'BUS',
            description: trimmedLine,
            vendorId: null,
            productId: null,
            type: 'bus'
          };
        }
      }
      
      for (const { vid, pid } of busVidPidList) {
        const vidPattern = vid.toUpperCase();
        const pidPattern = pid.toUpperCase();
        
        if (trimmedLine.toUpperCase().includes(vidPattern) && 
            trimmedLine.toUpperCase().includes(pidPattern)) {
          return {
            path: 'BUS',
            description: trimmedLine,
            vendorId: vid,
            productId: pid,
            type: 'bus'
          };
        }
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Find AT port
 */
export async function findATPort(platform: string | null = null): Promise<DownloadPortInfo | null> {
  try {
    const ports = await SerialPort.list();
    const serialConfig = platform ? getDownloadPortConfig(platform) : null;
    const patterns = serialConfig?.atPortPatterns || ['at port', 'modem'];
    
    let atPort: DownloadPortInfo | null = null;
    let fallbackPort: DownloadPortInfo | null = null;
    
    for (const port of ports) {
      const descriptions = [
        port.pnpId || '',
        port.manufacturer || '',
        (port as PortInfo).friendlyName || ''
      ].join(' ').toLowerCase();
      
      for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i].toLowerCase();
        if (descriptions.includes(pattern)) {
          const portInfo: DownloadPortInfo = {
            path: port.path,
            description: (port.pnpId || port.manufacturer || 'AT Port').trim(),
            vendorId: port.vendorId || null,
            productId: port.productId || null,
            type: 'serial'
          };
          
          if (i === 0) {
            atPort = portInfo;
            break;
          } else if (!fallbackPort) {
            fallbackPort = portInfo;
          }
        }
      }
      
      if (atPort) break;
    }
    
    return atPort || fallbackPort;
  } catch (error) {
    const err = error as Error;
    console.error('Failed to find AT port:', err.message);
    return null;
  }
}

/**
 * Open serial port
 */
function openSerialPort(path: string, baudRate: number = 115200): Promise<SerialPort> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: path,
      baudRate: baudRate,
      dataBits: 8,
      parity: 'none' as const,
      stopBits: 1,
      autoOpen: false
    });
    
    port.open((err) => {
      if (err) {
        reject(new Error(`Failed to open serial port ${path}: ${err.message}`));
      } else {
        resolve(port);
      }
    });
  });
}

/**
 * Send AT command and wait for response
 */
export async function sendATCommand(
  portPath: string,
  command: string,
  timeout: number = 2000
): Promise<ATCommandResult> {
  const port = await openSerialPort(portPath);
  
  return new Promise((resolve, reject) => {
    let response = '';
    let timeoutId: NodeJS.Timeout | undefined;
    
    const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
    
    parser.on('data', (line: string) => {
      response += line + '\n';
      
      if (line.includes('OK')) {
        if (timeoutId) clearTimeout(timeoutId);
        port.close(() => {
          resolve({ success: true, response: response.trim() });
        });
      } else if (line.includes('ERROR')) {
        if (timeoutId) clearTimeout(timeoutId);
        port.close(() => {
          resolve({ success: false, response: response.trim() });
        });
      }
    });
    
    timeoutId = setTimeout(() => {
      port.close(() => {
        resolve({ success: null, response: response.trim(), timeout: true });
      });
    }, timeout);
    
    port.write(command + '\r\n', (err) => {
      if (err) {
        if (timeoutId) clearTimeout(timeoutId);
        port.close(() => {
          reject(new Error(`Failed to send command: ${err.message}`));
        });
      }
    });
    
    port.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(new Error(`Serial port error: ${err.message}`));
    });
  });
}

/**
 * Send AT command with enhanced result for CLI
 */
export async function sendATCommandCLI(
  portPath: string,
  command: string,
  timeout: number = 5000
): Promise<ATCommandResult & { port: string; duration: number }> {
  const startTime = Date.now();
  const result = await sendATCommand(portPath, command, timeout);
  const duration = Date.now() - startTime;
  
  return {
    ...result,
    port: portPath,
    duration
  };
}

/**
 * Enter download mode
 */
export async function enterDownloadMode(
  platform: string = 'asr160x',
  force: boolean = false,
  timeout: number = 2
): Promise<EnterDownloadModeResult> {
  console.log('Enter Download Mode Tool');
  console.log('='.repeat(50));
  console.log(`Platform: ${platform}, Force: ${force}, Timeout: ${timeout}s`);
  
  const config = loadToolsConfig();
  const serialConfig = config.platforms?.[platform]?.serial || null;
  
  if (!serialConfig) {
    console.log(`Platform ${platform} has no serial config, skip enter download mode`);
    return { success: true, skipped: true, reason: 'No serial config' };
  }
  
  const dlPort = await findDownloadPort(platform);
  if (dlPort) {
    console.log(`Device already in download mode: ${dlPort.path}`);
    console.log(`   Description: ${dlPort.description}`);
    return { success: true, port: dlPort.path, alreadyInMode: true };
  }
  
  console.log('Searching AT port...');
  const atPort = await findATPort(platform);
  if (!atPort) {
    console.error('AT port not found');
    return { success: false, error: 'AT port not found' };
  }
  
  console.log(`Found AT port: ${atPort.path}`);
  console.log(`   Description: ${atPort.description}`);
  
  let atCommand = serialConfig.atCommand;
  if (force && serialConfig.atCommandForce) {
    atCommand = serialConfig.atCommandForce;
  }
  
  console.log(`Sending command: ${atCommand}`);
  
  try {
    const result = await sendATCommand(atPort.path, atCommand, timeout * 1000);
    
    console.log(`Response:\n${result.response}`);
    
    if (result.success === true) {
      console.log('Command executed successfully');
    } else if (result.success === false) {
      console.log('Command execution failed');
      return { success: false, error: 'AT command returned ERROR' };
    } else if (result.timeout) {
      console.log('Response timeout: module may be restarting');
    }
    
    console.log('Checking download port...');
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const newDlPort = await findDownloadPort();
      if (newDlPort) {
        console.log(`Successfully entered download mode: ${newDlPort.path}`);
        return { success: true, port: newDlPort.path };
      }
      console.log(`   Checking ${i + 1}/10...`);
    }
    
    console.error('Download port not detected');
    return { success: false, error: 'Download port not detected' };
    
  } catch (error) {
    const err = error as Error;
    console.error('Failed to send command:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Show serial port list
 */
export async function showSerialList(options: { json?: boolean; plain?: boolean } = {}): Promise<PortListInfo[] | string> {
  const ports = await listSerialPorts();

  // Load user-defined tags from dove.json
  const config = loadConfig() as any || {};
  const comPorts = config.comPorts || [];

  // Merge tags into port info, then filter out Invalid ports and COM1
  const portsWithTags = ports.map(port => {
    const portConfig = comPorts.find((p: ComPortConfig) => p.port === port.path);
    return {
      path: port.path,
      tag: portConfig ? getPortTag(portConfig) : null,
      friendlyName: port.friendlyName
    };
  }).filter(port => port.tag !== 'Invalid' && port.path !== 'COM1');

  if (options.json) {
    console.log(JSON.stringify({ ports: portsWithTags, count: portsWithTags.length }, null, 2));
    return portsWithTags;
  }

  // Plain format for TUI - show friendly name with tag
  if (options.plain) {
    if (portsWithTags.length === 0) {
      return 'No serial ports found';
    }
    const lines: string[] = [];
    lines.push(`Found ${portsWithTags.length} port(s):`);
    portsWithTags.forEach((port, index) => {
      const tagStr = port.tag ? ` [${port.tag}]` : '';
      lines.push(`  ${index + 1}. ${port.friendlyName}${tagStr}`);
    });
    return lines.join('\n');
  }

  console.log('Serial Port List');
  console.log('='.repeat(70));

  if (portsWithTags.length === 0) {
    console.log('No serial ports found');
    return portsWithTags;
  }

  console.log(`Found ${portsWithTags.length} serial port(s):\n`);

  portsWithTags.forEach((port, index) => {
    const tagStr = port.tag ? ` [${port.tag}]` : '';
    console.log(`${index + 1}. ${port.path}${tagStr}`);
    console.log(`   Description: ${port.friendlyName}`);
    console.log('-'.repeat(70));
  });

  return portsWithTags;
}

/**
 * Open serial port and monitor data
 */
export async function openAndMonitorPort(
  portPath: string,
  options: Partial<MonitorOptions> = {}
): Promise<MonitorResult> {
  const config: MonitorOptions = {
    baudRate: options.baudRate || 115200,
    dataBits: options.dataBits,
    parity: options.parity as any,
    stopBits: options.stopBits as any,
    timeout: options.timeout || 0,
    output: options.output,
    append: options.append || false,
    include: options.include,
    exclude: options.exclude,
    until: options.until,
    untilRegex: options.untilRegex,
    lines: options.lines || 0,
    json: options.json || false,
    timestamp: options.timestamp || false
  };

  let fileStream: Writable | null = null;
  if (config.output) {
    const flags = config.append ? 'a' : 'w';
    fileStream = fs.createWriteStream(config.output, { flags });
  }

  if (!config.json) {
    console.log(`Opening serial port: ${portPath}`);
    console.log(`   Baud rate: ${config.baudRate}`);
    if (config.output) console.log(`   Output file: ${config.output}${config.append ? ' (append)' : ''}`);
    if (config.include) console.log(`   Include filter: ${config.include}`);
    if (config.exclude) console.log(`   Exclude filter: ${config.exclude}`);
    if (config.until) console.log(`   Exit condition: "${config.until}"`);
    if (config.untilRegex) console.log(`   Exit regex: ${config.untilRegex}`);
    if (config.lines > 0) console.log(`   Capture lines: ${config.lines}`);
    if (config.timeout > 0) console.log(`   Timeout: ${config.timeout}ms`);
    console.log('='.repeat(50));
  }

  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: portPath,
      baudRate: config.baudRate,
      dataBits: config.dataBits || 8,
      parity: (config.parity as any) || 'none',
      stopBits: (config.stopBits as any) || 1,
      autoOpen: false
    });

    let receivedData = '';
    let filteredData = '';
    let lineCount = 0;
    let byteCount = 0;
    const startTime = Date.now();
    let timeoutId: NodeJS.Timeout | undefined;
    let buffer = '';

    const writeToFile = (data: string): void => {
      if (fileStream) {
        fileStream.write(data);
      }
    };

    const shouldInclude = (line: string): boolean => {
      if (config.include) {
        const keywords = config.include.split(',').map((s: string) => s.trim());
        const hasInclude = keywords.some((keyword: string) => line.includes(keyword));
        if (!hasInclude) return false;
      }
      if (config.exclude) {
        const keywords = config.exclude.split(',').map((s: string) => s.trim());
        const hasExclude = keywords.some((keyword: string) => line.includes(keyword));
        if (!hasExclude) return false;
      }
      return true;
    };

    const checkExitCondition = (line: string): boolean => {
      if (config.until && line.includes(config.until)) {
        return true;
      }
      if (config.untilRegex && config.untilRegex.test(line)) {
        return true;
      }
      return false;
    };

    port.open((err) => {
      if (err) {
        if (fileStream) fileStream.end();
        reject(new Error(`Failed to open serial port ${portPath}: ${err.message}`));
        return;
      }

      if (!config.json) {
        console.log('Serial port opened, receiving data...');
        if (!config.output) console.log('   Press Ctrl+C to stop monitoring\n');
        else console.log('');
      }

      if (config.timeout > 0) {
        timeoutId = setTimeout(() => {
          if (!config.json) console.log('\nMonitoring timeout, closing serial port');
          port.close();
        }, config.timeout);
      }
    });

    port.on('data', (data: Buffer) => {
      const chunk = data.toString('utf8');
      receivedData += chunk;
      byteCount += chunk.length;
      buffer += chunk;

      let lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (let line of lines) {
        line = line.replace(/\r$/, '');
        lineCount++;

        let outputLine = line;
        if (config.timestamp) {
          const ts = new Date().toISOString();
          outputLine = `[${ts}] ${line}`;
        }

        if (shouldInclude(line)) {
          filteredData += outputLine + '\n';
          writeToFile(outputLine + '\n');
          if (!config.output) {
            process.stdout.write(outputLine + '\n');
          }
        }

        if (checkExitCondition(line)) {
          if (!config.json) console.log('\nExit condition matched, closing serial port');
          port.close();
          return;
        }

        if (config.lines > 0 && lineCount >= config.lines) {
          if (!config.json) console.log(`\nReached ${config.lines} lines, closing serial port`);
          port.close();
          return;
        }
      }
    });

    port.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (fileStream) fileStream.end();
      reject(new Error(`Serial port error: ${err.message}`));
    });

    port.on('close', () => {
      if (timeoutId) clearTimeout(timeoutId);
      
      if (buffer.length > 0) {
        const line = buffer.replace(/\r$/, '');
        lineCount++;
        let outputLine = line;
        if (config.timestamp) {
          const ts = new Date().toISOString();
          outputLine = `[${ts}] ${line}`;
        }
        if (shouldInclude(line)) {
          filteredData += outputLine + '\n';
          writeToFile(outputLine + '\n');
        }
      }

      const duration = Date.now() - startTime;
      
      const finishMonitor = (): void => {
        const result: MonitorResult = {
          success: true,
          port: portPath,
          baudRate: config.baudRate,
          duration: duration,
          stats: {
            bytes: byteCount,
            lines: lineCount,
            filtered: filteredData.split('\n').filter(l => l.length > 0).length
          },
          outputFile: config.output,
          data: receivedData
        };

        if (config.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('\nSerial port closed');
          console.log('='.repeat(50));
          console.log('Monitor summary:');
          console.log(`   Duration: ${(duration / 1000).toFixed(2)}s`);
          console.log(`   Total bytes: ${byteCount}`);
          console.log(`   Total lines: ${lineCount}`);
          if (config.include || config.exclude) {
            console.log(`   Filtered lines: ${result.stats.filtered}`);
          }
          if (config.output) {
            console.log(`   Output file: ${config.output}`);
          }
        }

        resolve(result);
      };

      if (fileStream) {
        fileStream.end(() => {
          finishMonitor();
        });
      } else {
        finishMonitor();
      }
    });

    process.on('SIGINT', () => {
      if (!config.json) console.log('\n\nReceived interrupt signal, closing serial port...');
      if (port.isOpen) {
        port.close();
      }
    });
  });
}