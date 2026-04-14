/**
 * Dove GUI - Electron Main Process
 * @author: destin.zhang@quectel.com
 */

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const iconv = require('iconv-lite');

let win;
let configPath;

/**
 * Get dove.exe path
 */
function getDovePath() {
    // In development: ../dove.exe
    // In production: resources/dove.exe
    const devPath = path.join(__dirname, '../dove.exe');
    const prodPath = path.join(process.resourcesPath, 'dove.exe');

    if (fs.existsSync(devPath)) {
        return devPath;
    }
    if (fs.existsSync(prodPath)) {
        return prodPath;
    }
    return null;
}

/**
 * Get configuration file path
 */
function getConfigPath() {
    // Use workspace directory or current directory
    const cwd = process.cwd();
    return path.join(cwd, 'dove.json');
}

/**
 * Create main window
 */
function createWindow() {
    win = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        icon: path.join(__dirname, 'assets/icon.png'),
        title: 'Dove GUI'
    });

    // Load main page
    win.loadFile(path.join(__dirname, 'webview/index.html'));

    // Create menu
    createMenu();

    // Handle window close
    win.on('closed', () => {
        win = null;
    });
}

/**
 * Create application menu
 */
function createMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                { role: 'quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About',
                    click: () => {
                        dialog.showMessageBox(win, {
                            type: 'info',
                            title: 'About Dove GUI',
                            message: 'Dove GUI v0.2.6',
                            detail: 'Firmware build and flash tool for embedded development.\n\nAuthor: destin.zhang@quectel.com'
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

/**
 * Read configuration
 */
function readConfig() {
    configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
        try {
            const content = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(content);
        } catch (e) {
            console.error('Failed to read config:', e);
            return {};
        }
    }
    return {};
}

/**
 * Write configuration
 */
function writeConfig(config) {
    configPath = getConfigPath();
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        return true;
    } catch (e) {
        console.error('Failed to write config:', e);
        return false;
    }
}

/**
 * Execute dove.exe command
 */
function executeDove(args, callback) {
    const dovePath = getDovePath();
    if (!dovePath) {
        callback({ error: 'dove.exe not found' });
        return;
    }

    const child = spawn(dovePath, args, {
        shell: true,
        env: {
            ...process.env,
            FIRMWARE_CLI_CONFIG: configPath
        }
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
        const decoded = iconv.decode(data, 'gbk');
        output += decoded;

        // Send progress updates
        if (args.includes('--progress') || args.includes('flash')) {
            win.webContents.send('progress', decoded);
        }
        if (args.includes('build')) {
            win.webContents.send('buildOutput', decoded);
        }
    });

    child.stderr.on('data', (data) => {
        errorOutput += iconv.decode(data, 'gbk');
    });

    child.on('close', (code) => {
        callback({
            code,
            output,
            error: errorOutput
        });
    });

    child.on('error', (err) => {
        callback({ error: err.message });
    });

    return child;
}

// ========== IPC Handlers ==========

// Get configuration
ipcMain.handle('getConfig', async () => {
    const config = readConfig();
    return {
        command: 'configData',
        config,
        configFilePath: configPath
    };
});

// Save configuration
ipcMain.handle('saveConfig', async (event, data) => {
    const config = readConfig();

    // Update config fields
    if (data.config) {
        Object.assign(config, {
            firmwarePath: data.config.firmwarePath,
            buildCommands: data.config.buildCommands,
            buildGitBashPath: data.config.buildGitBashPath,
            language: data.config.language,
            theme: data.config.theme
        });
    }

    const success = writeConfig(config);
    return {
        command: 'configSaved',
        success,
        message: success ? 'Configuration saved' : 'Failed to save configuration'
    };
});

// Browse for path
ipcMain.handle('browseFirmwarePath', async () => {
    const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select Firmware Directory'
    });

    if (result.filePaths && result.filePaths.length > 0) {
        return {
            command: 'firmwarePathSelected',
            path: result.filePaths[0]
        };
    }
    return null;
});

ipcMain.handle('browseGitBashPath', async () => {
    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Executable', extensions: ['exe'] }],
        title: 'Select Git Bash'
    });

    if (result.filePaths && result.filePaths.length > 0) {
        return {
            command: 'gitBashPathSelected',
            path: result.filePaths[0]
        };
    }
    return null;
});

