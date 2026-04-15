/**
 * Dove GUI - Preload Script (IPC Bridge)
 * Provides secure IPC communication between renderer and main process
 * @author: destin.zhang@quectel.com
 */

const { contextBridge, ipcRenderer } = require('electron');

// Message listeners storage
const messageListeners = new Set();

/**
 * Expose doveBridge API to renderer process
 * This replaces VSCode's acquireVsCodeApi() functionality
 */
contextBridge.exposeInMainWorld('doveBridge', {
    /**
     * Send message to main process and handle response
     * @param {Object} message - { command: string, ...data }
     */
    postMessage: async (message) => {
        const command = message.command;

        // Map commands to IPC handlers
        const handlerMap = {
            'getConfig': 'getConfig',
            'saveConfig': 'saveConfig',
            'resetConfig': 'resetConfig',
            'browseFirmwarePath': 'browseFirmwarePath',
            'browseGitBashPath': 'browseGitBashPath',
            'selectScriptFile': 'selectScriptFile',
            'getDevices': 'getDevices',
            'getFirmwareList': 'getFirmwareList',
            'flash': 'flash',
            'build': 'build',
            'addComPort': 'addComPort',
            'deleteComPort': 'deleteComPort',
            'setActiveComPort': 'setActiveComPort',
            'updateComPort': 'updateComPort',
            'addBuildCommand': 'addBuildCommand',
            'deleteBuildCommand': 'deleteBuildCommand',
            'setActiveBuildCommand': 'setActiveBuildCommand'
        };

        const handler = handlerMap[command];
        if (handler) {
            try {
                const result = await ipcRenderer.invoke(handler, message);
                // Send result to listeners
                if (result) {
                    for (const listener of messageListeners) {
                        listener(result);
                    }
                }
            } catch (error) {
                console.error('IPC error:', error);
                for (const listener of messageListeners) {
                    listener({ command: 'configError', message: error.message });
                }
            }
        } else {
            console.warn('Unknown command:', command);
        }
    },

    /**
     * Listen for messages from main process
     * @param {Function} callback - Handler for incoming messages
     */
    onMessage: (callback) => {
        messageListeners.add(callback);

        // Listen for async events from main process
        ipcRenderer.on('bridge-message', (event, data) => {
            callback(data);
        });

        ipcRenderer.on('progress', (event, data) => {
            callback({ command: 'progress', data });
        });

        ipcRenderer.on('buildOutput', (event, data) => {
            callback({ command: 'buildOutput', data });
        });

        ipcRenderer.on('flashResult', (event, data) => {
            callback(data);
        });

        ipcRenderer.on('buildResult', (event, data) => {
            callback(data);
        });
    },

    /**
     * Remove message listener
     * @param {Function} callback - The callback to remove
     */
    removeMessageListener: (callback) => {
        messageListeners.delete(callback);
        ipcRenderer.removeListener('bridge-message', callback);
        ipcRenderer.removeListener('progress', callback);
        ipcRenderer.removeListener('buildOutput', callback);
        ipcRenderer.removeListener('flashResult', callback);
        ipcRenderer.removeListener('buildResult', callback);
    },

    /**
     * Direct invoke for specific operations
     * @param {string} command - IPC handler name
     * @param {Object} data - Additional data
     */
    invoke: async (command, data) => {
        return await ipcRenderer.invoke(command, data);
    },

    /**
     * Get platform info
     */
    getPlatform: () => {
        return {
            platform: process.platform,
            isWindows: process.platform === 'win32',
            isMac: process.platform === 'darwin',
            isLinux: process.platform === 'linux'
        };
    },

    /**
     * Get app version
     */
    getVersion: () => {
        return process.env.npm_package_version || '0.2.6';
    }
});

console.log('Dove Bridge initialized successfully');