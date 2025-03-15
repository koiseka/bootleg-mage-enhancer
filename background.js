// importScripts('browser-polyfill.js');
if (typeof self !== 'undefined' && 'serviceWorker' in self) {
  // Running as a service worker (Chrome)
  console.log("Service worker context");
  self.addEventListener('message', (event) => {
    // Handle messages
  });
  importScripts('browser-polyfill.js'); // Load polyfill in service worker
} else {
  // Running as a background script (Firefox)
  console.log("Background script context");
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle messages
  });
  // browser-polyfill.js already loaded via scripts
}

// Queue for managing API requests to respect rate limits
class RequestQueue {
  constructor(maxRequestsPerSecond) {
    this.queue = [];
    this.maxRequestsPerSecond = maxRequestsPerSecond;
    this.processing = false;
  }

  addRequest(request) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        request,
        resolve,
        reject
      });
      
      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  async processQueue() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const item = this.queue.shift();
    
    try {
      // Process the request
      const response = await fetch(item.request.url, item.request.options);
      const data = await response.json();
      item.resolve(data);
    } catch (error) {
      item.reject(error);
    }

    // Delay to respect rate limit (100ms = 10 requests per second)
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Process next item
    this.processQueue();
  }
}

// Initialize request queue with Scryfall's rate limit
const scryfallQueue = new RequestQueue(10); // 10 requests per second max

// Cache management for Scryfall data
const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours in milliseconds

// Fetch card data from remote JSON URL
async function fetchCardData(url) {
  try {
    const response = await fetch(url);
    const cardData = await response.json();
    
    // Store the card data in extension storage
    browser.storage.local.set({ 
      cardData,
      cardDataTimestamp: Date.now()
    });
    
    return cardData;
  } catch (error) {
    console.error("Error fetching card data:", error);
    return [];
  }
}

// Fetch price from Scryfall API for a given TCGPlayer ID
async function fetchScryfallPrice(tcgplayerId) {
  // Check cache first
  const cacheKey = `scryfall_${tcgplayerId}`;
  const cachedData = await browser.storage.local.get(cacheKey);
  
  if (cachedData[cacheKey] && 
      (Date.now() - cachedData[cacheKey].timestamp < CACHE_DURATION)) {
    console.log(`Using cached data for TCGPlayer ID: ${tcgplayerId}`);
    return cachedData[cacheKey].data;
  }
  
  // If not in cache or expired, fetch from API with rate limiting
  try {
    const data = await scryfallQueue.addRequest({
      url: `https://api.scryfall.com/cards/tcgplayer/${tcgplayerId}`,
      options: {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Bootleg-Mage-Enhancer/1.0 (GitHub: koiseka/bootleg-mage-enhancer)'
        }
      }
    });
    
    // Cache the result
    await browser.storage.local.set({
      [cacheKey]: {
        data,
        timestamp: Date.now()
      }
    });
    
    return data;
  } catch (error) {
    console.error(`Error fetching Scryfall data for TCGPlayer ID ${tcgplayerId}:`, error);
    return null;
  }
}

// Listen for messages from content script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getCardPrice") {
    fetchScryfallPrice(message.tcgplayerId)
      .then(data => {
        sendResponse({
          success: true,
          data
        });
      })
      .catch(error => {
        sendResponse({
          success: false,
          error: error.message
        });
      });
    return true; // Required for async response
  }
  
  if (message.action === "fetchCardData") {
    fetchCardData(message.url)
      .then(data => {
        sendResponse({
          success: true,
          data
        });
      })
      .catch(error => {
        sendResponse({
          success: false,
          error: error.message
        });
      });
    return true; // Required for async response
  }
});