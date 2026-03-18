import type { FirmwareInfo } from './types';
import { findAllFirmwares, formatSize } from './utils';

/**
 * List available firmwares
 */
export async function listFirmware(): Promise<FirmwareInfo[]> {
  const firmwares = findAllFirmwares();
  
  if (firmwares.length === 0) {
    console.log('No firmware files found');
    console.log('Hint: Configure firmware-cli.json or use flash <path> command');
    return [];
  }
  
  console.log(`Found ${firmwares.length} firmware(s):`);
  firmwares.forEach((fw, index) => {
    console.log(`${index + 1}. ${fw.name}`);
    console.log(`   Path: ${fw.path}`);
    console.log(`   Type: ${fw.type}`);
    console.log(`   Size: ${formatSize(fw.size)}`);
    console.log(`   Time: ${fw.time}`);
    console.log();
  });
  
  // Recommend latest firmware
  const sortedFirmwares = firmwares.sort((a, b) => {
    const aIsFactory = a.name.toLowerCase().includes('factory');
    const bIsFactory = b.name.toLowerCase().includes('factory');
    
    if (aIsFactory && !bIsFactory) return 1;
    if (!aIsFactory && bIsFactory) return -1;
    
    return b.mtime.getTime() - a.mtime.getTime();
  });
  
  const latest = sortedFirmwares[0];
  console.log(`Recommended firmware: ${latest.name}`);
  console.log(`Flash command: firmware-cli.exe flash "${latest.path}"`);
  
  return firmwares;
}