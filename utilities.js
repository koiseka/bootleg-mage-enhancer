// utilities.js - Shared functions for BM Prices extension

/**
 * Shows a status message with appropriate styling
 * @param {HTMLElement} statusElement - The status element to update
 * @param {string} message - The message to display
 * @param {string} type - The message type (success, error, warning, info)
 * @param {number} [timeout=3000] - Time in ms before the message disappears (0 for no timeout)
 */
function showStatus(statusElement, message, type, timeout = 3000) {
  statusElement.textContent = message;
  statusElement.className = 'status ' + type;
  statusElement.style.display = 'block';
  
  if (timeout > 0) {
    setTimeout(() => {
      statusElement.style.display = 'none';
    }, timeout);
  }
}

/**
 * Find card matches in card data with improved fuzzy matching
 * @param {string} cardName - The card name to search for
 * @param {Array} cardData - The array of card data to search in
 * @returns {Array} - Array of matching cards sorted by relevance
 */
function findCardMatches(cardName, cardData) {
  if (!cardName || !cardData || !Array.isArray(cardData)) return [];
  
  // Normalize card name for matching
  const normalizedName = cardName.toLowerCase().trim();
  
  // Try to find matches in card data
  const matches = cardData.filter(c => {
    if (!c.name) return false;
    
    // Extract base card name without set/number information
    const cardNameParts = c.name.split(/\s+(?:#|SLP|FDN|UNF|SLD|PRM|DSC|2XM|ONE|AFR|STA|CHK|ICE|MIR|SCH|INR|J25)/i);
    if (cardNameParts.length === 0) return false;
    
    // Get the base name and normalize it
    const baseName = cardNameParts[0].toLowerCase().trim();
    
    // Improved matching algorithm:
    // 1. Exact match
    if (baseName === normalizedName) return true;
    
    // 2. Contains match (either direction)
    if (baseName.includes(normalizedName) || normalizedName.includes(baseName)) return true;
    
    // 3. Fuzzy match - allow for typos and small variations
    const similarity = calculateSimilarity(normalizedName, baseName);
    return similarity > 0.8; // 80% similarity threshold
  });
  
  // Sort matches by product availability and match quality
  return matches.sort((a, b) => {
    // Get normalized names for comparison
    const normalizedA = a.name.toLowerCase().trim();
    const normalizedB = b.name.toLowerCase().trim();
    
    // Prefer items with both productId and productSku
    if (a.productId && a.productSku && (!b.productId || !b.productSku)) {
      return -1;
    }
    if (b.productId && b.productSku && (!a.productId || !a.productSku)) {
      return 1;
    }
    
    // If both have product info, prefer exact name matches
    const aExactMatch = normalizedA === normalizedName;
    const bExactMatch = normalizedB === normalizedName;
    if (aExactMatch && !bExactMatch) return -1;
    if (bExactMatch && !aExactMatch) return 1;
    
    // Then check for substring match
    const aContainsMatch = normalizedA.includes(normalizedName) || normalizedName.includes(normalizedA);
    const bContainsMatch = normalizedB.includes(normalizedName) || normalizedName.includes(normalizedB);
    if (aContainsMatch && !bContainsMatch) return -1;
    if (bContainsMatch && !aContainsMatch) return 1;
    
    // Finally, sort by similarity score
    const aSimilarity = calculateSimilarity(normalizedName, normalizedA);
    const bSimilarity = calculateSimilarity(normalizedName, normalizedB);
    return bSimilarity - aSimilarity;
  });
}

/**
 * Parse a deck list string into an array of card objects
 * @param {string} deckList - The deck list text to parse
 * @returns {Array} - Array of card objects with quantity and name
 */
function parseDeckList(deckList) {
  if (!deckList) return [];
  
  const lines = deckList.split('\n');
  const cards = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('//')) {
      continue; // Skip empty lines and comments
    }
    
    try {
      // Format: "1 Card Name" or "1x Card Name"
      const match = trimmedLine.match(/^(\d+)x?\s+(.+)$/i);
      if (match) {
        const quantity = parseInt(match[1], 10);
        const cardName = match[2].trim();
        
        if (quantity > 0 && cardName) {
          cards.push({
            quantity,
            name: cardName
          });
        }
      } else if (trimmedLine) {
        // If no quantity specified, assume 1
        cards.push({
          quantity: 1,
          name: trimmedLine
        });
      }
    } catch (error) {
      console.error(`Error parsing line "${trimmedLine}":`, error);
      // Continue processing other lines despite the error
    }
  }
  
  return cards;
}

/**
 * Updates the data status display
 * @param {HTMLElement} dataStatusSpan - The status span element
 * @param {HTMLElement} lastUpdatedSpan - The last updated span element
 */
function updateDataStatus(dataStatusSpan, lastUpdatedSpan) {
  return browser.storage.local.get(['cardData', 'cardDataTimestamp'])
    .then(result => {
      try {
        if (result.cardData && Array.isArray(result.cardData)) {
          dataStatusSpan.textContent = `${result.cardData.length} cards loaded`;
          
          if (result.cardDataTimestamp) {
            const date = new Date(result.cardDataTimestamp);
            lastUpdatedSpan.textContent = date.toLocaleString();
          }
        } else {
          dataStatusSpan.textContent = 'No data loaded';
          lastUpdatedSpan.textContent = 'Never';
        }
      } catch (error) {
        console.error("Error updating data status:", error);
        dataStatusSpan.textContent = 'Error checking data';
        lastUpdatedSpan.textContent = 'Unknown';
      }
    })
    .catch(error => {
      console.error("Storage error while updating data status:", error);
      dataStatusSpan.textContent = 'Storage error';
      lastUpdatedSpan.textContent = 'Unknown';
    });
}

/**
 * Calculate similarity between two strings (Levenshtein distance)
 * @param {string} s1 - First string
 * @param {string} s2 - Second string
 * @returns {number} - Similarity score between 0-1
 */
function calculateSimilarity(s1, s2) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  
  // Calculate Levenshtein distance
  const track = Array(s2.length + 1).fill(null).map(() => 
    Array(s1.length + 1).fill(null));
    
  for (let i = 0; i <= s1.length; i += 1) {
    track[0][i] = i;
  }
  
  for (let j = 0; j <= s2.length; j += 1) {
    track[j][0] = j;
  }
  
  for (let j = 1; j <= s2.length; j += 1) {
    for (let i = 1; i <= s1.length; i += 1) {
      const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1, // deletion
        track[j - 1][i] + 1, // insertion
        track[j - 1][i - 1] + indicator, // substitution
      );
    }
  }
  
  // Calculate normalized similarity (1 - distance/maxLength)
  const maxLength = Math.max(s1.length, s2.length);
  if (maxLength === 0) return 1; // Both strings are empty
  
  return 1 - (track[s2.length][s1.length] / maxLength);
}

/**
 * Safe wrapper for browser API calls
 * @param {Function} apiCall - The browser API function to call
 * @param {Array} args - Arguments to pass to the API call
 * @param {any} defaultValue - Default value to return if call fails
 * @returns {Promise} - Promise resolving with the result or defaultValue
 */
function safeApiCall(apiCall, args = [], defaultValue = null) {
  try {
    return apiCall(...args).catch(error => {
      console.error(`API call failed:`, error);
      return defaultValue;
    });
  } catch (error) {
    console.error(`Error in API call:`, error);
    return Promise.resolve(defaultValue);
  }
}

// Export utilities
export {
  showStatus,
  findCardMatches,
  parseDeckList,
  updateDataStatus,
  calculateSimilarity,
  safeApiCall
};