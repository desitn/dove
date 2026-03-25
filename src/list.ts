import type { FirmwareInfo } from './types';
import { findAllFirmwares, formatSize } from './utils';

interface ListOptions {
  json?: boolean;
}

/**
 * List available firmwares
 */
export async function listFirmware(options: ListOptions = {}): Promise<FirmwareInfo[]> {
  const firmwares = findAllFirmwares();
  
  if (firmwares.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ firmwares: [], count: 0, recommended: null }));
    } else {
      console.log('No firmware files found');
      console.log('Hint: Configure firmware-cli.json or use flash <path> command');
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
  
  if (options.json) {
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
    console.log(`Flash command: firmware-cli.exe flash "${latest.path}"`);
  }
  
  return firmwares;
}
