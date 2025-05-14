document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = 'http://localhost:3030';
    let toastTimeout;
    
    // Pagination state
    const ITEMS_PER_PAGE = 10;
    let currentPage = 1;
    let allDocuments = [];
    
    // DOM Elements
    const docUrlInput = document.getElementById('docUrl');
    const extractUrlsBtn = document.getElementById('extractUrlsBtn');
    const extractedUrlsSection = document.getElementById('extractedUrls');
    const urlList = extractedUrlsSection.querySelector('.url-list');
    const addAllUrlsBtn = document.getElementById('addAllUrlsBtn');
    const clearUrlsBtn = document.getElementById('clearUrlsBtn');
    const clearQueueBtn = document.getElementById('clearQueueBtn');
    const queueList = document.getElementById('queueList');
    const queueCount = document.getElementById('queueCount');
    const documentsList = document.getElementById('documentsList');
    const searchQuery = document.getElementById('searchQuery');
    const searchBtn = document.getElementById('searchBtn');
    const searchResults = document.getElementById('searchResults');
    const toast = document.getElementById('toast');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const currentPageSpan = document.getElementById('currentPage');
    const totalPagesSpan = document.getElementById('totalPages');
    const llmStatusMessageDiv = document.getElementById('llmStatusMessage');
    const llmStatusMessageSpan = llmStatusMessageDiv.querySelector('span');
    
    // DOM Elements for Local Repositories
    const repoPathInput = document.getElementById('repoPath');
    const addRepoBtn = document.getElementById('addRepoBtn');
    const repositoriesList = document.getElementById('repositoriesList');
    
    // Track queue state for document updates
    let previousQueueState = [];
    let previousQueueHtml = '';
    let queueUpdateTimer = null;
    
    // Track selected documents
    let selectedDocuments = new Set();
    
    // Check if documents need updating based on queue changes
    function shouldUpdateDocuments(newQueue) {
        // If no previous state, just store and return
        if (previousQueueState.length === 0) {
            previousQueueState = [...newQueue];
            return false;
        }
        
        // If lengths are different, queue items were added/removed
        if (previousQueueState.length !== newQueue.length) {
            previousQueueState = [...newQueue];
            return false; // No need to update docs when items are just added
        }
        
        // Check if any items changed from PROCESSING to COMPLETED
        const hasNewCompletions = newQueue.some((item, index) => {
            const prevItem = previousQueueState[index];
            return prevItem && 
                   prevItem.status === 'PROCESSING' && 
                   item.status === 'COMPLETED';
        });
        
        // Only update previous state if we found completions
        if (hasNewCompletions) {
            previousQueueState = [...newQueue];
        }
        
        return hasNewCompletions;
    }
    
    // Helper function to set button loading state with text
    function setButtonLoading(button, isLoading, loadingText = 'Loading...') {
        if (isLoading) {
            button.dataset.originalHtml = button.innerHTML;
            button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${loadingText}`;
            button.classList.add('loading');
            button.disabled = true;
        } else {
            button.innerHTML = button.dataset.originalHtml;
            button.classList.remove('loading');
            button.disabled = false;
            delete button.dataset.originalHtml;
        }
    }
    
    // Toast functionality
    function showToast(message, type = 'success') {
        if (toastTimeout) {
            clearTimeout(toastTimeout);
            toast.classList.add('hidden');
            // Wait for animation to complete
            setTimeout(() => {
                displayToast(message, type);
            }, 300);
        } else {
            displayToast(message, type);
        }
    }
    
    function displayToast(message, type) {
        const toastMessage = toast.querySelector('.message');
        toastMessage.textContent = message;
        toast.className = `toast ${type}`;
        toast.classList.remove('hidden');
        
        toastTimeout = setTimeout(() => {
            toast.classList.add('hidden');
            toastTimeout = null;
        }, 3000);
    }
    
    toast.querySelector('.close').addEventListener('click', () => {
        toast.classList.add('hidden');
        if (toastTimeout) {
            clearTimeout(toastTimeout);
            toastTimeout = null;
        }
    });
    
    // Extract URLs
    extractUrlsBtn.addEventListener('click', async () => {
        const url = docUrlInput.value.trim();
        if (!url) {
            showToast('Please enter a URL', 'error');
            return;
        }
        
        setButtonLoading(extractUrlsBtn, true, 'Extracting URLs...');
        try {
            const response = await fetch(`${API_BASE_URL}/extract-urls`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url })
            });
            
            if (!response.ok) throw new Error('Failed to extract URLs');
            
            const { urls } = await response.json();
            
            if (urls.length === 0) {
                showToast('No URLs found', 'error');
                return;
            }
            
            urlList.innerHTML = urls.map(url => `
                <div class="flex items-center gap-2 p-2 hover:bg-slate-50">
                    <input type="checkbox" checked class="rounded border-slate-300 text-primary focus:ring-primary">
                    <span class="text-sm text-slate-700">${url}</span>
                </div>
            `).join('');
            
            extractedUrlsSection.classList.remove('hidden');
            showToast(`Found ${urls.length} URLs`);
        } catch (error) {
            console.error('Error extracting URLs:', error);
            showToast('Failed to extract URLs', 'error');
        } finally {
            setButtonLoading(extractUrlsBtn, false);
        }
    });
    
    // Add all extracted URLs
    addAllUrlsBtn.addEventListener('click', async () => {
        const selectedUrls = Array.from(urlList.querySelectorAll('input[type="checkbox"]:checked'))
            .map(checkbox => checkbox.nextElementSibling.textContent.trim());
        
        if (selectedUrls.length === 0) {
            showToast('No URLs selected', 'error');
            return;
        }
        
        setButtonLoading(addAllUrlsBtn, true, 'Adding URLs...');
        try {
            const response = await fetch(`${API_BASE_URL}/add-doc`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ urls: selectedUrls })
            });
            
            if (!response.ok) throw new Error('Failed to add URLs');
            
            showToast(`Added ${selectedUrls.length} URLs to queue`);
            extractedUrlsSection.classList.add('hidden');
            docUrlInput.value = '';
            updateQueue();
        } catch (error) {
            console.error('Error adding URLs:', error);
            showToast('Failed to add URLs to queue', 'error');
        } finally {
            setButtonLoading(addAllUrlsBtn, false);
        }
    });
    
    // Clear extracted URLs
    clearUrlsBtn.addEventListener('click', () => {
        urlList.innerHTML = '';
        extractedUrlsSection.classList.add('hidden');
        docUrlInput.value = '';
    });
    
    // Update queue list with debounce
    function startQueuePolling() {
        if (queueUpdateTimer) {
            clearInterval(queueUpdateTimer);
        }
        queueUpdateTimer = setInterval(updateQueue, 5000);
    }
    
    // Clear queue
    clearQueueBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to clear the queue?')) return;
        
        setButtonLoading(clearQueueBtn, true, 'Clearing queue...');
        try {
            const response = await fetch(`${API_BASE_URL}/clear-queue`, {
                method: 'POST'
            });
            
            if (!response.ok) throw new Error('Failed to clear queue');
            
            // Stop current polling
            if (queueUpdateTimer) {
                clearInterval(queueUpdateTimer);
            }
            
            // Reset queue state
            previousQueueState = [];
            previousQueueHtml = '';
            queueCount.textContent = '(0 items)';
            queueList.innerHTML = '<div class="p-8 text-center text-slate-500">No documents in queue</div>';
            
            showToast('Queue cleared successfully');
            
            // Wait for 2 seconds before resuming polling to ensure server has processed the clear
            setTimeout(() => {
                updateQueue();  // Do one immediate update
                startQueuePolling();  // Resume polling
            }, 2000);
            
        } catch (error) {
            console.error('Error clearing queue:', error);
            showToast('Failed to clear queue', 'error');
        } finally {
            setButtonLoading(clearQueueBtn, false);
        }
    });
    
    // Process queue
    const processQueueBtn = document.getElementById('processQueueBtn');
    processQueueBtn.addEventListener('click', async () => {
        setButtonLoading(processQueueBtn, true, 'Starting queue...');
        try {
            const response = await fetch(`${API_BASE_URL}/process-queue`, {
                method: 'POST'
            });
            
            if (!response.ok) throw new Error('Failed to start queue processing');
            
            showToast('Queue processing started');
            
            // Do an immediate queue update to show status changes
            updateQueue();
            
        } catch (error) {
            console.error('Error starting queue:', error);
            showToast('Failed to start queue processing', 'error');
        } finally {
            setButtonLoading(processQueueBtn, false);
        }
    });
    
    // Update queue list
    async function updateQueue() {
        try {
            const response = await fetch(`${API_BASE_URL}/queue`);
            if (!response.ok) throw new Error('Failed to fetch queue');
            
            const queue = await response.json();
            
            // Generate new HTML
            const newHtml = generateQueueHtml(queue);
            
            // Only update DOM if content has changed
            if (newHtml !== previousQueueHtml) {
                queueList.innerHTML = newHtml;
                previousQueueHtml = newHtml;
            }
            
            // Only update documents if processing completed
            if (shouldUpdateDocuments(queue)) {
                updateDocuments();
            }
        } catch (error) {
            console.error('Error fetching queue:', error);
            if (!queueList.querySelector('.error-message')) {
                queueList.innerHTML = '<div class="p-8 text-center text-red-500 error-message"><i class="fas fa-exclamation-circle mr-2"></i>Failed to load queue</div>';
            }
        }
    }
    
    // Generate queue HTML without directly manipulating DOM
    function generateQueueHtml(queue) {
        if (!Array.isArray(queue) || queue.length === 0) {
            queueCount.textContent = '(0 items)';
            return '<div class="p-8 text-center text-slate-500">No documents in queue</div>';
        }
        
        // Update queue count
        queueCount.textContent = `(${queue.length} item${queue.length === 1 ? '' : 's'})`;
        
        // Group items by status
        const groupedByStatus = queue.reduce((acc, item) => {
            const status = item.status.toUpperCase();
            if (!acc[status]) acc[status] = [];
            acc[status].push(item);
            return acc;
        }, {});
        
        // Generate HTML for grouped items
        return Object.entries(groupedByStatus).map(([status, items]) => `
            <div class="status-group">
                <div class="bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
                    ${status} (${items.length})
                </div>
                ${items.map(item => `
                    <div class="p-4 flex justify-between items-center hover:bg-slate-50 group">
                        <div class="flex-1">
                            <div class="text-sm font-medium text-slate-700 truncate">${item.url}</div>
                            <div class="text-xs text-slate-500">Added: ${new Date(item.timestamp).toLocaleString()}</div>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-1 text-xs rounded-full ${getStatusClass(item.status)}">${item.status}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        `).join('');
    }
    
    // Pagination functions
    function updatePaginationControls(totalItems) {
        const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
        currentPageSpan.textContent = currentPage;
        totalPagesSpan.textContent = totalPages;
        
        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage === totalPages || totalItems === 0;

        // If current page is greater than total pages, reset to last page
        if (currentPage > totalPages) {
            currentPage = totalPages;
            displayDocuments(allDocuments);
        }
    }
    
    function getPageItems(items, page) {
        const start = (page - 1) * ITEMS_PER_PAGE;
        return items.slice(start, Math.min(start + ITEMS_PER_PAGE, items.length));
    }
    
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            displayDocuments(allDocuments);
        }
    });
    
    nextPageBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(allDocuments.length / ITEMS_PER_PAGE);
        if (currentPage < totalPages) {
            currentPage++;
            displayDocuments(allDocuments);
        }
    });
    
    // Get status class for queue items
    function getStatusClass(status) {
        switch (status.toUpperCase()) {
            case 'PENDING':
                return 'bg-yellow-100 text-yellow-800';
            case 'PROCESSING':
                return 'bg-blue-100 text-blue-800';
            case 'COMPLETED':
                return 'bg-green-100 text-green-800';
            case 'FAILED':
                return 'bg-red-100 text-red-800';
            default:
                return 'bg-slate-100 text-slate-800';
        }
    }
    
    // Update documents list
    async function updateDocuments() {
        documentsList.innerHTML = '<div class="p-8 text-center text-slate-500"><i class="fas fa-spinner fa-spin mr-2"></i>Loading documents...</div>';
        try {
            const response = await fetch(`${API_BASE_URL}/documents`);
            if (!response.ok) throw new Error('Failed to fetch documents');
            
            const documents = await response.json();
            allDocuments = documents;
            displayDocuments(documents);
        } catch (error) {
            console.error('Error fetching documents:', error);
            documentsList.innerHTML = '<div class="p-8 text-center text-red-500"><i class="fas fa-exclamation-circle mr-2"></i>Failed to load documents</div>';
        }
    }
    
    // Display documents
    function displayDocuments(documents) {
        if (documents.length === 0) {
            documentsList.innerHTML = '<div class="p-8 text-center text-slate-500">No documents available</div>';
            updatePaginationControls(0);
            return;
        }
        
        const pageItems = getPageItems(documents, currentPage);
        
        // Add header with select all and bulk actions
        documentsList.innerHTML = `
            <div class="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div class="flex items-center gap-4">
                    <div class="flex items-center gap-2">
                        <input type="checkbox" id="selectAll" class="rounded border-slate-300 text-primary focus:ring-primary"
                               ${pageItems.length > 0 && selectedDocuments.size === pageItems.length ? 'checked' : ''}>
                        <label for="selectAll" class="text-sm text-slate-600">Select All</label>
                    </div>
                    <span class="text-sm text-slate-500 border-l border-slate-300 pl-4">
                        Total: ${documents.length} document${documents.length === 1 ? '' : 's'}
                    </span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="bulk-actions ${selectedDocuments.size > 0 ? '' : 'hidden'}">
                        <span class="text-sm text-slate-600 mr-2">${selectedDocuments.size} selected</span>
                        <button id="removeSelected" class="btn-danger">
                            <i class="fas fa-trash"></i> Remove Selected
                        </button>
                    </div>
                    <button id="removeAll" class="btn-danger ${documents.length > 0 ? '' : 'hidden'}">
                        <i class="fas fa-trash"></i> Remove All
                    </button>
                </div>
            </div>
            ${pageItems.map(doc => `
                <div class="p-4 flex justify-between items-center hover:bg-slate-50 group">
                    <div class="flex items-center gap-4 flex-1">
                        <input type="checkbox" class="doc-checkbox rounded border-slate-300 text-primary focus:ring-primary"
                               data-url="${doc.url}" ${selectedDocuments.has(doc.url) ? 'checked' : ''}>
                        <div>
                            <div class="font-medium text-slate-700">${doc.title}</div>
                            <div class="text-sm text-slate-500 truncate">${doc.url}</div>
                            <div class="text-xs text-slate-400">Added: ${new Date(doc.timestamp).toLocaleString()}</div>
                        </div>
                    </div>
                    <button class="btn-danger remove-doc opacity-0 group-hover:opacity-100 transition-opacity" data-url="${doc.url}">
                        <i class="fas fa-trash"></i>
                        <span class="tooltip">Click to remove</span>
                    </button>
                </div>
            `).join('')}
        `;
        
        updatePaginationControls(documents.length);
        
        // Add event listeners
        const selectAllCheckbox = documentsList.querySelector('#selectAll');
        const removeSelectedBtn = documentsList.querySelector('#removeSelected');
        const removeAllBtn = documentsList.querySelector('#removeAll');
        const checkboxes = documentsList.querySelectorAll('.doc-checkbox');
        const bulkActions = documentsList.querySelector('.bulk-actions');
        
        // Select All functionality
        selectAllCheckbox?.addEventListener('change', () => {
            checkboxes.forEach(checkbox => {
                checkbox.checked = selectAllCheckbox.checked;
                const url = checkbox.dataset.url;
                if (selectAllCheckbox.checked) {
                    selectedDocuments.add(url);
                } else {
                    selectedDocuments.delete(url);
                }
            });
            bulkActions?.classList.toggle('hidden', selectedDocuments.size === 0);
        });
        
        // Individual checkbox functionality
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const url = checkbox.dataset.url;
                if (checkbox.checked) {
                    selectedDocuments.add(url);
                } else {
                    selectedDocuments.delete(url);
                }
                selectAllCheckbox.checked = checkboxes.length === selectedDocuments.size;
                bulkActions?.classList.toggle('hidden', selectedDocuments.size === 0);
            });
        });
        
        // Remove Selected functionality
        removeSelectedBtn?.addEventListener('click', async () => {
            if (selectedDocuments.size === 0) return;
            
            if (!confirm(`Are you sure you want to remove ${selectedDocuments.size} selected document${selectedDocuments.size === 1 ? '' : 's'}?`)) return;
            
            setButtonLoading(removeSelectedBtn, true, 'Removing...');
            try {
                const response = await fetch(`${API_BASE_URL}/documents`, {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ urls: Array.from(selectedDocuments) })
                });
                
                if (!response.ok) throw new Error('Failed to remove documents');
                
                const result = await response.json();
                showToast(result.message);
                selectedDocuments.clear();
                updateDocuments();
            } catch (error) {
                console.error('Error removing documents:', error);
                showToast('Failed to remove documents', 'error');
            } finally {
                setButtonLoading(removeSelectedBtn, false);
            }
        });
        
        // Remove All functionality
        removeAllBtn?.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to remove ALL documents? This action cannot be undone.')) return;
            
            setButtonLoading(removeAllBtn, true, 'Removing all...');
            try {
                const response = await fetch(`${API_BASE_URL}/documents/all`, {
                    method: 'DELETE'
                });
                
                if (!response.ok) throw new Error('Failed to remove all documents');
                
                const result = await response.json();
                showToast(result.message);
                selectedDocuments.clear();
                updateDocuments();
            } catch (error) {
                console.error('Error removing all documents:', error);
                showToast('Failed to remove all documents', 'error');
            } finally {
                setButtonLoading(removeAllBtn, false);
            }
        });
        
        // Individual remove buttons
        documentsList.querySelectorAll('.remove-doc').forEach(button => {
            button.addEventListener('click', async () => {
                const url = button.dataset.url;
                if (!confirm('Are you sure you want to remove this document?')) return;
                
                button.classList.add('deleting');
                button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing...';
                
                try {
                    const response = await fetch(`${API_BASE_URL}/documents`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ url })
                    });
                    
                    if (!response.ok) throw new Error('Failed to remove document');
                    
                    const result = await response.json();
                    showToast(result.message);
                    selectedDocuments.delete(url);
                    updateDocuments();
                } catch (error) {
                    console.error('Error removing document:', error);
                    showToast('Failed to remove document', 'error');
                    button.classList.remove('deleting');
                    button.innerHTML = '<i class="fas fa-trash"></i><span class="tooltip">Click to remove</span>';
                }
            });
        });
    }
    
    // Display search results
    function displaySearchResults(results) {
        if (!Array.isArray(results) || results.length === 0) {
            searchResults.innerHTML = '<div class="p-8 text-center text-slate-500">No results found</div>';
            return;
        }
        
        searchResults.innerHTML = results.map(result => `
            <div class="p-4 border border-slate-200 rounded-md hover:bg-slate-50">
                <a href="${result.url}" target="_blank" class="font-medium text-primary hover:underline">${result.title}</a>
                <p class="text-sm text-slate-600 mt-2">${result.snippet || result.content}</p>
                <div class="text-xs text-slate-400 mt-1 truncate">${result.url}</div>
            </div>
        `).join('');
    }
    
    // Search documentation
    searchBtn.addEventListener('click', async () => {
        const query = searchQuery.value.trim();
        if (!query) {
            showToast('Please enter a search query', 'error');
            return;
        }
        
        setButtonLoading(searchBtn, true, 'Searching...');
        try {
            const response = await fetch(`${API_BASE_URL}/search`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ query })
            });
            
            if (!response.ok) throw new Error('Failed to search');
            
            const data = await response.json();
            displaySearchResults(data.results);
        } catch (error) {
            console.error('Error searching:', error);
            showToast('Failed to search documentation', 'error');
            searchResults.innerHTML = '<div class="text-center text-slate-500 p-4">Search failed. Please try again.</div>';
        } finally {
            setButtonLoading(searchBtn, false);
        }
    });
    
    // Handle Enter key in search input
    searchQuery.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchBtn.click();
        }
    });
    
    // Add URL on Enter key
    docUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            extractUrlsBtn.click();
        }
    });
    
    // Update repositories list
    async function updateRepositories() {
        repositoriesList.innerHTML = '<div class="p-8 text-center text-slate-500"><i class="fas fa-spinner fa-spin mr-2"></i>Loading repositories...</div>';
        try {
            const response = await fetch(`${API_BASE_URL}/repositories`);
            if (!response.ok) throw new Error('Failed to fetch repositories');
            
            const repositories = await response.json();
            displayRepositories(repositories);
        } catch (error) {
            console.error('Error fetching repositories:', error);
            repositoriesList.innerHTML = `<div class="p-8 text-center text-red-500"><i class="fas fa-exclamation-circle mr-2"></i>Failed to load repositories: ${error.message}</div>`;
        }
    }
    
    // Display repositories
    function displayRepositories(repositories) {
        if (!Array.isArray(repositories) || repositories.length === 0) {
            repositoriesList.innerHTML = '<div class="p-8 text-center text-slate-500">No local repositories added yet.</div>';
            return;
        }
        
        repositoriesList.innerHTML = repositories.map(repo => `
            <div class="p-4 flex justify-between items-center hover:bg-slate-50 group">
                <div class="flex-1">
                    <div class="font-medium text-slate-700">${repo.name || 'Unnamed Repository'}</div>
                    <div class="text-sm text-slate-500 truncate">${repo.path}</div>
                    <div class="text-xs text-slate-400">Added: ${new Date(repo.timestamp).toLocaleString()}</div>
                </div>
                <div class="flex items-center gap-2">
                    <button class="btn-secondary update-repo opacity-0 group-hover:opacity-100 transition-opacity" data-path="${repo.path}">
                        <i class="fas fa-sync-alt"></i>
                        <span class="tooltip">Update</span>
                    </button>
                    <button class="btn-danger remove-repo opacity-0 group-hover:opacity-100 transition-opacity" data-path="${repo.path}">
                        <i class="fas fa-trash"></i>
                        <span class="tooltip">Remove</span>
                    </button>
                </div>
            </div>
        `).join('');
        
        // Add event listeners for remove and update buttons
        repositoriesList.querySelectorAll('.remove-repo').forEach(button => {
            button.addEventListener('click', async () => {
                const path = button.dataset.path;
                if (!confirm(`Are you sure you want to remove the repository at "${path}"?`)) return;
                
                button.classList.add('deleting');
                button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Removing...';
                
                try {
                    const response = await fetch(`${API_BASE_URL}/remove-repository`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ path })
                    });
                    
                    if (!response.ok) throw new Error('Failed to remove repository');
                    
                    const result = await response.json();
                    showToast(result.message);
                    updateRepositories();
                } catch (error) {
                    console.error('Error removing repository:', error);
                    showToast('Failed to remove repository', 'error');
                    button.classList.remove('deleting');
                    button.innerHTML = '<i class="fas fa-trash"></i><span class="tooltip">Click to remove</span>';
                }
            });
        });

        repositoriesList.querySelectorAll('.update-repo').forEach(button => {
            button.addEventListener('click', async () => {
                const path = button.dataset.path;
                
                setButtonLoading(button, true, 'Updating...');
                
                try {
                    const response = await fetch(`${API_BASE_URL}/update-repository`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ path })
                    });
                    
                    if (!response.ok) throw new Error('Failed to update repository');
                    
                    const result = await response.json();
                    showToast(result.message);
                    // No need to update the list immediately, status will be reflected in the queue
                } catch (error) {
                    console.error('Error updating repository:', error);
                    showToast('Failed to update repository', 'error');
                } finally {
                    setButtonLoading(button, false);
                }
            });
        });
    }
    
    // Add repository
    addRepoBtn.addEventListener('click', async () => {
        const path = repoPathInput.value.trim();
        if (!path) {
            showToast('Please enter a repository path', 'error');
            return;
        }
        
        setButtonLoading(addRepoBtn, true, 'Adding repository...');
        try {
            const response = await fetch(`${API_BASE_URL}/watch-repository`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path })
            });
            
            if (!response.ok) throw new Error('Failed to add repository');
            
            const result = await response.json();
            showToast(result.message);
            repoPathInput.value = '';
            updateRepositories(); // Refresh the list after adding
            updateQueue(); // Update queue as adding a repo adds to the queue
        } catch (error) {
            console.error('Error adding repository:', error);
            showToast('Failed to add repository', 'error');
        } finally {
            setButtonLoading(addRepoBtn, false);
        }
    });
    
    // Handle Enter key in repository path input
    repoPathInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addRepoBtn.click();
        }
    });
    
    // Fetch and display LLM availability status
    async function checkLlmStatus() {
        try {
            const response = await fetch(`${API_BASE_URL}/status`);
            if (!response.ok) throw new Error('Failed to fetch status');
            
            const status = await response.json();
            
            if (!status.llmStatus.overallAvailable) {
                let errorMessage = `No LLM providers available.`;
                if (status.llmStatus.primary && !status.llmStatus.primary.available) {
                    errorMessage += ` Primary (${status.llmStatus.primary.provider}) failed: ${status.llmStatus.primary.error}`;
                }
                if (status.llmStatus.fallback && !status.llmStatus.fallback.available) {
                    errorMessage += ` Fallback (${status.llmStatus.fallback.provider}) failed: ${status.llmStatus.fallback.error}`;
                }
                llmStatusMessageSpan.textContent = errorMessage;
                llmStatusMessageDiv.classList.remove('hidden');
            } else {
                llmStatusMessageDiv.classList.add('hidden');
            }
        } catch (error) {
            console.error('Error fetching LLM status:', error);
            llmStatusMessageSpan.textContent = `Failed to fetch LLM status: ${error.message}`;
            llmStatusMessageDiv.classList.remove('hidden');
        }
    }
    
    // Initial updates
    updateQueue();
    updateDocuments();
    updateRepositories(); // Load repositories on page load
    checkLlmStatus(); // Check LLM status on page load
    
    // Start polling
    startQueuePolling();
});
