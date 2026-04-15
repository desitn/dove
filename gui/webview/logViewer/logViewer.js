/**
 * @description: Log Viewer Frontend Logic
 *               Handles UI interactions and communication with extension
 * @author: destin.zhang@quectel.com
 */

(function() {
    // VS Code API
    const vscode = acquireVsCodeApi();

    // State
    let currentSelection = '';
    let currentLineNumber = null;
    let isFilterView = false;
    let originalPanelId = null;

    // DOM Elements
    const container = document.querySelector('.log-viewer-container');
    const linesContainer = document.getElementById('linesContainer');
    const searchPanel = document.getElementById('searchPanel');
    const filterPanel = document.getElementById('filterPanel');
    const markbookPanel = document.getElementById('markbookPanel');
    const toolsPanel = document.getElementById('toolsPanel');
    const contextMenu = document.getElementById('contextMenu');
    const notification = document.getElementById('notification');
    const resizeHandle = document.getElementById('resizeHandle');

    // Resize state
    let isResizing = false;
    let startX = 0;
    let startWidth = 280;

    // Search result navigation state
    let selectedSearchIndex = -1;
    let searchResultItems = [];

    // Initialize
    function init() {
        // Get panel info from data attributes
        isFilterView = container.dataset.isFilterView === 'true';
        originalPanelId = container.dataset.originalPanelId;

        setupEventListeners();
        setupMessageHandlers();
        
        // Check if in empty state (no file loaded)
        const emptyStateContainer = document.getElementById('emptyStateContainer');
        if (emptyStateContainer && !emptyStateContainer.classList.contains('hidden')) {
            // Request recent files for empty state
            vscode.postMessage({ command: 'getRecentFiles' });
        } else {
            // Request initial data for loaded file
            vscode.postMessage({ command: 'getBookmarks' });
            vscode.postMessage({ command: 'getSearchHistory' });
        }
    }

    // Setup Event Listeners
    function setupEventListeners() {
        // Empty state handlers
        const btnSelectLogFile = document.getElementById('btnSelectLogFile');
        if (btnSelectLogFile) {
            btnSelectLogFile.addEventListener('click', () => {
                vscode.postMessage({ command: 'selectLogFile' });
            });
        }

        // Toolbar buttons
        document.getElementById('btnSearch').addEventListener('click', toggleSearchPanel);
        document.getElementById('btnFilter').addEventListener('click', toggleFilterPanel);
        document.getElementById('btnMarkbook').addEventListener('click', toggleMarkbookPanel);
        document.getElementById('btnTools').addEventListener('click', toggleToolsPanel);
        document.getElementById('btnClearHighlights').addEventListener('click', clearAllHighlights);

        // Close buttons
        document.getElementById('btnCloseSearch').addEventListener('click', hideSearchPanel);
        document.getElementById('btnCloseFilter').addEventListener('click', hideFilterPanel);
        document.getElementById('btnCloseMarkbook').addEventListener('click', hideMarkbookPanel);
        document.getElementById('btnCloseTools').addEventListener('click', hideToolsPanel);

        // Regex toggle buttons
        document.getElementById('regexToggleBtn').addEventListener('click', toggleSearchRegex);
        document.getElementById('filterRegexToggleBtn').addEventListener('click', toggleFilterRegex);

        // Search functionality
        document.getElementById('searchInput').addEventListener('keydown', handleSearchKeydown);

        // Filter functionality
        document.getElementById('filterInput').addEventListener('keydown', handleFilterKeydown);

        // Tools functionality
        document.getElementById('btnHexToString').addEventListener('click', hexToString);
        document.getElementById('btnStringToHex').addEventListener('click', stringToHex);
        document.getElementById('btnToHex').addEventListener('click', () => convertBase('hex'));
        document.getElementById('btnToDec').addEventListener('click', () => convertBase('dec'));
        document.getElementById('btnToOct').addEventListener('click', () => convertBase('oct'));
        document.getElementById('btnToBin').addEventListener('click', () => convertBase('bin'));

        // Context menu items
        document.getElementById('ctxCopySelection').addEventListener('click', () => {
            copyCurrentSelection();
            hideContextMenu();
        });
        document.getElementById('ctxHighlight').addEventListener('click', () => {
            highlightSelection(false);
            hideContextMenu();
        });
        document.getElementById('ctxRemoveHighlight').addEventListener('click', () => {
            removeHighlight();
            hideContextMenu();
        });
        document.getElementById('ctxSearch').addEventListener('click', () => {
            searchSelection();
            hideContextMenu();
        });
        document.getElementById('ctxFilter').addEventListener('click', () => {
            filterSelection();
            hideContextMenu();
        });
        document.getElementById('ctxBookmark').addEventListener('click', () => {
            addBookmark();
            hideContextMenu();
        });
        document.getElementById('ctxGotoOriginal').addEventListener('click', () => {
            syncToOriginal();
            hideContextMenu();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', handleKeyboardShortcuts);

        // Line click handlers
        linesContainer.addEventListener('click', handleLineClick);
        linesContainer.addEventListener('contextmenu', handleContextMenu);

        // Hide context menu on click outside
        document.addEventListener('click', (e) => {
            if (!contextMenu.contains(e.target)) {
                hideContextMenu();
            }
        });

        // Text selection tracking
        document.addEventListener('selectionchange', handleSelectionChange);

        // Resize handle
        if (resizeHandle) {
            resizeHandle.addEventListener('mousedown', startResize);
        }
    }

    // Resize Functions
    function startResize(e) {
        isResizing = true;
        startX = e.clientX;
        startWidth = searchPanel.offsetWidth || filterPanel.offsetWidth || 280;
        resizeHandle.classList.add('dragging');
        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
        e.preventDefault();
    }

    function doResize(e) {
        if (!isResizing) return;
        const diff = e.clientX - startX;
        const newWidth = Math.max(150, Math.min(500, startWidth + diff));
        searchPanel.style.width = newWidth + 'px';
        filterPanel.style.width = newWidth + 'px';
    }

    function stopResize() {
        isResizing = false;
        resizeHandle.classList.remove('dragging');
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
    }

    // Setup Message Handlers
    function setupMessageHandlers() {
        window.addEventListener('message', (event) => {
            const message = event.data;

            switch (message.command) {
                case 'searchResults':
                    displaySearchResults(message);
                    break;
                case 'searchHistory':
                    displaySearchHistory(message.history);
                    break;
                case 'bookmarks':
                    displayBookmarks(message.bookmarks);
                    break;
                case 'highlightResult':
                    handleHighlightResult(message.result);
                    break;
                case 'bookmarkResult':
                    handleBookmarkResult(message.result);
                    break;
                case 'scrollToLine':
                    scrollToLine(message.lineNumber);
                    break;
                case 'showTools':
                    showToolsPanel();
                    break;
                case 'nextHighlightColor':
                    updateHighlightMenuColor(message.color);
                    break;
                case 'updateLines':
                    updateLinesContent(message.lines);
                    break;
                case 'recentFiles':
                    displayRecentFiles(message.files);
                    break;
                case 'fileLoaded':
                    handleFileLoaded(message);
                    break;
            }
        });
    }

    // Display recent files in empty state
    function displayRecentFiles(files) {
        const recentFilesSection = document.getElementById('recentFilesSection');
        const recentFilesList = document.getElementById('recentFilesList');
        
        if (!recentFilesSection || !recentFilesList) return;
        
        if (!files || files.length === 0) {
            recentFilesSection.classList.add('hidden');
            return;
        }
        
        recentFilesSection.classList.remove('hidden');
        
        const html = files.map(file => {
            const fileName = file.split(/[\\/]/).pop();
            return `
                <div class="recent-file-item" data-file-path="${escapeHtml(file)}">
                    <span class="file-icon"><i class="fa-solid fa-file-lines"></i></span>
                    <span class="file-name">${escapeHtml(fileName)}</span>
                    <span class="file-path">${escapeHtml(file)}</span>
                </div>
            `;
        }).join('');
        
        recentFilesList.innerHTML = html;
        
        // Add click handlers
        recentFilesList.querySelectorAll('.recent-file-item').forEach(item => {
            item.addEventListener('click', () => {
                vscode.postMessage({
                    command: 'openRecentFile',
                    filePath: item.dataset.filePath
                });
            });
        });
    }

    // Handle file loaded (switch from empty state to file view)
    function handleFileLoaded(message) {
        const emptyStateContainer = document.getElementById('emptyStateContainer');
        const headerBar = document.getElementById('headerBar');
        const mainContent = document.querySelector('.main-content');

        // Hide empty state
        if (emptyStateContainer) {
            emptyStateContainer.classList.add('hidden');
        }

        // Show header and main content
        if (headerBar) {
            headerBar.style.display = 'flex';
        }
        if (mainContent) {
            mainContent.style.display = 'flex';
        }

        // Request bookmarks and search history
        vscode.postMessage({ command: 'getBookmarks' });
        vscode.postMessage({ command: 'getSearchHistory' });
    }

    // Toolbar Functions
    function toggleSearchPanel() {
        // Close filter panel when opening search panel (mutual exclusion)
        if (filterPanel.classList.contains('visible')) {
            filterPanel.classList.remove('visible');
        }
        searchPanel.classList.toggle('visible');
        if (searchPanel.classList.contains('visible')) {
            document.getElementById('searchInput').focus();
        }
    }

    function hideSearchPanel() {
        searchPanel.classList.remove('visible');
        // Clear search result selection
        selectedSearchIndex = -1;
        searchResultItems.forEach(item => item.classList.remove('selected'));
    }

    function toggleSearchRegex() {
        const checkbox = document.getElementById('regexToggle');
        const btn = document.getElementById('regexToggleBtn');
        checkbox.checked = !checkbox.checked;
        btn.classList.toggle('active', checkbox.checked);
    }

    function toggleFilterPanel() {
        // Close search panel when opening filter panel (mutual exclusion)
        if (searchPanel.classList.contains('visible')) {
            searchPanel.classList.remove('visible');
            selectedSearchIndex = -1;
            searchResultItems.forEach(item => item.classList.remove('selected'));
        }
        filterPanel.classList.toggle('visible');
        if (filterPanel.classList.contains('visible')) {
            document.getElementById('filterInput').focus();
        }
    }

    function hideFilterPanel() {
        filterPanel.classList.remove('visible');
    }

    function toggleFilterRegex() {
        const checkbox = document.getElementById('filterRegexToggle');
        const btn = document.getElementById('filterRegexToggleBtn');
        checkbox.checked = !checkbox.checked;
        btn.classList.toggle('active', checkbox.checked);
    }

    function toggleMarkbookPanel() {
        markbookPanel.classList.toggle('visible');
    }

    function hideMarkbookPanel() {
        markbookPanel.classList.remove('visible');
    }

    function toggleToolsPanel() {
        toolsPanel.classList.toggle('visible');
    }

    function hideToolsPanel() {
        toolsPanel.classList.remove('visible');
    }

    function showToolsPanel() {
        toolsPanel.classList.add('visible');
    }

    // Search Functions
    function handleSearchKeydown(e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    }

    function performSearch() {
        const keyword = document.getElementById('searchInput').value;
        const useRegex = document.getElementById('regexToggle').checked;

        if (!keyword) return;

        vscode.postMessage({
            command: 'search',
            keyword: keyword,
            useRegex: useRegex
        });
    }

    function displaySearchResults(message) {
        const resultsContainer = document.getElementById('searchResults');
        const { keyword, results, totalCount } = message;

        if (totalCount === 0) {
            resultsContainer.innerHTML = '<div class="empty-state"><div class="empty-state-text">No results found</div></div>';
            searchResultItems = [];
            selectedSearchIndex = -1;
            return;
        }

        const html = results.map(result => `
            <div class="search-result-item" data-line="${result.lineNumber}">
                <span class="search-result-line">${result.lineNumber}</span>
                <span class="search-result-text">${escapeHtml(result.text)}</span>
            </div>
        `).join('');

        resultsContainer.innerHTML = html;

        // Store result items for keyboard navigation
        searchResultItems = Array.from(resultsContainer.querySelectorAll('.search-result-item'));
        selectedSearchIndex = -1;

        // Add click handlers to results
        searchResultItems.forEach((item, index) => {
            item.addEventListener('click', () => {
                // Update keyboard navigation index
                if (selectedSearchIndex >= 0 && searchResultItems[selectedSearchIndex]) {
                    searchResultItems[selectedSearchIndex].classList.remove('selected');
                }
                selectedSearchIndex = index;
                item.classList.add('selected');

                const lineNumber = parseInt(item.dataset.line);
                gotoLine(lineNumber);
            });
        });
    }

    function navigateSearchResults(direction) {
        if (searchResultItems.length === 0) return;

        // Remove previous selection highlight
        if (selectedSearchIndex >= 0 && searchResultItems[selectedSearchIndex]) {
            searchResultItems[selectedSearchIndex].classList.remove('selected');
        }

        // Calculate new index
        if (direction === 1) {
            selectedSearchIndex = (selectedSearchIndex + 1) % searchResultItems.length;
        } else {
            selectedSearchIndex = selectedSearchIndex <= 0 ? searchResultItems.length - 1 : selectedSearchIndex - 1;
        }

        // Highlight new selection and auto jump to line
        const selectedItem = searchResultItems[selectedSearchIndex];
        if (selectedItem) {
            selectedItem.classList.add('selected');
            selectedItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            // Auto jump to the line
            const lineNumber = parseInt(selectedItem.dataset.line);
            gotoLine(lineNumber);
        }
    }

    function displaySearchHistory(history) {
        const historyContainer = document.getElementById('searchHistory');
        if (!history || history.length === 0) {
            historyContainer.innerHTML = '';
            return;
        }

        const html = history.map(item => `
            <span class="history-item" data-keyword="${escapeHtml(item)}">${escapeHtml(item)}</span>
        `).join('');

        historyContainer.innerHTML = html;

        // Add click handlers
        historyContainer.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                document.getElementById('searchInput').value = item.dataset.keyword;
                performSearch();
            });
        });
    }

    function searchSelection() {
        // Use selection stored in context menu
        const selectionFromMenu = contextMenu.dataset.selection;
        const keywordToSearch = selectionFromMenu || currentSelection;

        if (keywordToSearch) {
            document.getElementById('searchInput').value = keywordToSearch;
            showSearchPanel();
            performSearch();
        }
    }

    // Filter Functions
    function handleFilterKeydown(e) {
        if (e.key === 'Enter') {
            applyFilter();
        }
    }

    function applyFilter() {
        const keyword = document.getElementById('filterInput').value;
        const useRegex = document.getElementById('filterRegexToggle').checked;

        if (!keyword) return;

        vscode.postMessage({
            command: 'filter',
            keyword: keyword,
            useRegex: useRegex
        });

        hideFilterPanel();
        showNotification('Filter applied in new tab', 'success');
    }

    function filterSelection() {
        // Use selection stored in context menu
        const selectionFromMenu = contextMenu.dataset.selection;
        const keywordToFilter = selectionFromMenu || currentSelection;

        if (keywordToFilter) {
            document.getElementById('filterInput').value = keywordToFilter;
            showFilterPanel();
        }
    }

    // Highlight Functions
    function highlightSelection(useRegex = false) {
        // Get selection from context menu data attribute (stored during right-click)
        const selectionFromMenu = contextMenu.dataset.selection;
        console.log('[Highlight] highlightSelection called, selectionFromMenu:', selectionFromMenu, 'currentSelection:', currentSelection);
        
        // Use the selection stored in context menu if available
        const keywordToHighlight = selectionFromMenu || currentSelection;
        
        if (keywordToHighlight) {
            console.log('[Highlight] Sending message to extension:', { command: 'highlight', keyword: keywordToHighlight, useRegex: useRegex });
            vscode.postMessage({
                command: 'highlight',
                keyword: keywordToHighlight,
                useRegex: useRegex
            });
        } else {
            console.log('[Highlight] No selection available, not sending message');
        }
    }

    function removeHighlight() {
        // Use selection stored in context menu (same pattern as highlightSelection)
        const selectionFromMenu = contextMenu.dataset.selection;
        const keywordToRemove = selectionFromMenu || currentSelection;

        if (keywordToRemove) {
            vscode.postMessage({
                command: 'removeHighlight',
                keyword: keywordToRemove
            });
        }
    }

    function clearAllHighlights() {
        // Send message to extension to clear all highlights
        vscode.postMessage({
            command: 'clearAllHighlights'
        });
    }

    function handleHighlightResult(result) {
        const action = result.action;
        const keyword = result.keyword;
        
        if (action === 'added') {
            showNotification(`Highlighted: "${keyword}"`, 'success');
        } else if (action === 'cleared') {
            showNotification('All highlights cleared', 'success');
        } else {
            showNotification(`Removed highlight: "${keyword}"`, 'success');
        }
    }

    // Bookmark Functions
    function addBookmark() {
        if (currentLineNumber) {
            const lineElement = document.querySelector(`.line[data-line="${currentLineNumber}"]`);
            const text = lineElement ? lineElement.querySelector('.line-content').textContent : '';
            
            vscode.postMessage({
                command: 'addBookmark',
                lineNumber: currentLineNumber,
                text: text,
                note: ''
            });
        }
    }

    function handleBookmarkResult(result) {
        const action = result.action;
        
        if (action === 'added') {
            showNotification(`Bookmarked line ${result.bookmark.lineNumber}`, 'success');
        } else {
            showNotification(`Removed bookmark from line ${result.lineNumber}`, 'success');
        }

        // Refresh bookmarks display
        vscode.postMessage({ command: 'getBookmarks' });
    }

    function displayBookmarks(bookmarks) {
        const listContainer = document.getElementById('markbookList');
        
        if (!bookmarks || bookmarks.length === 0) {
            listContainer.innerHTML = '<div class="empty-state"><div class="empty-state-text">No bookmarks</div></div>';
            return;
        }

        const html = bookmarks.map(bookmark => `
            <div class="markbook-item" data-line="${bookmark.lineNumber}">
                <div class="markbook-item-line">Line ${bookmark.lineNumber}</div>
                <div class="markbook-item-text">${escapeHtml(bookmark.text)}</div>
                ${bookmark.note ? `<div class="markbook-item-note">${escapeHtml(bookmark.note)}</div>` : ''}
            </div>
        `).join('');

        listContainer.innerHTML = html;

        // Add click handlers
        listContainer.querySelectorAll('.markbook-item').forEach(item => {
            item.addEventListener('click', () => {
                const lineNumber = parseInt(item.dataset.line);
                gotoLine(lineNumber);
            });
        });
    }

    // Tools Functions
    function hexToString() {
        const input = document.getElementById('hexStringInput').value.trim();
        if (!input) return;

        try {
            // Remove spaces and 0x prefix
            const hex = input.replace(/\s/g, '').replace(/^0x/, '');
            
            // Convert hex to string
            let result = '';
            for (let i = 0; i < hex.length; i += 2) {
                const byte = parseInt(hex.substr(i, 2), 16);
                if (!isNaN(byte)) {
                    result += String.fromCharCode(byte);
                }
            }
            
            document.getElementById('hexStringResult').textContent = result;
        } catch (error) {
            document.getElementById('hexStringResult').textContent = 'Error: Invalid hex';
        }
    }

    function stringToHex() {
        const input = document.getElementById('hexStringInput').value;
        if (!input) return;

        try {
            let result = '';
            for (let i = 0; i < input.length; i++) {
                const hex = input.charCodeAt(i).toString(16).padStart(2, '0');
                result += hex + ' ';
            }
            
            document.getElementById('hexStringResult').textContent = result.trim().toUpperCase();
        } catch (error) {
            document.getElementById('hexStringResult').textContent = 'Error: Conversion failed';
        }
    }

    function convertBase(targetBase) {
        const input = document.getElementById('baseInput').value.trim();
        if (!input) return;

        try {
            // Detect input base
            let decimal;
            if (input.startsWith('0x') || input.startsWith('0X')) {
                decimal = parseInt(input, 16);
            } else if (input.startsWith('0b') || input.startsWith('0B')) {
                decimal = parseInt(input.slice(2), 2);
            } else if (input.startsWith('0o') || input.startsWith('0O')) {
                decimal = parseInt(input.slice(2), 8);
            } else if (input.startsWith('0') && input.length > 1) {
                decimal = parseInt(input, 8);
            } else {
                decimal = parseInt(input, 10);
            }

            if (isNaN(decimal)) {
                document.getElementById('baseResult').textContent = 'Error: Invalid number';
                return;
            }

            let result;
            switch (targetBase) {
                case 'hex':
                    result = '0x' + decimal.toString(16).toUpperCase();
                    break;
                case 'dec':
                    result = decimal.toString(10);
                    break;
                case 'oct':
                    result = '0o' + decimal.toString(8);
                    break;
                case 'bin':
                    result = '0b' + decimal.toString(2);
                    break;
                default:
                    result = decimal.toString(10);
            }

            document.getElementById('baseResult').textContent = result;
        } catch (error) {
            document.getElementById('baseResult').textContent = 'Error: Conversion failed';
        }
    }

    // Line Navigation
    function handleLineClick(e) {
        const lineElement = e.target.closest('.line');
        if (lineElement) {
            // Remove previous selection
            document.querySelectorAll('.line.selected').forEach(line => {
                line.classList.remove('selected');
            });

            // Add selection to clicked line
            lineElement.classList.add('selected');
            currentLineNumber = parseInt(lineElement.dataset.line);
        }
    }

    function gotoLine(lineNumber) {
        const lineElement = document.querySelector(`.line[data-line="${lineNumber}"]`);
        if (lineElement) {
            lineElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Highlight the line
            document.querySelectorAll('.line.selected').forEach(line => {
                line.classList.remove('selected');
            });
            lineElement.classList.add('selected');
            currentLineNumber = lineNumber;
        }
    }

    function scrollToLine(lineNumber) {
        gotoLine(lineNumber);
    }

    // Context Menu
    function handleContextMenu(e) {
        e.preventDefault();

        // Capture current selection immediately to prevent it from being lost
        const selection = window.getSelection();
        let capturedSelection = selection.toString().trim();
        console.log('[ContextMenu] Captured selection:', capturedSelection);

        // If no selection, try to get text from the clicked line
        if (!capturedSelection) {
            const lineElement = e.target.closest('.line');
            if (lineElement) {
                const lineContent = lineElement.querySelector('.line-content');
                if (lineContent) {
                    capturedSelection = lineContent.textContent.trim();
                    console.log('[ContextMenu] Using line content as selection:', capturedSelection);
                }
            }
        }
        
        // Store in a data attribute on the context menu for later use
        contextMenu.dataset.selection = capturedSelection;
        currentSelection = capturedSelection;
        console.log('[ContextMenu] Stored selection in contextMenu.dataset.selection:', contextMenu.dataset.selection);

        const lineElement = e.target.closest('.line');
        if (lineElement) {
            currentLineNumber = parseInt(lineElement.dataset.line);
        }

        // Update context menu visibility based on state
        const ctxGotoOriginal = document.getElementById('ctxGotoOriginal');
        if (isFilterView) {
            ctxGotoOriginal.style.display = 'flex';
        } else {
            ctxGotoOriginal.style.display = 'none';
        }

        // Show context menu
        const x = e.clientX;
        const y = e.clientY;
        
        contextMenu.style.left = `${x}px`;
        contextMenu.style.top = `${y}px`;
        contextMenu.classList.add('visible');
    }

    function hideContextMenu() {
        contextMenu.classList.remove('visible');
    }

    // Sync to Original (for filter view)
    function syncToOriginal() {
        if (isFilterView && currentLineNumber && originalPanelId) {
            vscode.postMessage({
                command: 'syncToOriginal',
                lineNumber: currentLineNumber
            });
        }
    }

    // Update highlight menu color icon
    function updateHighlightMenuColor(color) {
        const ctxHighlightIcon = document.querySelector('#ctxHighlight i');
        if (ctxHighlightIcon && color) {
            ctxHighlightIcon.style.color = color.bg;
        }
    }

    // Update lines content (partial update for performance)
    function updateLinesContent(lines) {
        if (!lines || lines.length === 0) return;
        
        console.log('[UpdateLines] Updating', lines.length, 'lines');
        
        for (const lineData of lines) {
            const lineElement = document.querySelector(`.line[data-line="${lineData.lineNumber}"]`);
            if (lineElement) {
                const contentElement = lineElement.querySelector('.line-content');
                const bookmarkElement = lineElement.querySelector('.bookmark-icon');
                
                if (contentElement) {
                    contentElement.innerHTML = lineData.highlightedText;
                }
                
                if (bookmarkElement) {
                    bookmarkElement.innerHTML = lineData.isBookmarked ? '<i class="fa-solid fa-bookmark"></i>' : '';
                }
            }
        }
        
        console.log('[UpdateLines] Lines updated successfully');
    }

    // Selection Handling
    function handleSelectionChange() {
        const selection = window.getSelection();
        currentSelection = selection.toString().trim();
    }

    // Copy Function
    // Copy current selection (for context menu)
    function copyCurrentSelection() {
        // First try to get from context menu stored selection (captured during right-click)
        const storedSelection = contextMenu.dataset.selection;
        
        // Fallback to current window selection
        const selection = window.getSelection();
        const currentText = selection.toString().trim();
        
        // Use stored selection first, then current selection
        const text = storedSelection || currentText;
        
        console.log('[Copy] Stored selection:', storedSelection);
        console.log('[Copy] Current selection:', currentText);
        console.log('[Copy] Using text:', text);
        
        if (text) {
            navigator.clipboard.writeText(text).then(() => {
                showNotification('Copied to clipboard', 'success');
            }).catch(() => {
                showNotification('Failed to copy', 'error');
            });
        } else {
            showNotification('No text selected', 'error');
        }
    }

    // Keyboard shortcuts handler
    function handleKeyboardShortcuts(e) {
        // Handle search result navigation when search panel is visible
        if (searchPanel.classList.contains('visible') && searchResultItems.length > 0) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                navigateSearchResults(e.key === 'ArrowDown' ? 1 : -1);
                return;
            }
            if (e.key === 'Enter' && selectedSearchIndex >= 0) {
                e.preventDefault();
                const item = searchResultItems[selectedSearchIndex];
                if (item) {
                    const lineNumber = parseInt(item.dataset.line);
                    gotoLine(lineNumber);
                }
                return;
            }
        }

        // Don't trigger shortcuts when typing in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        // Ctrl+C / Cmd+C - Copy selection
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            const selection = window.getSelection();
            if (selection.toString().trim()) {
                // Let default copy behavior work, but show notification
                navigator.clipboard.writeText(selection.toString()).then(() => {
                    showNotification('Copied to clipboard', 'success');
                }).catch(() => {
                    // Silent fail - browser may have already copied
                });
            }
            return;
        }

        // Ctrl+F / Cmd+F - Open search
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            e.stopPropagation();
            toggleSearchPanel();
            return;
        }

        // Ctrl+H / Cmd+H - Open filter panel
        if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
            e.preventDefault();
            e.stopPropagation();
            toggleFilterPanel();
            return;
        }

        // Ctrl+G / Cmd+G - Open goto line dialog
        if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
            e.preventDefault();
            e.stopPropagation();
            openGotoLineDialog();
            return;
        }

        // Ctrl+B / Cmd+B - Toggle markbook panel
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
            e.preventDefault();
            e.stopPropagation();
            toggleMarkbookPanel();
            return;
        }

        // Ctrl+X / Cmd+X - Toggle tools panel
        if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
            e.preventDefault();
            e.stopPropagation();
            toggleToolsPanel();
            return;
        }
    }

    // Open goto line dialog
    function openGotoLineDialog() {
        const lineNumber = prompt('Go to line:');
        if (lineNumber) {
            const num = parseInt(lineNumber);
            if (!isNaN(num) && num > 0) {
                gotoLine(num);
            } else {
                showNotification('Invalid line number', 'error');
            }
        }
    }

    // Notification
    function showNotification(message, type = 'info') {
        notification.textContent = message;
        notification.className = `notification ${type} visible`;

        setTimeout(() => {
            notification.classList.remove('visible');
        }, 3000);
    }

    // Utility Functions
    function escapeHtml(text) {
        if (!text) return '';
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
