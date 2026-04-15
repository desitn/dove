import type { FirmwareInfo } from './types';
import { findAllFirmwares, formatSize } from './utils';

interface ListOptions {
  json?: boolean;
  returnResult?: boolean;
  plain?: boolean;  // Plain text format for TUI display
}

/**
 * List available firmwares
 */
export async function listFirmware(options: ListOptions = {}): Promise<FirmwareInfo[] | string> {
  const firmwares = findAllFirmwares();

  if (firmwares.length === 0) {
    const emptyResult = JSON.stringify({ firmwares: [], count: 0, recommended: null });
    if (options.returnResult) {
      return emptyResult;
    }
    if (options.plain) {
      return 'No firmware files found';
    }
    if (options.json) {
      console.log(emptyResult);
    } else {
      console.log('No firmware files found');
      console.log('Hint: Configure dove.json or use flash <path> command');
    }
    return [];
  }

  // Recommend latest firmware
  const sortedFirmwares = firmwares.sort((a, b) => {
    const aIsFactory = a.name.toLowerCase().includes('factory');
    const bIsFactory = b.name.toLowerCase().includes('factory');

    if (aIsFactory && !bIsFactory) return 1;
    if (!aIsFactory && bIsFactory) return -1;

    return b.mtime.getTime() - a.mtime.getTime();
  });

  const latest = sortedFirmwares[0];

  const jsonOutput = {
    firmwares: firmwares.map(fw => ({
      name: fw.name,
      path: fw.path,
      type: fw.type,
      size: fw.size,
      sizeFormatted: formatSize(fw.size),
      time: fw.time
    })),
    count: firmwares.length,
    recommended: {
      name: latest.name,
      path: latest.path,
      type: latest.type
    }
  };

  if (options.returnResult) {
    return JSON.stringify(jsonOutput, null, 2);
  }

  // Plain format for TUI - compact single line display
  if (options.plain) {
    const lines: string[] = [];
    lines.push(`Found ${firmwares.length} firmware(s):`);
    firmwares.forEach((fw, index) => {
      const active = fw.name === latest.name ? ' *' : '';
      lines.push(`  ${index + 1}. ${fw.name} (${fw.type}) ${formatSize(fw.size)}${active}`);
    });
    return lines.join('\n');
  }

  if (options.json) {
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    console.log(`Found ${firmwares.length} firmware(s):`);
    firmwares.forEach((fw, index) => {
      console.log(`${index + 1}. ${fw.name}`);
      console.log(`   Path: ${fw.path}`);
      console.log(`   Type: ${fw.type}`);
      console.log(`   Size: ${formatSize(fw.size)}`);
      console.log(`   Time: ${fw.time}`);
      console.log();
    });

    console.log(`Recommended firmware: ${latest.name}`);
    console.log(`Flash command: dove.exe flash "${latest.path}"`);
  }

  return firmwares;
}
