/**
 * Settings Page Adapter for Electron
 * Wraps doveBridge to match VSCode webview API patterns
 * @author: destin.zhang@quectel.com
 */

// Bridge adapter - replaces vscode API
const vscode = {
    postMessage: (message) => {
        window.doveBridge.postMessage(message);
    }
};

// State variables
let currentConfig = {
    firmwarePath: '',
    buildCommands: [],
    buildGitBashPath: '',
    defaultComPort: '',
    comPorts: [],
    language: 'auto',
    theme: {
        mode: 'auto',
        accent: 'blue'
    }
};

let localizedStrings = {};
let editingCommandIndex = -1;
let editingPortIndex = -1;
let hasUnsavedChanges = false;
let currentDefines = [];

// Section titles mapping
const sectionTitles = {
    'firmware': { icon: 'fa-folder-open', text: '' },
    'commands': { icon: 'fa-terminal', text: '' },
    'gitbash': { icon: 'fa-git-alt', text: '' },
    'comport': { icon: 'fa-plug', text: '' },
    'cppdefine': { icon: 'fa-code', text: '' },
    'language': { icon: 'fa-language', text: '' },
    'theme': { icon: 'fa-palette', text: '' },
    'agent': { icon: 'fa-robot', text: '' },
    'config': { icon: 'fa-file-code', text: '' }
};

/**
 * Initialize settings page
 */
function init() {
    setupNavigation();
    setupChangeTracking();
    bridgePost({ command: 'getConfig' });
    document.addEventListener('keydown', handleKeyboardShortcuts);
    window.addEventListener('beforeunload', handleBeforeUnload);
}

/**
 * Post message through bridge
 */
function bridgePost(message) {
    if (window.doveBridge) {
        window.doveBridge.postMessage(message);
    }
}

/**
 * Setup navigation click handlers
 */
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const sectionId = item.dataset.section;
            switchSection(sectionId);
        });
    });
}

/**
 * Switch to a specific section
 */
function switchSection(sectionId) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));

    const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
    if (navItem) navItem.classList.add('active');

    const section = document.getElementById(sectionId);
    if (section) section.classList.add('active');

    updateContentHeader(sectionId);
}

/**
 * Update content header
 */
function updateContentHeader(sectionId) {
    const header = document.getElementById('contentTitle');
    const sectionInfo = sectionTitles[sectionId];
    if (sectionInfo && header) {
        const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
        const text = navItem ? navItem.querySelector('.nav-text').textContent : sectionId;
        header.innerHTML = `<i class="fa-solid ${sectionInfo.icon}"></i> ${text}`;
    }
}

/**
 * Setup change tracking
 */
function setupChangeTracking() {
    const inputs = document.querySelectorAll('input[type="text"], select');
    inputs.forEach(input => {
        input.addEventListener('input', () => {
            markAsModified(input, true);
            hasUnsavedChanges = true;
        });
        input.addEventListener('change', () => {
            markAsModified(input, true);
            hasUnsavedChanges = true;

            // Apply theme immediately on change
            if (input.id === 'themeSelect' || input.id === 'accentColorSelect') {
                applyThemePreview();
            }
        });
    });
}

/**
 * Apply theme preview (before saving)
 */
function applyThemePreview() {
    const mode = document.getElementById('themeSelect').value;
    const accent = document.getElementById('accentColorSelect').value;

    // For auto mode, detect system preference
    if (mode === 'auto') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', mode);
    }
    document.documentElement.setAttribute('data-accent', accent);
}

/**
 * Apply theme from config
 */
function applyThemeFromConfig() {
    const themeConfig = typeof currentConfig.theme === 'object'
        ? currentConfig.theme
        : { mode: currentConfig.theme || 'auto', accent: 'blue' };

    const mode = themeConfig.mode || 'auto';
    const accent = themeConfig.accent || 'blue';

    if (mode === 'auto') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', mode);
    }
    document.documentElement.setAttribute('data-accent', accent);
}

/**
 * Mark input as modified
 */
function markAsModified(input, modified) {
    input.setAttribute('data-modified', modified ? 'true' : 'false');
    const sectionId = input.closest('.content-section')?.id;
    if (sectionId) {
        const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
        if (navItem) {
            navItem.classList.toggle('modified', modified);
        }
    }
}

/**
 * Clear modified indicators
 */
