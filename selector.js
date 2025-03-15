// Card selection script for bulk import feature
import { showStatus, findCardMatches, parseDeckList, safeApiCall } from './utilities.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Get DOM elements
  const statusDiv = document.getElementById('status');
  const cardGroupsContainer = document.getElementById('card-groups-container');
  const addToCartButton = document.getElementById('add-to-cart-button');
  const backButton = document.getElementById('back-button');
  const cancelButton = document.getElementById('cancel-button');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const currentCountSpan = document.getElementById('current-count');
  const totalCountSpan = document.getElementById('total-count');
  
  // Track failed cards for potential retry
  let failedCardGroups = new Set();
  // Track cards that were already attempted (to prevent duplicates on retry)
  let processedProducts = new Map(); // Map of productId -> boolean
  // Track if we've added a "Done" button already
  let doneButtonAdded = false;

  // Parse URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const deckListEncoded = urlParams.get('deckList');
  
  if (!deckListEncoded) {
    showStatusWrapper('No deck list provided. Please go back and enter a deck list.', 'error');
    return;
  }
  
  // Decode the deck list
  const deckList = decodeURIComponent(deckListEncoded);
  
  // Parse the deck list
  const cards = parseDeckList(deckList);
  
  if (cards.length === 0) {
    showStatusWrapper('No valid cards found in the deck list.', 'error');
    return;
  }
  
  // Get card data from storage
  const result = await safeApiCall(browser.storage.local.get, [['cardData']], { cardData: [] });
  if (!result.cardData || !Array.isArray(result.cardData) || result.cardData.length === 0) {
    showStatusWrapper('No card data available. Please load card data in the Settings tab first.', 'error');
    return;
  }
  
  const cardData = result.cardData;
  
  // Process cards and find matches
  showStatusWrapper(`Processing ${cards.length} cards...`, 'info');
  
  // Set up progress tracking
  progressContainer.style.display = 'block';
  totalCountSpan.textContent = cards.length;
  
  // Find matches for each card
  const cardGroups = [];
  let currentIdx = 0;
  
  for (const card of cards) {
    try {
      // Update progress
      currentCountSpan.textContent = ++currentIdx;
      progressBar.style.width = `${(currentIdx / cards.length) * 100}%`;
      
      // Find matches using the shared utility function
      const matches = findCardMatches(card.name, cardData);
      
      if (matches.length > 0) {
        const selectedMatches = matches.map((match, index) => {
          return {
            match: match,
            quantity: index === 0 ? card.quantity : 0 // Assign all quantity to first match by default
          };
        });
        
        cardGroups.push({
          name: card.name,
          totalQuantity: card.quantity,
          remainingQuantity: 0, // Will be calculated during display
          matches: matches,
          selectedMatches: selectedMatches
        });
      } else {
        // If no matches, add an empty group to show it wasn't found
        cardGroups.push({
          name: card.name,
          totalQuantity: card.quantity,
          remainingQuantity: card.quantity,
          matches: [],
          selectedMatches: []
        });
      }
    } catch (error) {
      console.error(`Error processing card "${card.name}":`, error);
      // Add the card as not found due to error
      cardGroups.push({
        name: card.name,
        totalQuantity: card.quantity,
        remainingQuantity: card.quantity,
        matches: [],
        selectedMatches: [],
        error: error.message
      });
    }
    
    // Small delay to keep the UI responsive
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  // Display the card groups
  displayCardGroups(cardGroups);
  
  // Update status
  const matchedCount = cardGroups.filter(group => group.matches.length > 0).length;
  const notFoundCount = cardGroups.length - matchedCount;
  
  if (notFoundCount > 0) {
    showStatusWrapper(`Processed ${cards.length} cards. ${matchedCount} cards found, ${notFoundCount} cards not found.`, 'warning');
  } else {
    showStatusWrapper(`Processed ${cards.length} cards. All cards found!`, 'success');
  }
  
  // Button event listeners
  backButton.addEventListener('click', () => {
    window.history.back();
  });
  
  cancelButton.addEventListener('click', () => {
    window.close();
  });
  
  addToCartButton.addEventListener('click', async () => {
    await addSelectedCardsToCart(cardGroups);
  });
  
  // Helper functions
  
  // Update remaining quantity for a card group
  function updateRemainingQuantity(group) {
    const assignedQuantity = group.selectedMatches.reduce(
      (total, selectedMatch) => total + selectedMatch.quantity, 0
    );
    
    group.remainingQuantity = group.totalQuantity - assignedQuantity;
    
    // Update UI to reflect remaining quantity
    const remainingElement = document.querySelector(`.card-group[data-group-index="${group.groupIndex}"] .remaining-quantity`);
    if (remainingElement) {
      remainingElement.textContent = `${group.remainingQuantity} remaining`;
      
      // Show warning if not all quantity is allocated
      if (group.remainingQuantity > 0) {
        remainingElement.classList.add('warning');
      } else if (group.remainingQuantity < 0) {
        remainingElement.classList.add('error');
      } else {
        remainingElement.classList.remove('warning', 'error');
      }
    }
    
    // Enable/disable add to cart button based on all quantities being valid
    validateAllQuantities();
  }
  
  // Validate all quantities across groups
  function validateAllQuantities() {
    const hasInvalidQuantities = cardGroups.some(group => {
      // Skip groups with no matches found (nothing we can do about those)
      if (group.matches.length === 0) return false;
      
      // Check if quantity doesn't match up
      return group.remainingQuantity !== 0;
    });
    
    // Update button state
    addToCartButton.disabled = hasInvalidQuantities;
    
    if (hasInvalidQuantities) {
      showStatusWrapper('Please adjust quantities so all cards are allocated properly', 'warning');
    } else {
      showStatusWrapper('Ready to add cards to cart', 'info');
    }
  }
  
  // Display card groups in the UI
  function displayCardGroups(cardGroups) {
    try {
      cardGroupsContainer.innerHTML = '';
      
      cardGroups.forEach((group, groupIndex) => {
        // Store group index for reference
        group.groupIndex = groupIndex;
        
        const cardGroup = document.createElement('div');
        cardGroup.className = 'card-group';
        cardGroup.dataset.groupIndex = groupIndex;
        
        // Create card header
        const cardHeader = document.createElement('div');
        cardHeader.className = 'card-header';
        
        const cardName = document.createElement('div');
        cardName.className = 'card-name';
        cardName.textContent = group.name;
        
        // Create a quantity section with total and remaining
        const cardQuantitySection = document.createElement('div');
        cardQuantitySection.className = 'card-quantity-section';
        
        const cardQuantity = document.createElement('div');
        cardQuantity.className = 'card-quantity';
        cardQuantity.textContent = `${group.totalQuantity}x`;
        
        const remainingQuantity = document.createElement('div');
        remainingQuantity.className = 'remaining-quantity';
        // Calculate initial remaining quantity
        const initialAssigned = group.selectedMatches.reduce(
          (total, selectedMatch) => total + selectedMatch.quantity, 0
        );
        group.remainingQuantity = group.totalQuantity - initialAssigned;
        remainingQuantity.textContent = `${group.remainingQuantity} remaining`;
        
        if (group.remainingQuantity !== 0) {
          remainingQuantity.classList.add(group.remainingQuantity > 0 ? 'warning' : 'error');
        }
        
        cardQuantitySection.appendChild(cardQuantity);
        cardQuantitySection.appendChild(remainingQuantity);
        
        cardHeader.appendChild(cardName);
        cardHeader.appendChild(cardQuantitySection);
        cardGroup.appendChild(cardHeader);
        
        // Add placeholder for potential error messages - better positioning
        const errorMessageContainer = document.createElement('div');
        errorMessageContainer.className = 'error-message-container';
        cardGroup.appendChild(errorMessageContainer);
        
        // Display any processing errors
        if (group.error) {
          const errorMsg = document.createElement('div');
          errorMsg.className = 'failure-message';
          errorMsg.textContent = `Error: ${group.error}`;
          errorMessageContainer.appendChild(errorMsg);
        }
        
        // Create card options container
        const cardOptions = document.createElement('div');
        cardOptions.className = 'card-options';
        
        if (group.matches.length > 0) {
          group.matches.forEach((card, cardIndex) => {
            const cardOption = document.createElement('div');
            cardOption.className = 'card-option';
            cardOption.dataset.groupIndex = groupIndex;
            cardOption.dataset.cardIndex = cardIndex;
            
            // Card image
            if (card.productImg) {
              const img = document.createElement('img');
              img.src = card.productImg;
              img.alt = card.name;
              img.onerror = () => {
                img.src = 'https://via.placeholder.com/265x370?text=No+Image';
              };
              cardOption.appendChild(img);
            } else {
              const imgPlaceholder = document.createElement('div');
              imgPlaceholder.style.height = '200px';
              imgPlaceholder.style.backgroundColor = '#f0f0f0';
              imgPlaceholder.style.display = 'flex';
              imgPlaceholder.style.justifyContent = 'center';
              imgPlaceholder.style.alignItems = 'center';
              imgPlaceholder.textContent = 'No image';
              cardOption.appendChild(imgPlaceholder);
            }
            
            // Card details
            const cardDetails = document.createElement('div');
            cardDetails.className = 'card-details';
            
            const cardNameDetail = document.createElement('div');
            cardNameDetail.className = 'card-name-detail';
            cardNameDetail.textContent = card.name;
            cardNameDetail.title = card.name; // Show full name on hover
            
            cardDetails.appendChild(cardNameDetail);
            
            // Add quantity controls
            const quantityControl = document.createElement('div');
            quantityControl.className = 'quantity-control';
            
            const decreaseBtn = document.createElement('button');
            decreaseBtn.className = 'quantity-btn decrease';
            decreaseBtn.textContent = '-';
            decreaseBtn.title = 'Decrease quantity';
            
            const quantityInput = document.createElement('input');
            quantityInput.type = 'number';
            quantityInput.min = '0';
            quantityInput.max = group.totalQuantity.toString();
            quantityInput.className = 'quantity-input';
            quantityInput.value = group.selectedMatches[cardIndex].quantity;
            
            const increaseBtn = document.createElement('button');
            increaseBtn.className = 'quantity-btn increase';
            increaseBtn.textContent = '+';
            increaseBtn.title = 'Increase quantity';
            
            // Add event listeners to quantity controls
            decreaseBtn.addEventListener('click', () => {
              const currentValue = parseInt(quantityInput.value, 10) || 0;
              if (currentValue > 0) {
                quantityInput.value = currentValue - 1;
                group.selectedMatches[cardIndex].quantity = currentValue - 1;
                updateRemainingQuantity(group);
              }
            });
            
            increaseBtn.addEventListener('click', () => {
              const currentValue = parseInt(quantityInput.value, 10) || 0;
              if (group.remainingQuantity > 0) {
                quantityInput.value = currentValue + 1;
                group.selectedMatches[cardIndex].quantity = currentValue + 1;
                updateRemainingQuantity(group);
              }
            });
            
            quantityInput.addEventListener('change', () => {
              let newValue = parseInt(quantityInput.value, 10) || 0;
              if (newValue < 0) newValue = 0;
              
              // Get previous value to calculate change
              const previousValue = group.selectedMatches[cardIndex].quantity;
              const change = newValue - previousValue;
              
              // Check if we have enough remaining quantity
              if (change > group.remainingQuantity) {
                // If not enough remaining, limit to what's available
                newValue = previousValue + group.remainingQuantity;
              }
              
              // Update the input and data model
              quantityInput.value = newValue;
              group.selectedMatches[cardIndex].quantity = newValue;
              updateRemainingQuantity(group);
            });
            
            quantityControl.appendChild(decreaseBtn);
            quantityControl.appendChild(quantityInput);
            quantityControl.appendChild(increaseBtn);
            
            cardDetails.appendChild(quantityControl);
            cardOption.appendChild(cardDetails);
            
            cardOptions.appendChild(cardOption);
          });
        } else {
          // No matches found - display placeholder
          const noMatch = document.createElement('div');
          noMatch.className = 'card-option-placeholder';
          noMatch.textContent = 'No matches found for this card';
          cardOptions.appendChild(noMatch);
        }
        
        cardGroup.appendChild(cardOptions);
        cardGroupsContainer.appendChild(cardGroup);
      });
      
      // Check all quantities initially
      validateAllQuantities();
      
    } catch (error) {
      console.error('Error displaying card groups:', error);
      showStatusWrapper(`Error displaying card groups: ${error.message}`, 'error');
    }
  }
  
  // Add selected cards to cart
  async function addSelectedCardsToCart(cardGroups) {
    try {
      addToCartButton.disabled = true;
      addToCartButton.textContent = 'Adding to cart...';
      
      // Remove any previously added "Done" button to prevent duplicates
      const existingDoneButton = addToCartButton.parentNode.querySelector('button:not(#add-to-cart-button):not(#cancel-button)');
      if (existingDoneButton) {
        existingDoneButton.remove();
        doneButtonAdded = false;
      }
      
      showStatusWrapper('Adding cards to cart...', 'info');
      
      // Find active BootlegMage tab
      let tabs = await safeApiCall(
        browser.tabs.query, 
        [{ url: '*://bootlegmage.com/*', active: true }], 
        []
      );
      
      let bmTab = tabs[0];
      
      // If no active tab, look for any BootlegMage tab
      if (!bmTab) {
        const allTabs = await safeApiCall(
          browser.tabs.query, 
          [{ url: '*://bootlegmage.com/*' }],
          []
        );
        bmTab = allTabs[0];
      }
      
      // If no BootlegMage tab is open, open one
      if (!bmTab) {
        bmTab = await safeApiCall(
          browser.tabs.create, 
          [{ url: 'https://bootlegmage.com' }],
          null
        );
        
        if (!bmTab) {
          showStatusWrapper('Failed to open BootlegMage website', 'error');
          addToCartButton.disabled = false;
          addToCartButton.textContent = 'Try Again';
          return;
        }
        
        // Give the page a moment to load
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Create a flattened list of cards to add from the selected matches
      const cardsToAdd = [];
      cardGroups.forEach(group => {
        group.selectedMatches.forEach(selectedMatch => {
          if (selectedMatch.quantity > 0 && selectedMatch.match) {
            // Check if we're retrying and verify this specific product ID hasn't been successfully added before
            const productId = selectedMatch.match.productId;
            const productKey = `${productId}_${group.groupIndex}`;
            if (!processedProducts.has(productKey) || processedProducts.get(productKey) === false) {
              cardsToAdd.push({
                name: group.name,
                match: selectedMatch.match,
                quantity: selectedMatch.quantity,
                groupIndex: group.groupIndex // Track which group this card belongs to
              });
            }
          }
        });
        
        // If no matches were found, add an empty entry to track the failure
        if (group.matches.length === 0) {
          const groupKey = `nomatch_${group.groupIndex}`;
          if (!processedProducts.has(groupKey) || processedProducts.get(groupKey) === false) {
            cardsToAdd.push({
              name: group.name,
              match: null,
              quantity: group.totalQuantity,
              groupIndex: group.groupIndex // Track which group this card belongs to
            });
          }
        }
      });
      
      // Reset previously failed cards for the current retry operation
      // (We'll add back any that still fail)
      const previouslyFailedGroups = new Set(failedCardGroups);
      failedCardGroups.clear();
      
      // Reset progress tracking for adding to cart
      currentIdx = 0;
      progressBar.style.width = '0%';
      totalCountSpan.textContent = cardsToAdd.length;
      
      // Track results
      const results = {
        success: 0,
        notFound: 0,
        results: []
      };
      
      // Add each card to cart
      for (const card of cardsToAdd) {
        try {
          // Update progress
          currentCountSpan.textContent = ++currentIdx;
          progressBar.style.width = `${(currentIdx / cardsToAdd.length) * 100}%`;
          
          if (card.match && card.match.productId) {
            const productId = card.match.productId;
            const productKey = `${productId}_${card.groupIndex}`;
            
            const response = await safeApiCall(
              browser.tabs.sendMessage, 
              [bmTab.id, {
                action: 'addToCart',
                productId: productId,
                quantity: card.quantity,
                productSku: card.match.productSku || null
              }],
              { success: false, error: 'Tab communication error' }
            );
            
            if (response && response.success) {
              results.success++;
              results.results.push({
                name: card.name,
                match: card.match.name,
                quantity: card.quantity,
                status: 'success',
                message: `Added to cart: ${response.productName || card.match.name}`
              });
              
              // Mark as successfully processed
              processedProducts.set(productKey, true);
              
              // If this was a previously failed card that's now successfully added,
              // remove the error message and failed-card styling
              if (previouslyFailedGroups.has(card.groupIndex)) {
                removeFailedCardStatus(card.groupIndex);
              }
            } else {
              results.notFound++;
              results.results.push({
                name: card.name,
                match: card.match.name,
                quantity: card.quantity,
                status: 'error',
                message: `Failed to add to cart: ${response?.error || 'Unknown error'}`
              });
              
              // Mark this card group as failed
              if (card.groupIndex !== undefined) {
                failedCardGroups.add(card.groupIndex);
              }
              
              // Mark as unsuccessfully processed
              processedProducts.set(productKey, false);
            }
          } else {
            // No matches were found
            const groupKey = `nomatch_${card.groupIndex}`;
            
            results.notFound++;
            results.results.push({
              name: card.name,
              quantity: card.quantity,
              status: 'error',
              message: `No match found for: ${card.name}`
            });
            
            // Mark this card group as failed
            if (card.groupIndex !== undefined) {
              failedCardGroups.add(card.groupIndex);
            }
            
            // Mark as unsuccessfully processed
            processedProducts.set(groupKey, false);
          }
        } catch (error) {
          console.error(`Error processing card "${card.name}":`, error);
          
          // Add to results
          results.notFound++;
          results.results.push({
            name: card.name,
            quantity: card.quantity,
            status: 'error',
            message: `Error: ${error.message}`
          });
          
          // Mark as failed
          if (card.groupIndex !== undefined) {
            failedCardGroups.add(card.groupIndex);
          }
        }
        
        // Short delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Save results to storage for popup window to retrieve
      await safeApiCall(browser.storage.local.set, [{ importResults: results }], null);
      
      // Update status
      if (results.success > 0) {
        if (results.notFound > 0) {
          showStatusWrapper(`Added ${results.success} cards to cart. ${results.notFound} cards could not be added.`, 'warning');
        } else {
          showStatusWrapper(`Successfully added ${results.success} cards to cart!`, 'success');
        }
      } else {
        showStatusWrapper(`Failed to add any cards to cart. Please check for errors.`, 'error');
      }
      
      // Highlight failed cards in the UI and allow selecting alternative versions
      highlightFailedCards();
      
      // Update buttons based on results
      if (failedCardGroups.size > 0) {
        addToCartButton.disabled = false;
        addToCartButton.textContent = 'Retry Failed Cards';
        
        // Change the click handler to only retry failed cards
        addToCartButton.onclick = () => {
          retryFailedCards(cardGroups);
        };
        
        // Only add a "Done" button if we haven't already
        if (!doneButtonAdded) {
          const doneButton = document.createElement('button');
          doneButton.textContent = 'Done - Close Window';
          doneButton.addEventListener('click', () => window.close());
          addToCartButton.parentNode.appendChild(doneButton);
          doneButtonAdded = true;
        }
      } else {
        // If all cards succeeded, we don't need separate buttons
        addToCartButton.disabled = false;
        addToCartButton.textContent = 'Done - Close Window';
        addToCartButton.onclick = () => window.close();
        
        // Remove any extra "Done" button if it exists
        if (doneButtonAdded) {
          const doneButton = addToCartButton.parentNode.querySelector('button:not(#add-to-cart-button):not(#cancel-button)');
          if (doneButton) {
            doneButton.remove();
          }
          doneButtonAdded = false;
        }
      }
    } catch (error) {
      console.error('Error adding cards to cart:', error);
      showStatusWrapper(`Error: ${error.message}`, 'error');
      
      // Re-enable button for retry
      addToCartButton.disabled = false;
      addToCartButton.textContent = 'Try Again';
    }
  }
  
  // Remove failed card styling and error message
  function removeFailedCardStatus(groupIndex) {
    const groupElement = document.querySelector(`.card-group[data-group-index="${groupIndex}"]`);
    if (groupElement) {
      // Remove failed-card class
      groupElement.classList.remove('failed-card');
      
      // Remove error message
      const errorContainer = groupElement.querySelector('.error-message-container');
      if (errorContainer) {
        errorContainer.innerHTML = '';
      }
    }
  }
  
  // Highlight failed cards in the UI
  function highlightFailedCards() {
    // First, reset all card groups to normal state
    document.querySelectorAll('.card-group').forEach(group => {
      group.classList.remove('failed-card');
    });
    
    // Then highlight the failed ones
    failedCardGroups.forEach(groupIndex => {
      const groupElement = document.querySelector(`.card-group[data-group-index="${groupIndex}"]`);
      if (groupElement) {
        // Add failed class
        groupElement.classList.add('failed-card');
        
        // Add failure message in the dedicated container
        const errorContainer = groupElement.querySelector('.error-message-container');
        if (errorContainer) {
          let failureMsg = errorContainer.querySelector('.failure-message');
          if (!failureMsg) {
            failureMsg = document.createElement('div');
            failureMsg.className = 'failure-message';
            errorContainer.appendChild(failureMsg);
          }
          failureMsg.textContent = 'Failed to add to cart. Try another version?';
        }
        
        // Make sure the user knows they can select another version
        const cardOptions = groupElement.querySelectorAll('.card-option');
        cardOptions.forEach(option => {
          // Enable all options for this card
          option.style.opacity = '1';
          option.style.cursor = 'pointer';
        });
        
        // Scroll to the first failed card to make it visible
        if (groupIndex === Array.from(failedCardGroups)[0]) {
          groupElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });
  }
  
  // Retry adding failed cards to the cart
  async function retryFailedCards(cardGroups) {
    try {
      // Filter to only retry the failed card groups
      const failedGroups = cardGroups.filter(group => 
        failedCardGroups.has(group.groupIndex)
      );
      
      if (failedGroups.length === 0) {
        showStatusWrapper('No failed cards to retry.', 'info');
        return;
      }
      
      // Call the original add to cart function with only failed groups
      await addSelectedCardsToCart(failedGroups);
    } catch (error) {
      console.error('Error retrying failed cards:', error);
      showStatusWrapper(`Error retrying cards: ${error.message}`, 'error');
    }
  }
  
  // Wrapper for the utility showStatus function
  function showStatusWrapper(message, type, timeout = 0) {
    showStatus(statusDiv, message, type, timeout);
  }
});