ipcMain.handle('selectScriptFile', async () => {
    const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [
            { name: 'Scripts', extensions: ['bat', 'sh', 'py', 'cmd', 'ps1'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        title: 'Select Build Script'
    });

    if (result.filePaths && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        const scriptName = path.basename(selectedPath, path.extname(selectedPath));
        return {
            command: 'scriptFileSelected',
            name: scriptName,
            commandValue: path.basename(selectedPath)
        };
    }
    return null;
});

// Get devices list
ipcMain.handle('getDevices', async () => {
    return new Promise((resolve) => {
        executeDove(['devices', '--json'], (result) => {
            if (result.code === 0 && result.output) {
                try {
                    const data = JSON.parse(result.output);
                    resolve({
                        command: 'devicesData',
                        devices: data.devices || []
                    });
                } catch (e) {
                    resolve({ command: 'devicesData', devices: [], error: 'Parse error' });
                }
            } else {
                resolve({ command: 'devicesData', devices: [], error: result.error });
            }
        });
    });
});

// Get firmware list
ipcMain.handle('getFirmwareList', async () => {
    return new Promise((resolve) => {
        executeDove(['list', '--json'], (result) => {
            if (result.code === 0 && result.output) {
                try {
                    const data = JSON.parse(result.output);
                    resolve({
                        command: 'firmwareListData',
                        firmwares: data.firmwares || []
                    });
                } catch (e) {
                    resolve({ command: 'firmwareListData', firmwares: [], error: 'Parse error' });
                }
            } else {
                resolve({ command: 'firmwareListData', firmwares: [], error: result.error });
            }
        });
    });
});

// Flash firmware
ipcMain.handle('flash', async (event, firmwarePath) => {
    return new Promise((resolve) => {
        executeDove(['flash', firmwarePath, '--progress', 'json'], (result) => {
            resolve({
                command: 'flashResult',
                success: result.code === 0,
                code: result.code
            });
        });
    });
});

// Build firmware
ipcMain.handle('build', async (event, commandName) => {
    return new Promise((resolve) => {
        const args = commandName ? ['build', '-n', commandName] : ['build'];
        executeDove(args, (result) => {
            resolve({
                command: 'buildResult',
                success: result.code === 0,
                code: result.code
            });
        });
    });
});

// COM Port operations
ipcMain.handle('addComPort', async (event, data) => {
    const config = readConfig();
    if (!config.comPorts) {
        config.comPorts = [];
    }

    // Check for duplicate
    if (config.comPorts.some(p => p.port === data.port)) {
        return { command: 'configError', message: 'Port already exists' };
    }

    config.comPorts.push({
        port: data.port,
        tags: data.tags,
        description: data.description,
        isActive: false
    });

    writeConfig(config);
    return { command: 'configData', config };
});

ipcMain.handle('deleteComPort', async (event, index) => {
    const config = readConfig();
    if (config.comPorts && index < config.comPorts.length) {
        config.comPorts.splice(index, 1);
        writeConfig(config);
    }
    return { command: 'configData', config };
});

ipcMain.handle('setActiveComPort', async (event, portName) => {
    const config = readConfig();
    if (config.comPorts) {
        config.comPorts.forEach(p => {
            p.isActive = p.port === portName;
        });
        if (config.comPorts.some(p => p.isActive)) {
            config.defaultComPort = portName;
        }
        writeConfig(config);
    }
    return { command: 'configData', config };
});

ipcMain.handle('updateComPort', async (event, data) => {
    const config = readConfig();
    if (config.comPorts && data.index < config.comPorts.length) {
        config.comPorts[data.index] = {
            ...config.comPorts[data.index],
            port: data.updates.port,
            tags: data.updates.tags,
            description: data.updates.description
        };
        writeConfig(config);
    }
    return { command: 'configData', config };
});

// Build command operations
ipcMain.handle('addBuildCommand', async (event, data) => {
    const config = readConfig();
    if (!config.buildCommands) {
        config.buildCommands = [];
    }

    config.buildCommands.push({
        name: data.name,
        description: data.description || '',
        command: data.command,
        isActive: config.buildCommands.length === 0
    });

    writeConfig(config);
    return { command: 'configData', config };
});

ipcMain.handle('deleteBuildCommand', async (event, index) => {
    const config = readConfig();
    if (config.buildCommands && index < config.buildCommands.length) {
        const wasActive = config.buildCommands[index].isActive;
        config.buildCommands.splice(index, 1);

        // Transfer active status
        if (wasActive && config.buildCommands.length > 0) {
            config.buildCommands[0].isActive = true;
        }

        writeConfig(config);
    }
    return { command: 'configData', config };
});

ipcMain.handle('setActiveBuildCommand', async (event, name) => {
    const config = readConfig();
    if (config.buildCommands) {
        config.buildCommands.forEach(cmd => {
            cmd.isActive = cmd.name === name;
        });
        writeConfig(config);
    }
    return { command: 'configData', config };
});

// Reset config
ipcMain.handle('resetConfig', async () => {
    const defaultConfig = {
        firmwarePath: '',
        buildCommands: [],
        buildGitBashPath: '',
        defaultComPort: '',
        comPorts: [],
        language: 'auto',
        theme: { mode: 'auto', accent: 'blue' }
    };
    writeConfig(defaultConfig);
    return { command: 'configData', config: defaultConfig };
});

// ========== App Lifecycle ==========

app.whenReady().then(() => {
    configPath = getConfigPath();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    // Cleanup
});