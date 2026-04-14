/**
 * Dove GUI - Main Application Logic
 * Handles page navigation and message routing
 * @author: destin.zhang@quectel.com
 */

// Initialize doveBridge
const bridge = window.doveBridge;

if (!bridge) {
    console.error('doveBridge not initialized. This app must run in Electron.');
    document.body.innerHTML = '<div style="padding: 20px; color: red;">Error: This application must run in Electron environment.</div>';
}

// Current state
let currentPage = 'welcome';
let pageLoaded = {};

/**
 * Initialize application
 */
function init() {
    // Setup navigation
    setupNavigation();

    // Load default page
    loadPage('welcome');

    // Listen for messages from main process
    if (bridge) {
        bridge.onMessage(handleMessage);
        bridge.postMessage({ command: 'getConfig' });
    }
}

/**
 * Setup sidebar navigation
 */
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            if (page && page !== currentPage) {
                loadPage(page);

                // Update active state
                navItems.forEach(n => n.classList.remove('active'));
                item.classList.add('active');
            }
        });
    });
}

/**
 * Load page content
 * @param {string} page - Page name (welcome, settings, search, logViewer)
 */
function loadPage(page) {
    currentPage = page;
    const container = document.getElementById('pageContainer');

    if (!container) {
        console.error('pageContainer not found');
        return;
    }

    // Show loading state
    container.innerHTML = '<div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>';

    // Load page content via fetch
    const pageFiles = {
        'welcome': 'welcome/welcome-electron.html',
        'settings': 'settings/settings-electron.html',
        'search': 'searchPanel/searchPanel-electron.html',
        'logViewer': 'logViewer/logViewer-electron.html'
    };

    const pageFile = pageFiles[page];
    if (!pageFile) {
        container.innerHTML = '<div class="error">Page not found</div>';
        return;
    }

    fetch(pageFile)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response.text();
        })
        .then(html => {
            container.innerHTML = html;

            // Initialize page-specific logic
            initializePage(page);
            pageLoaded[page] = true;
        })
        .catch(error => {
            console.error('Failed to load page:', error);
            container.innerHTML = `<div class="error">Failed to load page: ${error.message}</div>`;
        });
}

/**
 * Initialize page-specific functionality
 * @param {string} page - Page name
 */