function clearModifiedIndicators() {
    document.querySelectorAll('input[type="text"], select').forEach(input => {
        input.setAttribute('data-modified', 'false');
    });
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('modified');
    });
    hasUnsavedChanges = false;
}

/**
 * Handle keyboard shortcuts
 */
function handleKeyboardShortcuts(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveSettings();
    }
}

/**
 * Handle before unload
 */
function handleBeforeUnload(e) {
    if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
}

/**
 * Handle messages from bridge
 */
window.handleConfigUpdate = function(message) {
    currentConfig = message.config;
    currentConfig.configFilePath = message.configFilePath;
    if (message.localizedStrings) {
        localizedStrings = message.localizedStrings;
    }
    populateForm();
    applyThemeFromConfig();
    clearModifiedIndicators();
};

// Listen for bridge messages
if (window.doveBridge) {
    window.doveBridge.onMessage((message) => {
        switch (message.command) {
            case 'configData':
                window.handleConfigUpdate(message);
                break;
            case 'configSaved':
                showStatusMessage('success', message.message);
                clearModifiedIndicators();
                break;
            case 'configError':
                showStatusMessage('error', message.message);
                break;
            case 'firmwarePathSelected':
                const fwPath = document.getElementById('firmwarePath');
                if (fwPath) fwPath.value = message.path;
                markAsModified(fwPath, true);
                hasUnsavedChanges = true;
                break;
            case 'gitBashPathSelected':
                const gitPath = document.getElementById('gitBashPath');
                if (gitPath) gitPath.value = message.path;
                markAsModified(gitPath, true);
                hasUnsavedChanges = true;
                break;
            case 'scriptFileSelected':
                addCommandFromScript(message.name, message.commandValue);
                break;
        }
    });
}

/**
 * Populate form with config
 */
function populateForm() {
    document.getElementById('firmwarePath').value = currentConfig.firmwarePath || '';
    renderCommandTable();
    document.getElementById('gitBashPath').value = currentConfig.buildGitBashPath || '';
    renderPortTable();
    document.getElementById('languageSelect').value = currentConfig.language || 'auto';

    const themeConfig = typeof currentConfig.theme === 'object'
        ? currentConfig.theme
        : { mode: currentConfig.theme || 'auto', accent: 'blue' };
    document.getElementById('themeSelect').value = themeConfig.mode || 'auto';
    document.getElementById('accentColorSelect').value = themeConfig.accent || 'blue';

    if (currentConfig.configFilePath) {
        document.getElementById('configFilePath').textContent = currentConfig.configFilePath;
    }
}

/**
 * Render command table
 */
