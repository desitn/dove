/**
 * Search Panel Frontend Logic
 * Handles search UI interactions and communication with extension
 */

(function() {
    // Category definitions with FontAwesome icons
    const CATEGORIES = {
        folder: { name: 'folder', label: 'Folders', icon: '<i class="fa-solid fa-folder"></i>' },
        archive: { name: 'archive', label: 'Archive Files', icon: '<i class="fa-solid fa-file-zipper"></i>' },
        pdf: { name: 'pdf', label: 'PDF Documents', icon: '<i class="fa-solid fa-file-pdf"></i>' },
        office: { name: 'office', label: 'Office Documents', icon: '<i class="fa-solid fa-file-word"></i>' },
        firmware: { name: 'firmware', label: 'Firmware Files', icon: '<i class="fa-solid fa-microchip"></i>' },
        code: { name: 'code', label: 'Code Files', icon: '<i class="fa-solid fa-file-code"></i>' },
        image: { name: 'image', label: 'Images', icon: '<i class="fa-solid fa-file-image"></i>' },
        video: { name: 'video', label: 'Videos', icon: '<i class="fa-solid fa-file-video"></i>' },
        audio: { name: 'audio', label: 'Audio', icon: '<i class="fa-solid fa-file-audio"></i>' },
        text: { name: 'text', label: 'Text Files', icon: '<i class="fa-solid fa-file-lines"></i>' },
        executable: { name: 'executable', label: 'Executables', icon: '<i class="fa-solid fa-gear"></i>' },
        other: { name: 'other', label: 'Other Files', icon: '<i class="fa-solid fa-file"></i>' }
    };

    // State
    let currentResults = {};
    let selectedCategory = null;
    let contextMenuTarget = null;
    let searchTimeout = null;
    let isSearching = false;

    // DOM Elements
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearBtn');
    const searchStatus = document.getElementById('searchStatus');
    const statusText = document.getElementById('statusText');
    const searchResults = document.getElementById('searchResults');
    const emptyState = document.getElementById('emptyState');
    const categoryNav = document.getElementById('categoryNav');
    const searchScope = document.getElementById('searchScope');
    const maxResults = document.getElementById('maxResults');
    const searchPort = document.getElementById('searchPort');
    const testConnectionBtn = document.getElementById('testConnectionBtn');
    const connectionStatus = document.getElementById('connectionStatus');
    const contextMenu = document.getElementById('contextMenu');
    const settingsToggle = document.getElementById('settingsToggle');
    const sidebarFooter = document.getElementById('sidebarFooter');


    // Initialize
    function init() {
        setupEventListeners();
        renderCategoryNav();
        requestSearchConfig();
    }

    // Setup event listeners
    function setupEventListeners() {
        // Search input
        searchInput.addEventListener('input', handleSearchInput);
        searchInput.addEventListener('keydown', handleSearchKeydown);
        
        // Clear button
        clearBtn.addEventListener('click', clearSearch);
        
        // Settings toggle
        settingsToggle.addEventListener('click', toggleSettings);
        
        // Config changes
        searchScope.addEventListener('change', handleConfigChange);
        maxResults.addEventListener('change', handleConfigChange);
        searchPort.addEventListener('change', handlePortChange);
        
        // Test connection button
        if (testConnectionBtn) {
            testConnectionBtn.addEventListener('click', testConnection);
        }
        
        // Context menu
        document.getElementById('ctxRevealInExplorer').addEventListener('click', () => {
            console.log('[ContextMenu] === ctxRevealInExplorer clicked ===');
            console.log('[ContextMenu] contextMenuTarget:', JSON.stringify(contextMenuTarget));
            console.log('[ContextMenu] filePath to send:', contextMenuTarget?.path);
            
            if (contextMenuTarget) {
                vscode.postMessage({
                    command: 'revealInExplorer',
                    filePath: contextMenuTarget.path
                });
            }
            hideContextMenu();
        });
        
        document.getElementById('ctxAddToFavorites').addEventListener('click', () => {
            if (contextMenuTarget) {
                vscode.postMessage({
                    command: 'addToFavorites',
                    filePath: contextMenuTarget.path,
                    fileName: contextMenuTarget.name
                });
            }
            hideContextMenu();
        });
        
        document.getElementById('ctxCopyPath').addEventListener('click', () => {
            if (contextMenuTarget) {
                vscode.postMessage({
                    command: 'copyPath',
                    filePath: contextMenuTarget.path
                });
            }
            hideContextMenu();
        });
        
        // Hide context menu on click outside
        document.addEventListener('click', (e) => {
            if (!contextMenu.contains(e.target)) {
                hideContextMenu();
            }
        });
        
        // Message from extension
        window.addEventListener('message', handleMessage);
    }

    // Handle search input
    function handleSearchInput() {
        const keyword = searchInput.value.trim();
        
        // Toggle clear button
        clearBtn.classList.toggle('visible', keyword.length > 0);
        
        // Clear previous timeout
        if (searchTimeout) {
            clearTimeout(searchTimeout);
        }
        
        // Debounce search
        if (keyword.length > 0) {
            searchTimeout = setTimeout(() => {
                performSearch(keyword);
            }, 300);
        } else {
            clearResults();
        }
    }

    // Handle search keydown
    function handleSearchKeydown(e) {
        if (e.key === 'Escape') {
            clearSearch();
        }
    }

    // Perform search
    function performSearch(keyword) {
        if (isSearching) return;
        
        isSearching = true;
        showLoading();
        
        vscode.postMessage({
            command: 'search',
            keyword: keyword,
            scope: searchScope.value,
            maxResults: parseInt(maxResults.value)
        });
    }

    // Clear search
    function clearSearch() {
        searchInput.value = '';
        clearBtn.classList.remove('visible');
        clearResults();
        searchInput.focus();
    }

    // Clear results
    function clearResults() {
        currentResults = {};
        selectedCategory = null;
        renderResults();
        hideStatus();
    }

    // Show loading
    function showLoading() {
        searchResults.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <div>Searching...</div>
            </div>
        `;
    }

    // Show status
    function showStatus(text, isError = false) {
        searchStatus.style.display = 'block';
        statusText.textContent = text;
        statusText.className = isError ? 'error' : '';
    }

    // Hide status
    function hideStatus() {
        searchStatus.style.display = 'none';
    }

    // Toggle settings panel
    function toggleSettings() {
        sidebarFooter.classList.toggle('collapsed');
        settingsToggle.classList.toggle('active');
    }

    // Handle config change
    function handleConfigChange() {
        vscode.postMessage({
            command: 'updateSearchConfig',
            config: {
                scope: searchScope.value,
                maxResults: parseInt(maxResults.value)
            }
        });
        
        // Re-search if there's a keyword
        const keyword = searchInput.value.trim();
        if (keyword) {
            performSearch(keyword);
        }
    }

    // Handle port change
    function handlePortChange() {
        const port = parseInt(searchPort.value);
        if (port < 1 || port > 65535) {
            showStatus('Port must be between 1 and 65535', true);
            return;
        }
        
        vscode.postMessage({
            command: 'updateSearchConfig',
            config: {
                port: port
            }
        });
    }

    // Test Everything connection
    function testConnection() {
        if (!testConnectionBtn) return;
        
        // Update UI to testing state
        testConnectionBtn.classList.add('testing');
        testConnectionBtn.disabled = true;
        if (connectionStatus) {
            connectionStatus.textContent = 'Testing...';
            connectionStatus.className = 'connection-status';
        }
        
        // Send test command to extension
        vscode.postMessage({
            command: 'testEverythingConnection'
        });
    }

    // Handle connection test result
    function handleConnectionTestResult(message) {
        if (!testConnectionBtn) return;
        
        // Remove testing state
        testConnectionBtn.classList.remove('testing');
        testConnectionBtn.disabled = false;
        
        if (message.connected) {
            // Success
            testConnectionBtn.classList.add('success');
            testConnectionBtn.classList.remove('error');
            if (connectionStatus) {
                connectionStatus.textContent = 'Connected';
                connectionStatus.className = 'connection-status success';
            }
            
            // Clear success state after 3 seconds
            setTimeout(() => {
                testConnectionBtn.classList.remove('success');
                if (connectionStatus) {
                    connectionStatus.textContent = '';
                    connectionStatus.className = 'connection-status';
                }
            }, 3000);
        } else {
            // Failed
            testConnectionBtn.classList.add('error');
            testConnectionBtn.classList.remove('success');
            if (connectionStatus) {
                connectionStatus.textContent = 'Connection failed';
                connectionStatus.className = 'connection-status error';
            }
            
            // Clear error state after 3 seconds
            setTimeout(() => {
                testConnectionBtn.classList.remove('error');
                if (connectionStatus) {
                    connectionStatus.textContent = '';
                    connectionStatus.className = 'connection-status';
                }
            }, 3000);
        }
    }

    // Request search config
    function requestSearchConfig() {
        vscode.postMessage({ command: 'getSearchConfig' });
    }

    // Handle messages from extension
    function handleMessage(event) {
        const message = event.data;
        
        switch (message.command) {
            case 'searchResults':
                handleSearchResults(message);
                break;
            case 'searchError':
                handleSearchError(message);
                break;
            case 'searchConfig':
                handleSearchConfig(message);
                break;
            case 'searchConfigUpdated':
                // Config updated
                break;
            case 'favoriteAdded':
                // Favorite added
                break;
            case 'triggerSearch':
                // Triggered from command palette
                if (message.text) {
                    searchInput.value = message.text;
                    clearBtn.classList.add('visible');
                    performSearch(message.text);
                }
                break;
            case 'connectionTestResult':
                handleConnectionTestResult(message);
                break;
        }
    }

    // Handle search results
    function handleSearchResults(message) {
        isSearching = false;
        currentResults = message.results || {};
        
        const totalCount = message.totalCount || 0;
        const keyword = message.keyword || '';
        
        if (totalCount === 0) {
            showStatus(`No results found for "${keyword}"`);
            renderEmptyResults();
        } else {
            showStatus(`Found ${totalCount} results for "${keyword}"`);
            renderResults();
        }
        
        updateCategoryCounts();
    }

    // Handle search error
    function handleSearchError(message) {
        isSearching = false;
        showStatus(`Error: ${message.error}`, true);
        renderEmptyResults();
    }

    // Handle search config
    function handleSearchConfig(message) {
        const config = message.config || {};
        if (config.scope) {
            searchScope.value = config.scope;
        }
        if (config.maxResults) {
            maxResults.value = config.maxResults.toString();
        }
        if (config.port) {
            searchPort.value = config.port.toString();
        }
    }

    // Render category navigation
    function renderCategoryNav() {
        categoryNav.innerHTML = '';
        
        for (const [key, category] of Object.entries(CATEGORIES)) {
            const item = document.createElement('div');
            item.className = 'category-item';
            item.dataset.category = key;
            item.innerHTML = `
                <span class="category-icon">${category.icon}</span>
                <span class="category-name">${category.label}</span>
                <span class="category-count" id="count-${key}">0</span>
            `;
            
            item.addEventListener('click', () => {
                selectCategory(key);
            });
            
            categoryNav.appendChild(item);
        }
    }

    // Update category counts
    function updateCategoryCounts() {
        for (const [key, files] of Object.entries(currentResults)) {
            const countEl = document.getElementById(`count-${key}`);
            if (countEl) {
                countEl.textContent = files.length;
            }
        }
    }

    // Select category
    function selectCategory(categoryKey) {
        // Update active state
        document.querySelectorAll('.category-item').forEach(item => {
            item.classList.toggle('active', item.dataset.category === categoryKey);
        });
        
        selectedCategory = categoryKey;
        
        // Scroll to category in results
        const categoryEl = document.getElementById(`category-${categoryKey}`);
        if (categoryEl) {
            categoryEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    // Render results
    function renderResults() {
        if (Object.keys(currentResults).length === 0) {
            renderEmptyResults();
            return;
        }
        
        searchResults.innerHTML = '';
        
        // Render each category
        for (const [key, files] of Object.entries(currentResults)) {
            if (files.length === 0) continue;
            
            const category = CATEGORIES[key];
            const categoryEl = document.createElement('div');
            categoryEl.className = 'result-category';
            categoryEl.id = `category-${key}`;
            
            categoryEl.innerHTML = `
                <div class="category-header" data-category="${key}">
                    <i class="fa-solid fa-chevron-down toggle-icon"></i>
                    <span class="category-title">${category.icon} ${category.label}</span>
                    <span class="category-badge">${files.length}</span>
                </div>
                <div class="result-items">
                    ${files.map(file => renderFileItem(file)).join('')}
                </div>
            `;
            
            // Toggle collapse
            const header = categoryEl.querySelector('.category-header');
            header.addEventListener('click', () => {
                categoryEl.classList.toggle('collapsed');
                header.classList.toggle('collapsed');
            });
            
            // Add click handlers to items
            const items = categoryEl.querySelectorAll('.result-item');
            items.forEach((item, index) => {
                const file = files[index];
                
                item.addEventListener('click', () => {
                    openFile(file);
                });
                
                item.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    showContextMenu(e, file);
                });
            });
            
            searchResults.appendChild(categoryEl);
        }
    }

    // Render file item
    function renderFileItem(file) {

        const icon = getFileIcon(file);
        const displayPath = shortenPath(file.path);
        const meta = file.size ? formatFileSize(file.size) : '';
        
        return `
            <div class="result-item" data-path="${escapeHtml(file.path)}">
                <span class="file-icon">${icon}</span>
                <div class="file-info">
                    <div class="file-name">${escapeHtml(file.name)}</div>
                    <div class="file-path">${escapeHtml(displayPath)}</div>
                </div>
                <div class="file-meta">${meta}</div>
            </div>
        `;
    }

    // Render empty results
    function renderEmptyResults() {
        searchResults.innerHTML = '';
        searchResults.appendChild(emptyState);
    }

    // Get file icon using FontAwesome
    function getFileIcon(file) {
        if (file.isDirectory) return '<i class="fa-solid fa-folder"></i>';
        
        const ext = getFileExtension(file.name);
        const iconMap = {
            'zip': '<i class="fa-solid fa-file-zipper"></i>',
            'rar': '<i class="fa-solid fa-file-zipper"></i>',
            '7z': '<i class="fa-solid fa-file-zipper"></i>',
            'pdf': '<i class="fa-solid fa-file-pdf"></i>',
            'doc': '<i class="fa-solid fa-file-word"></i>',
            'docx': '<i class="fa-solid fa-file-word"></i>',
            'xls': '<i class="fa-solid fa-file-excel"></i>',
            'xlsx': '<i class="fa-solid fa-file-excel"></i>',
            'fbf': '<i class="fa-solid fa-microchip"></i>',
            'pac': '<i class="fa-solid fa-microchip"></i>',
            'bin': '<i class="fa-solid fa-microchip"></i>',
            'c': '<i class="fa-solid fa-file-code"></i>',
            'h': '<i class="fa-solid fa-file-code"></i>',
            'cpp': '<i class="fa-solid fa-file-code"></i>',
            'js': '<i class="fa-solid fa-file-code"></i>',
            'py': '<i class="fa-solid fa-file-code"></i>',
            'png': '<i class="fa-solid fa-file-image"></i>',
            'jpg': '<i class="fa-solid fa-file-image"></i>',
            'jpeg': '<i class="fa-solid fa-file-image"></i>',
            'gif': '<i class="fa-solid fa-file-image"></i>',
            'mp4': '<i class="fa-solid fa-file-video"></i>',
            'avi': '<i class="fa-solid fa-file-video"></i>',
            'mp3': '<i class="fa-solid fa-file-audio"></i>',
            'wav': '<i class="fa-solid fa-file-audio"></i>',
            'txt': '<i class="fa-solid fa-file-lines"></i>',
            'md': '<i class="fa-solid fa-file-lines"></i>',
            'exe': '<i class="fa-solid fa-gear"></i>',
            'dll': '<i class="fa-solid fa-gear"></i>'
        };
        
        return iconMap[ext] || '<i class="fa-solid fa-file"></i>';
    }

    // Get file extension
    function getFileExtension(filename) {
        if (!filename) return '';
        const lastDot = filename.lastIndexOf('.');
        if (lastDot === -1 || lastDot === 0) return '';
        return filename.slice(lastDot + 1).toLowerCase();
    }

    // Shorten path
    function shortenPath(fullPath) {
        if (!fullPath) return '';
        const maxLength = 60;
        if (fullPath.length <= maxLength) return fullPath;
        
        const parts = fullPath.split(/[\\/]/);
        if (parts.length <= 2) return fullPath;
        
        return '.../' + parts.slice(-2).join('/');
    }

    // Format file size
    function formatFileSize(size) {
        if (!size && size !== 0) return '';
        if (size === 0) return '0 B';
        
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(size) / Math.log(1024));
        const value = size / Math.pow(1024, i);
        
        return `${value.toFixed(1)} ${units[i]}`;
    }

    // Open file
    function openFile(file) {
        vscode.postMessage({
            command: 'openFile',
            filePath: file.path
        });
    }

    // Show context menu
    function showContextMenu(event, file) {
        // Debug: Log full file object
        console.log('[ContextMenu] === showContextMenu ===');
        console.log('[ContextMenu] Full file object:', JSON.stringify(file, null, 2));
        console.log('[ContextMenu] file.path:', file.path);
        console.log('[ContextMenu] file.filePath:', file.filePath);
        console.log('[ContextMenu] file.name:', file.name);
        console.log('[ContextMenu] file.fileName:', file.fileName);
        
        // Store the file path directly to avoid undefined issues
        contextMenuTarget = {
            path: file.path || file.filePath,
            name: file.name || file.fileName,
            isDirectory: file.isDirectory || false
        };
        
        console.log('[ContextMenu] Target set:', JSON.stringify(contextMenuTarget));
        console.log('[ContextMenu] Target path:', contextMenuTarget.path);
        
        const x = event.clientX;
        const y = event.clientY;
        
        // Adjust position to keep menu in viewport
        const menuWidth = 180;
        const menuHeight = 120;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        let adjustedX = x;
        let adjustedY = y;
        
        if (x + menuWidth > viewportWidth) {
            adjustedX = viewportWidth - menuWidth - 10;
        }
        if (y + menuHeight > viewportHeight) {
            adjustedY = viewportHeight - menuHeight - 10;
        }
        
        contextMenu.style.left = `${adjustedX}px`;
        contextMenu.style.top = `${adjustedY}px`;
        contextMenu.classList.add('visible');
        
        console.log('[ContextMenu] Menu positioned at:', adjustedX, adjustedY);
    }

    // Hide context menu
    function hideContextMenu() {
        contextMenu.classList.remove('visible');
        contextMenuTarget = null;
    }

    // Escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