function initializePage(page) {
    // Load page-specific scripts (Electron versions)
    const scriptFiles = {
        'settings': 'settings/settings-adapter.js',
        'search': 'searchPanel/searchPanel.js',
        'logViewer': 'logViewer/logViewer.js'
    };

    const scriptFile = scriptFiles[page];
    if (scriptFile) {
        loadScript(scriptFile);
    }

    // Load CSS files if not already loaded
    const cssFiles = {
        'welcome': 'welcome/welcome.css',
        'settings': 'settings/settings.css',
        'search': 'searchPanel/searchPanel.css',
        'logViewer': 'logViewer/logViewer.css'
    };

    const cssFile = cssFiles[page];
    if (cssFile && !document.querySelector(`link[href="${cssFile}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssFile;
        document.head.appendChild(link);
    }
}

/**
 * Load JavaScript file dynamically
 * @param {string} src - Script file path
 */
function loadScript(src) {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => {
        console.log(`Loaded: ${src}`);
        // Wait for DOM to update, then trigger page init if available
        setTimeout(() => {
            if (typeof window.pageInit === 'function') {
                window.pageInit();
            }
        }, 50);
    };
    script.onerror = () => {
        console.error(`Failed to load script: ${src}`);
    };
    document.body.appendChild(script);
}

/**
 * Handle messages from main process
 * @param {Object} message - { command: string, ...data }
 */
function handleMessage(message) {
    console.log('Received message:', message);

    // Route message to appropriate handler
    switch (message.command) {
        case 'configData':
            handleConfigData(message);
            break;
        case 'configSaved':
            showStatusMessage('success', message.message || 'Configuration saved');
            break;
        case 'configError':
            showStatusMessage('error', message.message || 'Configuration error');
            break;
        case 'progress':
            handleProgress(message.data);
            break;
        case 'buildOutput':
            handleBuildOutput(message.data);
            break;
        case 'buildResult':
            handleBuildResult(message);
            break;
        case 'flashResult':
            handleFlashResult(message);
            break;
        case 'firmwarePathSelected':
            handleFirmwarePathSelected(message);
            break;
        case 'gitBashPathSelected':
            handleGitBashPathSelected(message);
            break;
        case 'scriptFileSelected':
            handleScriptFileSelected(message);
            break;
        case 'devicesData':
            handleDevicesData(message);
            break;
        case 'firmwareListData':
            handleFirmwareListData(message);
            break;
    }
}

/**
 * Handle configuration data
 */
function handleConfigData(message) {
    // Store config globally
    window.currentConfig = message.config;
    window.configFilePath = message.configFilePath;

    // Apply theme
    if (message.config.theme) {
        const themeConfig = typeof message.config.theme === 'object'
            ? message.config.theme
            : { mode: message.config.theme, accent: 'blue' };

        document.documentElement.setAttribute('data-theme', themeConfig.mode || 'dark');
        document.documentElement.setAttribute('data-accent', themeConfig.accent || 'blue');
    }

    // Notify page-specific handlers
    if (currentPage === 'settings' && window.handleConfigUpdate) {
        window.handleConfigUpdate(message);
    }
}

/**
 * Handle progress updates (flash progress)
 */
function handleProgress(data) {
    if (currentPage === 'welcome' || currentPage === 'settings') {
        const progressBar = document.getElementById('flashProgress');
        if (progressBar) {
            progressBar.value = data.progress || 0;
        }
    }
}

/**
 * Handle build output
 */
function handleBuildOutput(data) {
    const outputElement = document.getElementById('buildOutput');
    if (outputElement) {
        outputElement.textContent += data;
        outputElement.scrollTop = outputElement.scrollHeight;
    }
}

/**
 * Handle build result
 */
function handleBuildResult(message) {
    if (message.success) {
        showStatusMessage('success', 'Build completed successfully');
    } else {
        showStatusMessage('error', `Build failed with code ${message.code}`);
    }
}

/**
 * Handle flash result
 */
function handleFlashResult(message) {
    if (message.success) {
        showStatusMessage('success', 'Flash completed successfully');
    } else {
        showStatusMessage('error', `Flash failed with code ${message.code}`);
    }
}

/**
 * Handle firmware path selection
 */
function handleFirmwarePathSelected(message) {
    const input = document.getElementById('firmwarePath');
    if (input) {
        input.value = message.path;
    }
}

/**
 * Handle git bash path selection
 */
function handleGitBashPathSelected(message) {
    const input = document.getElementById('gitBashPath');
    if (input) {
        input.value = message.path;
    }
}

/**
 * Handle script file selection
 */
function handleScriptFileSelected(message) {
    if (currentPage === 'settings' && window.handleScriptSelected) {
        window.handleScriptSelected(message);
    }
}

/**
 * Handle devices data
 */
function handleDevicesData(message) {
    if (currentPage === 'welcome' || currentPage === 'settings') {
        const devicesList = document.getElementById('devicesList');
        if (devicesList) {
            devicesList.innerHTML = message.devices.map(d =>
                `<li><i class="fa-solid fa-plug"></i> ${d}</li>`
            ).join('');
        }
    }
}

/**
 * Handle firmware list data
 */
function handleFirmwareListData(message) {
    if (currentPage === 'welcome') {
        const firmwareList = document.getElementById('firmwareList');
        if (firmwareList) {
            firmwareList.innerHTML = message.firmwares.map(f =>
                `<li><i class="fa-solid fa-file"></i> ${f.name} - ${f.time}</li>`
            ).join('');
        }
    }
}

/**
 * Show status message
 * @param {string} type - 'success' or 'error'
 * @param {string} message - Message text
 */
function showStatusMessage(type, message) {
    // Remove existing messages
    const existing = document.querySelector('.status-message');
    if (existing) existing.remove();

    // Create new message
    const msgDiv = document.createElement('div');
    msgDiv.className = `status-message ${type}`;
    msgDiv.innerHTML = `
        <i class="fa-solid ${type === 'success' ? 'fa-check' : 'fa-times'}"></i>
        <span>${message}</span>
    `;
    document.body.appendChild(msgDiv);

    // Auto remove after 3 seconds
    setTimeout(() => {
        msgDiv.style.opacity = '0';
        setTimeout(() => msgDiv.remove(), 300);
    }, 3000);
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Page init callback placeholder
window.pageInit = null;