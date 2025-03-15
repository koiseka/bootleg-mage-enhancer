import { showStatus, updateDataStatus, safeApiCall } from '../utilities.js';

document.addEventListener('DOMContentLoaded', () => {
  // Settings tab elements
  const refreshButton = document.getElementById('refreshButton');
  const statusDiv = document.getElementById('status');
  const dataStatusSpan = document.getElementById('dataStatus');
  const lastUpdatedSpan = document.getElementById('lastUpdated');
  const jsonUrlDisplay = document.getElementById('jsonUrlDisplay');
  
  // Default JSON URL (matching the one in content.js)
  const defaultJsonUrl = "https://raw.githubusercontent.com/koiseka/bm-prices/refs/heads/main/cards.json";
  
  // Import tab elements
  const deckListTextarea = document.getElementById('deckList');
  const importButton = document.getElementById('importButton');
  const clearButton = document.getElementById('clearButton');
  const importStatusDiv = document.getElementById('importStatus');
  const importResults = document.getElementById('importResults');
  const importSummary = document.getElementById('importSummary');
  const importResultList = document.getElementById('importResultList');
  
  // Wishlist tab elements
  const wishlistContainer = document.getElementById('wishlist-container');
  const wishlistCount = document.getElementById('wishlist-count');
  const addWishlistToCartButton = document.getElementById('add-wishlist-to-cart');
  const clearWishlistButton = document.getElementById('clear-wishlist');
  const emptyWishlistMessage = document.getElementById('empty-wishlist-message');
  const wishlistStatusDiv = document.getElementById('wishlistStatus');
  
  // Tab navigation elements
  const settingsTab = document.getElementById('settings-tab');
  const importTab = document.getElementById('import-tab');
  const wishlistTab = document.getElementById('wishlist-tab');
  const settingsContent = document.getElementById('settings-content');
  const importContent = document.getElementById('import-content');
  const wishlistContent = document.getElementById('wishlist-content');
  
  // Track active tab
  let currentTab = 'settings';
  
  // Tab switching
  settingsTab.addEventListener('click', () => {
    switchTab('settings');
  });
  
  importTab.addEventListener('click', () => {
    switchTab('import');
    // Check for import results after returning from selector page
    checkImportResults();
  });
  
  wishlistTab.addEventListener('click', () => {
    switchTab('wishlist');
    // Load wishlist data
    loadWishlistData();
  });
  
  function switchTab(tabName) {
    // Don't do anything if we're already on this tab
    if (currentTab === tabName) return;
    
    // Update current tab
    currentTab = tabName;
    
    // Reset all tabs and content
    settingsTab.classList.remove('active');
    importTab.classList.remove('active');
    wishlistTab.classList.remove('active');
    settingsContent.classList.remove('active');
    importContent.classList.remove('active');
    wishlistContent.classList.remove('active');
    
    // Activate the selected tab
    if (tabName === 'settings') {
      settingsTab.classList.add('active');
      settingsContent.classList.add('active');
    } else if (tabName === 'import') {
      importTab.classList.add('active');
      importContent.classList.add('active');
    } else if (tabName === 'wishlist') {
      wishlistTab.classList.add('active');
      wishlistContent.classList.add('active');
    }
  }
  
  // Update status display
  updateDataStatus(dataStatusSpan, lastUpdatedSpan);
  
  // Refresh button handler
  refreshButton.addEventListener('click', () => {
    showStatusWrapper('Refreshing card data...', 'info');
    
    // Send message to background script to fetch fresh data
    safeApiCall(browser.runtime.sendMessage, [{
      action: 'fetchCardData',
      url: defaultJsonUrl
    }], { success: false, error: 'Communication error' })
      .then(response => {
        if (response && response.success) {
          showStatusWrapper('Card data refreshed successfully', 'success');
          updateDataStatus(dataStatusSpan, lastUpdatedSpan);
          
          // Notify any open tabs to reload data
          safeApiCall(browser.tabs.query, [{ url: '*://bootlegmage.com/*' }], [])
            .then(tabs => {
              tabs.forEach(tab => {
                browser.tabs.sendMessage(tab.id, { action: 'reloadCardData' })
                  .catch(err => console.error('Error sending reload message:', err));
              });
            });
        } else {
          showStatusWrapper('Failed to refresh card data: ' + (response?.error || 'Unknown error'), 'error');
        }
      });
  });
  
  // Import button handler
  importButton.addEventListener('click', () => {
    const deckList = deckListTextarea.value.trim();
    
    if (!deckList) {
      showImportStatus('Please enter a deck list', 'error');
      return;
    }
    
    // Check if card data is available
    safeApiCall(browser.storage.local.get, [['cardData']], { cardData: [] })
      .then(result => {
        if (!result.cardData || !Array.isArray(result.cardData) || result.cardData.length === 0) {
          showImportStatus('No card data available. Please load card data in the Settings tab first.', 'error');
          return;
        }
        
        // Open selector page in a new tab with the deck list as a parameter
        const encodedDeckList = encodeURIComponent(deckList);
        const selectorUrl = browser.runtime.getURL('selector.html') + `?deckList=${encodedDeckList}`;
        
        browser.tabs.create({
          url: selectorUrl
        }).catch(err => {
          showImportStatus(`Error opening selector page: ${err.message}`, 'error');
        });
      });
  });
  
  // Clear button handler
  clearButton.addEventListener('click', () => {
    deckListTextarea.value = '';
    importResults.style.display = 'none';
    importStatusDiv.style.display = 'none';
  });

  // Wishlist handlers
  addWishlistToCartButton.addEventListener('click', () => {
    // Find an active bootlegmage.com tab
    safeApiCall(browser.tabs.query, [{ url: '*://bootlegmage.com/*', active: true }], [])
      .then(tabs => {
        if (tabs.length === 0) {
          // No active tab, query for any bootlegmage tab
          return safeApiCall(browser.tabs.query, [{ url: '*://bootlegmage.com/*' }], []);
        }
        return tabs;
      })
      .then(tabs => {
        if (tabs.length === 0) {
          // No tab found, create one
          return safeApiCall(browser.tabs.create, [{ url: 'https://bootlegmage.com' }], null)
            .then(tab => tab ? [tab] : []);
        }
        return tabs;
      })
      .then(tabs => {
        if (tabs.length === 0) {
          showWishlistStatus(`Could not find or create a BootlegMage tab`, 'error');
          return;
        }
        
        const activeTab = tabs[0];
        
        // Add all wishlist items to cart
        safeApiCall(browser.tabs.sendMessage, [activeTab.id, { action: 'addWishlistToCart' }], { success: false, error: 'Tab communication error' })
          .then(response => {
            if (response && response.success) {
              showWishlistStatus(`Added ${response.added} items to cart. ${response.failed} failed.`, 
                                response.failed > 0 ? 'warning' : 'success');
            } else {
              showWishlistStatus(`Failed to add items to cart: ${response?.error || 'Unknown error'}`, 'error');
            }
          });
      });
  });
  
  clearWishlistButton.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear your wishlist?')) {
      // Send message to all bootlegmage.com tabs to clear wishlist
      safeApiCall(browser.tabs.query, [{ url: '*://bootlegmage.com/*' }], [])
        .then(tabs => {
          const promises = tabs.map(tab => 
            safeApiCall(browser.tabs.sendMessage, [tab.id, { action: 'clearWishlist' }], null)
          );
          
          return Promise.all(promises);
        })
        .then(() => {
          // Update local UI
          wishlistContainer.innerHTML = '';
          emptyWishlistMessage.style.display = 'block';
          wishlistCount.textContent = '0 items in wishlist';
          showWishlistStatus('Wishlist cleared', 'success');
          
          // Clear from local storage as well
          return safeApiCall(browser.storage.local.remove, ['wishlistItems'], null);
        })
        .catch(error => {
          showWishlistStatus(`Error: ${error.message}`, 'error');
        });
    }
  });
  
  // Load wishlist data
  async function loadWishlistData() {
    try {
      // First try to get from any open bootlegmage.com tab
      const tabs = await safeApiCall(browser.tabs.query, [{ url: '*://bootlegmage.com/*' }], []);
      
      if (tabs.length > 0) {
        // Get data from the content script in an active tab
        const response = await safeApiCall(
          browser.tabs.sendMessage, 
          [tabs[0].id, { action: 'getWishlistItems' }], 
          { success: false }
        );
        
        if (response && response.success && response.wishlistItems) {
          displayWishlistItems(response.wishlistItems);
          return;
        }
      }
      
      // Fall back to storage if no tabs or error
      const stored = await safeApiCall(browser.storage.local.get, ['wishlistItems'], { wishlistItems: [] });
      if (stored.wishlistItems && Array.isArray(stored.wishlistItems)) {
        displayWishlistItems(stored.wishlistItems);
      } else {
        // No wishlist items found
        wishlistContainer.innerHTML = '';
        emptyWishlistMessage.style.display = 'block';
        wishlistCount.textContent = '0 items in wishlist';
      }
    } catch (error) {
      console.error('Error loading wishlist:', error);
      showWishlistStatus(`Error loading wishlist: ${error.message}`, 'error');
      
      // Show empty state
      wishlistContainer.innerHTML = '';
      emptyWishlistMessage.style.display = 'block';
      wishlistCount.textContent = '0 items in wishlist';
    }
  }
  
  // Display wishlist items in the UI
  function displayWishlistItems(items) {
    if (!items || items.length === 0) {
      emptyWishlistMessage.style.display = 'block';
      wishlistContainer.innerHTML = '';
      wishlistCount.textContent = '0 items in wishlist';
      return;
    }
    
    // Hide empty message
    emptyWishlistMessage.style.display = 'none';
    
    // Update count
    wishlistCount.textContent = `${items.length} item${items.length !== 1 ? 's' : ''} in wishlist`;
    
    // Sort by date added (newest first)
    items.sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));
    
    // Clear container
    wishlistContainer.innerHTML = '';
    
    // Add each item to the UI
    items.forEach(item => {
      const itemElement = document.createElement('div');
      itemElement.className = 'wishlist-item';
      itemElement.dataset.productId = item.productId || '';
      
      // Item image
      const imageElement = document.createElement('div');
      imageElement.className = 'wishlist-image';
      if (item.productImg) {
        imageElement.style.backgroundImage = `url("${item.productImg}")`;
      } else {
        // Placeholder image or content if no image available
        imageElement.textContent = 'No img';
      }
      
      // Item details
      const detailsElement = document.createElement('div');
      detailsElement.className = 'wishlist-details';
      
      const nameElement = document.createElement('div');
      nameElement.className = 'wishlist-name';
      nameElement.textContent = item.productName || 'Unknown card';
      nameElement.title = item.productName || 'Unknown card';
      
      const priceElement = document.createElement('div');
      priceElement.className = 'wishlist-price';
      priceElement.textContent = item.price || 'Price not available';
      
      const dateElement = document.createElement('div');
      dateElement.className = 'wishlist-date';
      const date = item.dateAdded ? new Date(item.dateAdded) : new Date();
      dateElement.textContent = date.toLocaleDateString();
      
      // Quantity control
      const quantityElement = document.createElement('div');
      quantityElement.className = 'wishlist-quantity';
      
      const quantityLabel = document.createElement('span');
      quantityLabel.textContent = 'Qty: ';
      
      const decreaseBtn = document.createElement('button');
      decreaseBtn.className = 'quantity-btn decrease';
      decreaseBtn.textContent = '-';
      decreaseBtn.addEventListener('click', () => {
        updateItemQuantity(item.productId, Math.max(1, (item.quantity || 1) - 1));
      });
      
      const quantityValue = document.createElement('span');
      quantityValue.className = 'quantity-value';
      quantityValue.textContent = item.quantity || 1;
      
      const increaseBtn = document.createElement('button');
      increaseBtn.className = 'quantity-btn increase';
      increaseBtn.textContent = '+';
      increaseBtn.addEventListener('click', () => {
        updateItemQuantity(item.productId, (item.quantity || 1) + 1);
      });
      
      quantityElement.appendChild(quantityLabel);
      quantityElement.appendChild(decreaseBtn);
      quantityElement.appendChild(quantityValue);
      quantityElement.appendChild(increaseBtn);
      
      detailsElement.appendChild(nameElement);
      detailsElement.appendChild(priceElement);
      detailsElement.appendChild(dateElement);
      detailsElement.appendChild(quantityElement);
      
      // Item actions
      const actionsElement = document.createElement('div');
      actionsElement.className = 'wishlist-actions';
      
      // Add to cart button
      const addToCartBtn = document.createElement('button');
      addToCartBtn.className = 'wishlist-action add-to-cart';
      addToCartBtn.innerHTML = '🛒';
      addToCartBtn.addEventListener('click', () => {
        addItemToCart(item);
      });
      
      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'wishlist-action remove';
      removeBtn.innerHTML = '✕';
      removeBtn.addEventListener('click', () => {
        removeItemFromWishlist(item.productId);
      });
      
      // Add tooltips
      const addTooltip = document.createElement('span');
      addTooltip.className = 'tooltip';
      addTooltip.textContent = 'Add to cart';
      
      const removeTooltip = document.createElement('span');
      removeTooltip.className = 'tooltip';
      removeTooltip.textContent = 'Remove';
      
      actionsElement.appendChild(addToCartBtn);
      actionsElement.appendChild(addTooltip);
      actionsElement.appendChild(removeBtn);
      actionsElement.appendChild(removeTooltip);
      
      // Assemble item
      itemElement.appendChild(imageElement);
      itemElement.appendChild(detailsElement);
      itemElement.appendChild(actionsElement);
      
      // Add to container
      wishlistContainer.appendChild(itemElement);
    });
  }
  
  // Update quantity for an item in the wishlist
  async function updateItemQuantity(productId, newQuantity) {
    if (!productId) {
      console.error("Cannot update quantity: missing product ID");
      return;
    }
    
    try {
      // Get the current wishlist from storage
      const stored = await safeApiCall(browser.storage.local.get, ['wishlistItems'], { wishlistItems: [] });
      if (!stored.wishlistItems || !Array.isArray(stored.wishlistItems)) {
        return;
      }
      
      // Find the item and update its quantity
      const updatedWishlist = stored.wishlistItems.map(item => {
        if (item.productId === productId) {
          return {
            ...item,
            quantity: newQuantity
          };
        }
        return item;
      });
      
      // Save the updated wishlist
      await safeApiCall(browser.storage.local.set, [{ wishlistItems: updatedWishlist }], null);
      
      // Update UI
      displayWishlistItems(updatedWishlist);
      
      // Update in any open tabs
      const tabs = await safeApiCall(browser.tabs.query, [{ url: '*://bootlegmage.com/*' }], []);
      if (tabs.length > 0) {
        const promises = tabs.map(tab => {
          return safeApiCall(browser.tabs.sendMessage, [tab.id, { 
            action: 'updateWishlistItems', 
            wishlistItems: updatedWishlist 
          }], null);
        });
        
        await Promise.all(promises);
      }
    } catch (error) {
      console.error('Error updating wishlist item quantity:', error);
      showWishlistStatus(`Error updating quantity: ${error.message}`, 'error');
    }
  }
  
  // Add a single wishlist item to cart
  async function addItemToCart(item) {
    if (!item || !item.productId) {
      showWishlistStatus('Invalid item data', 'error');
      return;
    }
    
    try {
      // Find an active bootlegmage.com tab
      const tabs = await safeApiCall(browser.tabs.query, [{ url: '*://bootlegmage.com/*' }], []);
      let activeTab;
      
      if (tabs.length === 0) {
        // No tab found, create one
        activeTab = await safeApiCall(browser.tabs.create, [{ url: 'https://bootlegmage.com' }], null);
        if (!activeTab) {
          showWishlistStatus('Failed to open BootlegMage website', 'error');
          return;
        }
        // Wait for page to load
        await new Promise(resolve => setTimeout(resolve, 1500));
      } else {
        activeTab = tabs[0];
      }
      
      // Send message to add item to cart
      const response = await safeApiCall(browser.tabs.sendMessage, [activeTab.id, { 
        action: 'addToCart',
        productId: item.productId,
        quantity: item.quantity || 1, // Use the item's quantity or default to 1
        productSku: item.productSku || null
      }], { success: false, error: 'Tab communication error' });
      
      if (response && response.success) {
        showWishlistStatus(`${item.productName || 'Item'} added to cart`, 'success');
      } else {
        showWishlistStatus(`Failed to add item to cart: ${response?.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      console.error('Error adding item to cart:', error);
      showWishlistStatus(`Error adding item to cart: ${error.message}`, 'error');
    }
  }
  
  // Remove an item from the wishlist
  async function removeItemFromWishlist(productId) {
    if (!productId) {
      showWishlistStatus('Invalid product ID', 'error');
      return;
    }
    
    try {
      // Send message to all bootlegmage.com tabs to remove from wishlist
      const tabs = await safeApiCall(browser.tabs.query, [{ url: '*://bootlegmage.com/*' }], []);
      
      if (tabs.length > 0) {
        const promises = tabs.map(tab => 
          safeApiCall(browser.tabs.sendMessage, [tab.id, { 
            action: 'removeFromWishlist',
            productId
          }], null)
        );
        
        await Promise.all(promises);
      }
      
      // Also update storage directly
      const stored = await safeApiCall(browser.storage.local.get, ['wishlistItems'], { wishlistItems: [] });
      if (stored.wishlistItems && Array.isArray(stored.wishlistItems)) {
        const updatedWishlist = stored.wishlistItems.filter(item => item.productId !== productId);
        await safeApiCall(browser.storage.local.set, [{ wishlistItems: updatedWishlist }], null);
        
        // Update UI
        displayWishlistItems(updatedWishlist);
      }
      
      showWishlistStatus('Item removed from wishlist', 'info');
    } catch (error) {
      console.error('Error removing item from wishlist:', error);
      showWishlistStatus(`Error removing item: ${error.message}`, 'error');
    }
  }

  // Check for import results that may have been saved from the selector page
  function checkImportResults() {
    safeApiCall(browser.storage.local.get, [['importResults']], {})
      .then(result => {
        if (result.importResults) {
          displayImportResults(result.importResults);
          
          // Clear the results after displaying them
          return safeApiCall(browser.storage.local.remove, ['importResults'], null);
        }
      });
  }
  
  // Helper function to display import results
  function displayImportResults(results) {
    if (!results) {
      return;
    }
    
    importResults.style.display = 'block';
    importSummary.innerHTML = `<strong>Results:</strong> ${results.success || 0} cards added to cart, ${results.notFound || 0} cards not found`;
    
    // Clear previous results
    importResultList.innerHTML = '';
    
    // Add result items
    if (results.results && Array.isArray(results.results)) {
      for (const item of results.results) {
        const resultItem = document.createElement('div');
        resultItem.className = `result-item result-${item.status || 'error'}`;
        
        if (item.status === 'success') {
          resultItem.innerHTML = `✓ ${item.quantity}x ${item.name} (${item.match})`;
        } else {
          resultItem.innerHTML = `✗ ${item.quantity}x ${item.name} - ${item.message || 'Unknown error'}`;
        }
        
        importResultList.appendChild(resultItem);
      }
    }
    
    // Display success or error message
    const successCount = results.success || 0;
    const notFoundCount = results.notFound || 0;
    
    if (successCount > 0) {
      showImportStatus(`Added ${successCount} cards to cart. ${notFoundCount} cards not found.`, 
                        notFoundCount > 0 ? 'warning' : 'success');
    } else {
      showImportStatus(`Failed to add cards to cart. ${notFoundCount} cards not found.`, 'error');
    }
  }
  
  // Wrapper functions for the utility showStatus with specific elements
  function showStatusWrapper(message, type, timeout = 3000) {
    showStatus(statusDiv, message, type, timeout);
  }
  
  function showImportStatus(message, type, timeout = 5000) {
    showStatus(importStatusDiv, message, type, timeout);
  }
  
  function showWishlistStatus(message, type, timeout = 3000) {
    showStatus(wishlistStatusDiv, message, type, timeout);
  }
});