function renderCommandTable() {
    const tbody = document.getElementById('commandTableBody');
    const noCommandsMsg = document.getElementById('noCommandsMsg');
    const table = document.getElementById('commandTable');

    if (!currentConfig.buildCommands || currentConfig.buildCommands.length === 0) {
        tbody.innerHTML = '';
        table.style.display = 'none';
        noCommandsMsg.style.display = 'block';
        return;
    }

    table.style.display = 'table';
    noCommandsMsg.style.display = 'none';

    tbody.innerHTML = currentConfig.buildCommands.map((cmd, index) => {
        const isActive = cmd.isActive;
        return `
            <tr class="${isActive ? 'active' : ''}">
                <td>${escapeHtml(cmd.name)}</td>
                <td>${escapeHtml(cmd.description || '')}</td>
                <td>${escapeHtml(cmd.command)}</td>
                <td>
                    <div class="cmd-actions">
                        <button class="btn-icon btn-set-active"
                                onclick="setActiveCommand(${index})"
                                ${isActive ? 'disabled' : ''}>
                            <i class="fa-solid ${isActive ? 'fa-check' : 'fa-play'}"></i>
                        </button>
                        <button class="btn-icon btn-edit" onclick="editCommand(${index})">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="btn-icon btn-delete" onclick="deleteCommand(${index})">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Render port table
 */
function renderPortTable() {
    const tbody = document.getElementById('portTableBody');
    const noPortsMsg = document.getElementById('noPortsMsg');
    const table = document.getElementById('portTable');

    if (!currentConfig.comPorts || currentConfig.comPorts.length === 0) {
        tbody.innerHTML = '';
        table.style.display = 'none';
        noPortsMsg.style.display = 'block';
        return;
    }

    table.style.display = 'table';
    noPortsMsg.style.display = 'none';

    tbody.innerHTML = currentConfig.comPorts.map((p, index) => {
        const isActive = p.isActive;
        const tagsHtml = (p.tags || []).map(t => `<span class="tag-badge tag-${t.toLowerCase()}">${t}</span>`).join('');
        return `
            <tr class="${isActive ? 'active' : ''}">
                <td>${escapeHtml(p.port)}</td>
                <td>${tagsHtml}</td>
                <td>${escapeHtml(p.description || '')}</td>
                <td>
                    <div class="port-actions">
                        <button class="btn-icon btn-set-active"
                                onclick="setActivePort(${index})"
                                ${isActive ? 'disabled' : ''}>
                            <i class="fa-solid ${isActive ? 'fa-check' : 'fa-play'}"></i>
                        </button>
                        <button class="btn-icon btn-edit" onclick="editPort(${index})">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="btn-icon btn-delete" onclick="deletePort(${index})">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Browse firmware path
 */
function browseFirmwarePath() {
    bridgePost({ command: 'browseFirmwarePath' });
}

/**
 * Browse Git Bash path
 */
function browseGitBashPath() {
    bridgePost({ command: 'browseGitBashPath' });
}

/**
 * Select script file
 */
function selectScriptFile() {
    bridgePost({ command: 'selectScriptFile' });
}

/**
 * Add command from script
 */
function addCommandFromScript(name, commandValue) {
    document.getElementById('newCommandName').value = name;
    document.getElementById('newCommandValue').value = commandValue;
    document.getElementById('newCommandName').focus();
    showStatusMessage('success', 'Script selected. Click Add to save.');
}

/**
 * Add new command
 */
function addCommand() {
    const name = document.getElementById('newCommandName').value.trim();
    const description = document.getElementById('newCommandDesc').value.trim();
    const command = document.getElementById('newCommandValue').value.trim();

    if (!name || !command) {
        showStatusMessage('error', 'Name and command required');
        return;
    }

    if (currentConfig.buildCommands.some(cmd => cmd.name === name)) {
        showStatusMessage('error', 'Command name exists');
        return;
    }

    currentConfig.buildCommands.push({ name, description, command, isActive: currentConfig.buildCommands.length === 0 });
    renderCommandTable();

    document.getElementById('newCommandName').value = '';
    document.getElementById('newCommandDesc').value = '';
    document.getElementById('newCommandValue').value = '';

    showStatusMessage('success', 'Command added');
}

/**
 * Edit command
 */
function editCommand(index) {
    const cmd = currentConfig.buildCommands[index];
    document.getElementById('newCommandName').value = cmd.name;
    document.getElementById('newCommandDesc').value = cmd.description || '';
    document.getElementById('newCommandValue').value = cmd.command;
    editingCommandIndex = index;

    const addBtn = document.querySelector('.add-command-form .btn-primary');
    addBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
    addBtn.onclick = updateCommand;
}

/**
 * Update command
 */
function updateCommand() {
    const name = document.getElementById('newCommandName').value.trim();
    const description = document.getElementById('newCommandDesc').value.trim();
    const command = document.getElementById('newCommandValue').value.trim();

    if (!name || !command) return;

    const wasActive = currentConfig.buildCommands[editingCommandIndex].isActive;
    currentConfig.buildCommands[editingCommandIndex] = { name, description, command, isActive: wasActive };
    renderCommandTable();
    cancelEdit();
    showStatusMessage('success', 'Command updated');
}

/**
 * Cancel edit
 */
function cancelEdit() {
    document.getElementById('newCommandName').value = '';
    document.getElementById('newCommandDesc').value = '';
    document.getElementById('newCommandValue').value = '';
    editingCommandIndex = -1;

    const addBtn = document.querySelector('.add-command-form .btn-primary');
    addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add';
    addBtn.onclick = addCommand;
}

/**
 * Delete command
 */
function deleteCommand(index) {
    const cmd = currentConfig.buildCommands[index];
    if (cmd.isActive && currentConfig.buildCommands.length > 1) {
        currentConfig.buildCommands.splice(index, 1);
        currentConfig.buildCommands[0].isActive = true;
    } else {
        currentConfig.buildCommands.splice(index, 1);
    }
    renderCommandTable();
    showStatusMessage('success', 'Command deleted');
}

/**
 * Set active command
 */
function setActiveCommand(index) {
    currentConfig.buildCommands.forEach((cmd, idx) => cmd.isActive = idx === index);
    renderCommandTable();
    showStatusMessage('success', 'Active command set');
}

/**
 * Add port
 */
function addPort() {
    const port = document.getElementById('newPortName').value.trim();
    const description = document.getElementById('newPortDesc').value.trim();
    const tags = [];
    document.querySelectorAll('.tag-checkbox input:checked').forEach(cb => tags.push(cb.value));

    if (!port || tags.length === 0) {
        showStatusMessage('error', 'Port and tags required');
        return;
    }

    if (currentConfig.comPorts.some(p => p.port === port)) {
        showStatusMessage('error', 'Port exists');
        return;
    }

    bridgePost({ command: 'addComPort', port, tags, description });

    document.getElementById('newPortName').value = '';
    document.getElementById('newPortDesc').value = '';
    document.querySelectorAll('.tag-checkbox input').forEach(cb => cb.checked = false);
}

/**
 * Edit port
 */
function editPort(index) {
    editingPortIndex = index;
    const port = currentConfig.comPorts[index];
    document.getElementById('newPortName').value = port.port;
    document.getElementById('newPortDesc').value = port.description || '';

    document.querySelectorAll('.tag-checkbox input').forEach(cb => cb.checked = false);
    (port.tags || []).forEach(tag => {
        const cb = document.querySelector(`.tag-checkbox input[value="${tag}"]`);
        if (cb) cb.checked = true;
    });

    const addBtn = document.querySelector('.add-port-form .btn-primary');
    addBtn.innerHTML = '<i class="fa-solid fa-save"></i> Update';
    addBtn.onclick = () => updatePort(index);
}

/**
 * Update port
 */
function updatePort(index) {
    const port = document.getElementById('newPortName').value.trim();
    const description = document.getElementById('newPortDesc').value.trim();
    const tags = [];
    document.querySelectorAll('.tag-checkbox input:checked').forEach(cb => tags.push(cb.value));

    if (!port || tags.length === 0) return;

    bridgePost({ command: 'updateComPort', index, updates: { port, tags, description } });

    document.getElementById('newPortName').value = '';
    document.getElementById('newPortDesc').value = '';
    document.querySelectorAll('.tag-checkbox input').forEach(cb => cb.checked = false);

    const addBtn = document.querySelector('.add-port-form .btn-primary');
    addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add';
    addBtn.onclick = addPort;
}

/**
 * Delete port
 */
function deletePort(index) {
    if (!confirm(`Delete port "${currentConfig.comPorts[index].port}"?`)) return;
    bridgePost({ command: 'deleteComPort', index });
}

/**
 * Set active port
 */
function setActivePort(index) {
    bridgePost({ command: 'setActiveComPort', portName: currentConfig.comPorts[index].port });
}

/**
 * Save settings
 */
function saveSettings() {
    currentConfig.firmwarePath = document.getElementById('firmwarePath').value.trim();
    currentConfig.buildGitBashPath = document.getElementById('gitBashPath').value.trim();
    currentConfig.language = document.getElementById('languageSelect').value;
    currentConfig.theme = {
        mode: document.getElementById('themeSelect').value,
        accent: document.getElementById('accentColorSelect').value
    };

    bridgePost({ command: 'saveConfig', config: currentConfig });
}

/**
 * Reset to defaults
 */
function resetToDefaults() {
    if (!confirm('Reset all settings to defaults?')) return;
    bridgePost({ command: 'resetConfig' });
}

/**
 * Open config file
 */
function openConfigFile() {
    // In Electron, this would open in external editor
    showStatusMessage('info', 'Config file: ' + (currentConfig.configFilePath || 'dove.json'));
}

/**
 * Open keybinding settings
 */
function openKeybindingSettings() {
    showStatusMessage('info', 'Keyboard shortcuts: Ctrl+S to save, Ctrl+D to add define');
}

/**
 * Show status message
 */
function showStatusMessage(type, message) {
    const existing = document.querySelector('.status-message');
    if (existing) existing.remove();

    const msgDiv = document.createElement('div');
    msgDiv.className = `status-message ${type}`;
    msgDiv.textContent = message;
    document.body.appendChild(msgDiv);

    setTimeout(() => {
        msgDiv.style.opacity = '0';
        msgDiv.style.transition = 'opacity 0.3s';
        setTimeout(() => msgDiv.remove(), 300);
    }, 3000);
}

// Initialize on load - called by app.js after DOM is ready
window.pageInit = init;