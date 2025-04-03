// Global variables
let cardData = null;
let jsonDataUrl = "https://raw.githubusercontent.com/koiseka/bootleg-mage-enhancer/refs/heads/main/cards.json"; // Default URL
let processedElements = new WeakSet(); // Keep track of already processed elements
let wishlistItems = []; // Store wishlist items

// Load card data on initialization
async function loadSettings() {
  try {
    // No longer check for custom jsonDataUrl, always use the default
    console.log('Using default JSON URL:', jsonDataUrl);
    
    // Always load card data with the default URL
    await loadCardData();
    
    // Load wishlist data
    await loadWishlistData();
  } catch (error) {
    console.error('Error loading settings:', error);
    // Even if settings fail to load, try to load card data with default URL
    await loadCardData();
    await loadWishlistData();
  }
}

// Load card data on initialization
async function loadCardData() {
  try {
    // Try to get data from storage first
    const stored = await browser.storage.local.get(['cardData', 'cardDataTimestamp']);
    
    // Check if data exists and is fresh (less than 24 hours old)
    const isDataFresh = stored.cardDataTimestamp && 
      (Date.now() - stored.cardDataTimestamp < 24 * 60 * 60 * 1000);
    
    if (stored.cardData && isDataFresh) {
      cardData = stored.cardData;
      console.log('Using cached card data, containing', cardData.length, 'cards');
    } else {
      // If no cached data or it's old, fetch fresh data
      console.log('Fetching fresh card data from', jsonDataUrl);
      const response = await browser.runtime.sendMessage({
        action: "fetchCardData",
        url: jsonDataUrl
      });
      
      if (response.success) {
        cardData = response.data;
        // Store the card data in local storage
        browser.storage.local.set({
          cardData: response.data,
          cardDataTimestamp: Date.now()
        });
        console.log('Successfully loaded', cardData.length, 'cards');
      } else {
        console.error('Failed to load card data:', response.error);
      }
    }
  } catch (error) {
    console.error('Error loading card data:', error);
  }
}

// Load wishlist data from storage
async function loadWishlistData() {
  try {
    const stored = await browser.storage.local.get('wishlistItems');
    if (stored.wishlistItems && Array.isArray(stored.wishlistItems)) {
      wishlistItems = stored.wishlistItems;
      console.log('Loaded wishlist with', wishlistItems.length, 'items');
    } else {
      wishlistItems = [];
      console.log('No wishlist data found, initialized empty wishlist');
    }
  } catch (error) {
    console.error('Error loading wishlist data:', error);
    wishlistItems = [];
  }
}

// Save wishlist data to storage
async function saveWishlistData() {
  try {
    await browser.storage.local.set({ wishlistItems });
    console.log('Wishlist saved with', wishlistItems.length, 'items');
  } catch (error) {
    console.error('Error saving wishlist data:', error);
  }
}

// Find a card in the card data by product ID or name
function findCard(productId, productName, productSku) {
  if (!cardData || !Array.isArray(cardData)) {
    return null;
  }
  
  // First try to find by product ID (most reliable method)
  let card = cardData.find(c => c.productId === productId);
  if (card) return card;
  
  // Then try to find by SKU
  if (productSku) {
    card = cardData.find(c => c.productSku === productSku);
    if (card) return card;
  }
  
  // Try to find by product SKU extracted from product ID
  if (productId) {
    // BootlegMage product IDs often include SKU information
    card = cardData.find(c => {
      return c.productSku && productId.toString().includes(c.productSku);
    });
    
    // Also check if the product ID might be a direct TCGPlayer ID match
    if (!card) {
      card = cardData.find(c => c.tcgplayerId === productId);
    }
    
    if (card) return card;
  }
  
  // If not found by ID or SKU, try to find by name (with improved fuzzy matching)
  if (productName) {
    const normalizedProductName = productName.toLowerCase().trim();
    
    // Extract card number from product name if present (e.g., "#242" from "Swamp UNF #242 Foil")
    const numberMatch = normalizedProductName.match(/#(\d+)/);
    const productNumber = numberMatch ? numberMatch[1] : null;
    
    // Remove common suffixes that appear in Bootleg Mage product names
    const cleanedProductName = normalizedProductName
      .replace(/\s+foil\*?$/i, '')  // Remove "foil" or "foil*" at the end
      .replace(/\s+full\s+art$/i, ''); // Remove "full art" at the end
    
    // First try exact name match
    card = cardData.find(c => {
      if (!c.name) return false;
      const cardName = c.name.toLowerCase().trim();
      return cardName === normalizedProductName || cardName === cleanedProductName;
    });
    
    if (card) return card;
    
    // For cards with numbers, be more strict to avoid matching different numbered versions
    if (productNumber) {
      card = cardData.find(c => {
        if (!c.name) return false;
        const cardName = c.name.toLowerCase().trim();
        
        // If card has a number, make sure it matches
        const cardNumberMatch = cardName.match(/#(\d+)/);
        if (cardNumberMatch) {
          return cardNumberMatch[1] === productNumber && 
                 (cardName.includes(cleanedProductName) || 
                  cleanedProductName.includes(cardName.replace(/#\d+/, '').trim()));
        }
        
        return false;
      });
      
      if (card) return card;
    }
    
    // Split product name into parts to help match card names in different formats
    const productNameParts = cleanedProductName
      .replace(/#\d+/, '') // Remove the number part for base name matching
      .trim()
      .split(/\s+/);
    
    // Find cards with matching names - but be more careful with numbered items
    card = cardData.find(c => {
      if (!c.name) return false;
      const cardName = c.name.toLowerCase().trim();
      
      // Contains match in either direction
      const baseProductName = cleanedProductName.replace(/#\d+/, '').trim();
      const baseCardName = cardName.replace(/#\d+/, '').trim();
      
      // For basic lands and other numbered cards, be very strict
      const isNumberedCard = cardName.includes('#') || cleanedProductName.includes('#');
      if (isNumberedCard) {
        // If both have numbers, they must match exactly
        const cardNumberMatch = cardName.match(/#(\d+)/);
        const productNumberMatch = cleanedProductName.match(/#(\d+)/);
        
        if (cardNumberMatch && productNumberMatch) {
          return cardNumberMatch[1] === productNumberMatch[1] && 
                 baseCardName.includes(baseProductName) || baseProductName.includes(baseCardName);
        }
        
        // If only one has a number, they probably don't match
        if ((cardNumberMatch && !productNumberMatch) || (!cardNumberMatch && productNumberMatch)) {
          return false;
        }
      }
      
      // For non-numbered cards or if the strict number check passed
      if (baseProductName.includes(baseCardName) || baseCardName.includes(baseProductName)) {
        return true;
      }
      
      // Check if card name contains critical parts of the product name
      // This helps match cards like "Watery Grave Unfinity Galaxy Foil*" with "Watery Grave"
      const criticalWordsMatch = productNameParts
        .filter(part => part.length > 2 && 
          !['foil', 'art', 'full', 'showcase', 'extended', 'galaxy', 'etched', 'textured'].includes(part)
        )
        .every(word => cardName.includes(word));
      
      return criticalWordsMatch;
    });
  }
  
  return card;
}

// Create price badge element
function createPriceBadge(price, bootlegPrice, tcgplayerId, hasCardMatch) {
  let badge;
  
  // If we have a TCGPlayer ID, make the entire badge a link
  if (tcgplayerId) {
    badge = document.createElement('a');
    badge.href = `https://www.tcgplayer.com/product/${tcgplayerId}`;
    badge.target = '_blank'; // Open in new tab
    badge.rel = 'noopener noreferrer';
    badge.style.textDecoration = 'none';
    badge.style.cursor = 'pointer';
    
    // Add hover effect
    badge.addEventListener('mouseover', () => {
      badge.style.textDecoration = 'underline';
    });
    badge.addEventListener('mouseout', () => {
      badge.style.textDecoration = 'none';
    });
  } else {
    badge = document.createElement('span');
  }
  
  badge.classList.add('scryfall-price-badge');
  badge.dataset.processed = 'true';
  
  // Format price (handle different price formats from Scryfall)
  let formattedPrice = 'N/A';
  let parsedScryfallPrice = null;
  
  if (price) {
    if (typeof price === 'number') {
      parsedScryfallPrice = price;
      formattedPrice = `$${price.toFixed(2)}`;
    } else if (typeof price === 'string') {
      // If it's already formatted, use it
      formattedPrice = price.startsWith('$') ? price : `$${price}`;
      // Extract number for calculations
      parsedScryfallPrice = parseFloat(price.replace(/[^\d.-]/g, ''));
    }
  }
  
  // If no match in our card database, apply a different style
  
  if (hasCardMatch === false) {
    badge.classList.add('no-card-match');
    badge.style.backgroundColor = '#FFF3CD'; // Light yellow background
    badge.style.color = '#856404'; // Dark yellow/brown text
    badge.title = 'This item isn\'t in the extension\'s database.';
  } else {
    if (!price) {
      if (tcgplayerId === null) {
        badge.title = 'No price data available from Scryfall.';
      }
      else {
        badge.title = 'No price data available from Scryfall. Click to view on TCGPlayer.';
      }
      badge.classList.add('unavailable');
    }
  }
  
  // Final badge text with TCGPlayer label
  const badgeText = parsedScryfallPrice ? `TCGplayer: ${formattedPrice}` : 'TCGplayer: N/A';
  badge.textContent = badgeText;
  
  return badge;
}

// Extract product image URL from different sources
function extractProductImg(productElement) {
  // Try to find the product image
  const img = productElement.querySelector('.attachment-woocommerce_thumbnail, .wp-post-image');
  if (img && img.src) {
    return img.src;
  }
  
  // Try to find from gallery image
  const galleryImg = productElement.querySelector('.woocommerce-product-gallery__image img');
  if (galleryImg && galleryImg.src) {
    return galleryImg.src;
  }
  
  // Try to find from any image inside the product element
  const anyImg = productElement.querySelector('img');
  if (anyImg && anyImg.src) {
    return anyImg.src;
  }
  
  return null;
}

// Check if an item is in the wishlist
function isInWishlist(productId) {
  return wishlistItems.some(item => item.productId === productId);
}

// Create wishlist button
function createWishlistButton(productId, productName, productSku, productImg, productPrice) {
  const button = document.createElement('button');
  button.classList.add('wishlist-button');
  const isWishlisted = isInWishlist(productId);
  
  button.textContent = isWishlisted ? '★' : '☆';
  button.title = isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist';
  
  // Style the button
  button.style.position = 'absolute';
  button.style.top = '10px';
  button.style.right = '10px';
  button.style.zIndex = '100';
  button.style.backgroundColor = isWishlisted ? '#FFD700' : 'rgba(255, 255, 255, 0.8)';
  button.style.color = isWishlisted ? 'black' : '#666';
  button.style.border = 'none';
  button.style.borderRadius = '50%';
  button.style.width = '30px';
  button.style.height = '30px';
  button.style.fontSize = '18px';
  button.style.fontWeight = 'bold';
  button.style.cursor = 'pointer';
  button.style.display = 'flex';
  button.style.alignItems = 'center';
  button.style.justifyContent = 'center';
  button.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.2)';
  
  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    
    // Determine current state before the change
    const wasInWishlist = isInWishlist(productId);
    
    if (wasInWishlist) {
      // Remove from wishlist
      wishlistItems = wishlistItems.filter(item => item.productId !== productId);
      button.textContent = '☆';
      button.title = 'Add to Wishlist';
      button.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
      button.style.color = '#666';
    } else {
      // Add to wishlist
      const wishlistItem = {
        productId,
        productName,
        productSku: productSku || '',
        productImg: productImg || '',
        price: productPrice || '',
        dateAdded: new Date().toISOString(),
        quantity: 1  // Default quantity is 1
      };
      
      wishlistItems.push(wishlistItem);
      button.textContent = '★';
      button.title = 'Remove from Wishlist';
      button.style.backgroundColor = '#FFD700';
      button.style.color = 'black';
    }
    
    // Save wishlist data
    await saveWishlistData();
    
    // Show feedback with the correct message based on the action that was just performed
    const feedback = document.createElement('div');
    feedback.textContent = wasInWishlist ? 'Removed from wishlist' : 'Added to wishlist';
    feedback.style.position = 'fixed';
    feedback.style.bottom = '20px';
    feedback.style.left = '50%';
    feedback.style.transform = 'translateX(-50%)';
    feedback.style.padding = '10px 20px';
    feedback.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    feedback.style.color = 'white';
    feedback.style.borderRadius = '4px';
    feedback.style.zIndex = '10000';
    
    document.body.appendChild(feedback);
    
    setTimeout(() => {
      feedback.remove();
    }, 1500);
  });
  
  return button;
}

// Extract product ID from different sources
function extractProductId(productElement) {
  // Try to find product ID from post-XXXXX class
  if (productElement.classList) {
    let postId = null;
    for (const className of productElement.classList) {
      if (className.startsWith('post-')) {
        postId = className.replace('post-', '');
        break;
      }
    }
    if (postId) return postId;
  }
  
  // Check for Bootleg Mage specific data attributes
  const addToCartLink = productElement.querySelector('a[data-product_id]');
  if (addToCartLink) {
    return addToCartLink.dataset.product_id;
  }
  
  // Check for add-to-cart button on product pages
  const addToCartButton = productElement.querySelector('button[name="add-to-cart"]');
  if (addToCartButton && addToCartButton.value) {
    return addToCartButton.value;
  }
  
  // Check for add-to-cart input on product pages (alternative format)
  const addToCartInput = productElement.querySelector('input[name="add-to-cart"]');
  if (addToCartInput && addToCartInput.value) {
    return addToCartInput.value;
  }
  
  // If we're on a product page, look more broadly through the document
  const singleProductElements = document.querySelectorAll('.single-product, .product_title.entry-title');
  if (singleProductElements.length > 0) {
    // Try to find add to cart button anywhere in the document
    const globalAddToCartButton = document.querySelector('button[name="add-to-cart"]');
    if (globalAddToCartButton && globalAddToCartButton.value) {
      return globalAddToCartButton.value;
    }
    
    const globalAddToCartInput = document.querySelector('input[name="add-to-cart"]');
    if (globalAddToCartInput && globalAddToCartInput.value) {
      return globalAddToCartInput.value;
    }
    
    // Extract from URL if all else fails (product pages often have post ID in URL)
    const urlMatch = location.pathname.match(/\/product\/.*?\/(\d+)/);
    if (urlMatch && urlMatch[1]) {
      return urlMatch[1];
    }
  }
  
  // Fallback to other methods
  return productElement.dataset.productId || 
         productElement.getAttribute('id')?.replace('post-', '') || 
         productElement.querySelector('[data-product-id]')?.dataset.productId ||
         productElement.querySelector('a.button.add_to_cart_button')?.dataset.product_id;
}

// Extract product SKU from different sources
function extractProductSku(productElement) {
  // Try to find SKU from add to cart button
  const addToCartLink = productElement.querySelector('a.button.add_to_cart_button[data-product_sku]');
  if (addToCartLink && addToCartLink.dataset.product_sku) {
    return addToCartLink.dataset.product_sku;
  }
  
  // Try to find from any element with data-product_sku
  const skuElement = productElement.querySelector('[data-product_sku]');
  if (skuElement) {
    return skuElement.dataset.product_sku;
  }
  
  // Look for SKU pattern in link URLs
  const links = productElement.querySelectorAll('a');
  for (const link of links) {
    const href = link.getAttribute('href');
    if (href && href.includes('product_sku=')) {
      const match = href.match(/product_sku=([^&]+)/);
      if (match && match[1]) {
        return match[1];
      }
    }
  }
  
  return null;
}

// Extract product name from different sources
function extractProductName(productElement) {
  // Try Bootleg Mage specific selectors first
  const titleElement = productElement.querySelector('.woocommerce-loop-product__title, .product_title.entry-title');
  if (titleElement) {
    return titleElement.textContent.trim();
  }
  
  // Fallback to more generic selectors
  return productElement.querySelector('h2')?.textContent?.trim() ||
         productElement.querySelector('h1')?.textContent?.trim() ||
         productElement.querySelector('.title')?.textContent?.trim();
}

// Extract bootleg price from product element
function extractBootlegPrice(productElement) {
  // Find price elements - BootlegMage has specific markup for prices
  const priceElement = productElement.querySelector('.price');
  if (!priceElement) return null;
  
  // Try to get the sale price first (ins element)
  const salePrice = priceElement.querySelector('ins .woocommerce-Price-amount');
  if (salePrice) {
    return salePrice.textContent.trim();
  }
  
  // If no sale price, get the regular price
  const regularPrice = priceElement.querySelector('.woocommerce-Price-amount');
  if (regularPrice) {
    return regularPrice.textContent.trim();
  }
  
  return null;
}

// Extract product data from a product element
function extractProductData(productElement) {
  const productId = extractProductId(productElement);
  const productSku = extractProductSku(productElement);
  const productName = extractProductName(productElement);
  const productImg = extractProductImg(productElement);
  
  if (!productId && !productName) {
    return null; // Skip if no identifiable information
  }
  
  // Format the data in the required JSON format
  return {
    name: productName,
    tcgplayerId: "",  // Leave empty for manual filling
    productId: productId,
    productSku: productSku || "",
    productImg: productImg || ""
  };
}

// Process a product element and add price badge
async function processProductElement(productElement) {
  // Skip if already processed (using our WeakSet to track elements)
  if (processedElements.has(productElement)) {
    return;
  }
  
  // Mark this element as processed to prevent duplicate processing
  processedElements.add(productElement);
  
  try {
    // Extract product information
    const productId = extractProductId(productElement);
    const productSku = extractProductSku(productElement);
    const productName = extractProductName(productElement);
    const bootlegPrice = extractBootlegPrice(productElement);
    const productImg = extractProductImg(productElement);
    
    if (!productId && !productName) {
      return; // Skip if no identifiable information
    }
    if (productSku.includes('-BNDL') || productName.includes('Bundle'))
    {
      return; // Skip if product is a bundle
    }
    
    // Add wishlist button (regardless of whether we're on product page or listing)
    let imageContainer = null;
    
    // On product page (gallery image)
    if (productElement.classList.contains('woocommerce-product-gallery__image')) {
      imageContainer = productElement;
    } 
    // On product listings - try to find the product link with the image
    else {
      const link = productElement.querySelector('a.woocommerce-LoopProduct-link');
      if (link) {
        imageContainer = link;
      } else {
        // Fallback to other methods of finding the image container
        imageContainer = productElement.querySelector('.attachment-woocommerce_thumbnail')?.parentElement ||
                        productElement.querySelector('img')?.parentElement;
      }
    }
    
    if (!imageContainer) {
      imageContainer = productElement;
    }
    
    // Ensure the container has position for absolute positioning of elements
    if (!imageContainer.style.position || imageContainer.style.position === 'static') {
      imageContainer.style.position = 'relative';
    }
    
    // Only add wishlist button if not already present
    if (!imageContainer.querySelector('.wishlist-button')) {
      const wishlistButton = createWishlistButton(productId, productName, productSku, productImg, bootlegPrice);
      imageContainer.appendChild(wishlistButton);
    }
    
    // Normal mode: Add price badge if we have card data
    // Skip if this element already has a price badge
    if (productElement.querySelector('.scryfall-price-badge')) {
      return;
    }
    
    console.log(`Processing product: ${productName || 'Unknown'}, ID: ${productId || 'N/A'}, SKU: ${productSku || 'N/A'}, Price: ${bootlegPrice || 'N/A'}`);
    
    // Find matching card in our data
    const card = findCard(productId, productName, productSku);
    
    // Initialize price and tcgplayerId variables
    let price = null;
    let tcgplayerId = null;
    
    // Explicitly check if card is null or undefined
    const hasCardMatch = card !== null && card !== undefined;
    console.log(`Card match: ${hasCardMatch} for ${productName}`);
    
    // If we found a card and it has a TCGPlayer ID, we'll try to get the price
    if (hasCardMatch && card.tcgplayerId) {
      tcgplayerId = card.tcgplayerId;
      console.log(`Found match for ${productName || productId}: TCGPlayer ID ${card.tcgplayerId}`);
      
      // Get price from Scryfall via background script
      const response = await browser.runtime.sendMessage({
        action: "getCardPrice",
        tcgplayerId: card.tcgplayerId
      });
      
      if (response.success && response.data) {
        // Extract price from Scryfall data
        if (response.data.prices) {
          // Check if the product is an etched foil based on SKU or name
          const isEtchedFoil = (productSku && productSku.includes('-EF')) || 
                              (productName && productName.toLowerCase().includes('etched foil'));
          
          if (isEtchedFoil) {
            // For etched foil products, prioritize etched foil price
            price = response.data.prices.usd_etched || 
                    response.data.prices.usd_foil || 
                    response.data.prices.usd;
          }
          // For regular foil products on Bootleg Mage, prefer foil prices
          else if (productName && (productName.toLowerCase().includes('foil') || 
                             productSku && productSku.toLowerCase().includes('-hf'))) {
            price = response.data.prices.usd_foil || 
                    response.data.prices.usd_etched || 
                    response.data.prices.usd;
          } else {
            // Otherwise prefer normal prices
            price = response.data.prices.usd || 
                    response.data.prices.usd_foil || 
                    response.data.prices.usd_etched;
          }
          
          // Fallback to EUR if no USD price available
          if (!price) {
            price = response.data.prices.eur || 
                    response.data.prices.eur_foil;
          }
        }
        
        console.log(`Price for ${card.name}: ${price || 'Not available'}`);
      } else {
        console.log(`No price data available for ${productName || productId}`);
      }
    } else {
      console.log(`No match found for product: ${productName || productId}`);
    }
    
    // Create the price badge with whatever data we have (may be null)
    const badge = createPriceBadge(price, bootlegPrice, tcgplayerId, hasCardMatch);
    
    // Check if we're on a single product page
    const isSingleProductPage = document.querySelectorAll('.single-product, .product_title.entry-title').length > 0;
    
    if (isSingleProductPage) {
      console.log('Adding price badge to single product page');
      
      // On single product pages, look for price element in the document
      const mainPriceElement = document.querySelector('.elementor-widget-woocommerce-product-price .price') ||
                              document.querySelector('p.price') ||
                              document.querySelector('.price');
      
      if (mainPriceElement && !mainPriceElement.querySelector('.scryfall-price-badge')) {
        // Add whitespace before the badge gets added
        const whitespace = document.createTextNode('   ');
        mainPriceElement.appendChild(whitespace);
        mainPriceElement.appendChild(badge);
        return;
      }
    }
    
    // Standard product listing logic
    // Look for the price element to place our badge alongside
    const priceElement = productElement.querySelector('.price');
    
    if (priceElement) {
      // Add whitespace before the badge gets added
      const whitespace = document.createTextNode('   ');
      priceElement.appendChild(whitespace);
      
      // Important: Always append to the very end of price element, 
      // after any sale price elements and the whitespace
      priceElement.appendChild(badge);
    } else {
      // If no price element found, find a fallback container
      let container = productElement.querySelector('.product-details') || 
                      productElement.querySelector('.product-info') || 
                      productElement.querySelector('.product_meta') ||
                      productElement;
      
      // Append to container
      container.appendChild(badge);
    }
    
  } catch (error) {
    console.error('Error processing product element:', error);
  }
}

// Scan the page for product elements
function scanPage() {
  if (!cardData) {
    console.log('Card data not loaded yet. Waiting...');
    setTimeout(scanPage, 1000);
    return;
  }
  
  // Use a Set to keep track of unique elements
  const uniqueElements = new Set();
  
  // Check if we're on a single product page by looking for specific elements
  const singleProductElements = document.querySelectorAll('.single-product .product, .product_title.entry-title');
  const isSingleProductPage = singleProductElements.length > 0;
  
  if (isSingleProductPage) {
    console.log('Detected single product page');
    
    // On a single product page, we need to look for different elements
    // 1. First try to find the main product container
    const mainProduct = document.querySelector('.product, article.product');
    
    if (mainProduct) {
      uniqueElements.add(mainProduct);
    } else {
      // 2. If no main product container, look for specific product elements
      
      // Look for product title and price section
      const productTitleSection = document.querySelector('.elementor-element .product_title.entry-title')?.closest('.elementor-column');
      if (productTitleSection) {
        // Find the add to cart form which typically has product ID info
        const addToCartForm = document.querySelector('form.cart');
        if (addToCartForm) {
          const addToCartButton = addToCartForm.querySelector('button[name="add-to-cart"]');
          if (addToCartButton && addToCartButton.value) {
            // Create a virtual product element with the necessary data
            const virtualProduct = document.createElement('div');
            virtualProduct.dataset.productId = addToCartButton.value;
            
            // Find product title
            const titleElement = document.querySelector('.product_title.entry-title');
            if (titleElement) {
              const productName = titleElement.textContent.trim();
              // Add a title element to our virtual product
              const titleSpan = document.createElement('span');
              titleSpan.classList.add('product_title');
              titleSpan.textContent = productName;
              virtualProduct.appendChild(titleSpan);
            }
            
            // Find price element and clone it into our virtual product
            const priceElement = document.querySelector('.price');
            if (priceElement) {
              virtualProduct.appendChild(priceElement.cloneNode(true));
            }
            
            uniqueElements.add(productTitleSection);
          }
        }
      }
      
      // Look for WooCommerce product gallery
      const galleryElement = document.querySelector('.woocommerce-product-gallery');
      if (galleryElement) {
        const galleryImages = galleryElement.querySelectorAll('.woocommerce-product-gallery__image');
        if (galleryImages.length > 0) {
          uniqueElements.add(galleryImages[0]); // Add the first gallery image
        }
      }
    }
  } else {
    // On product listing pages, use the standard approach
    
    // Look for WooCommerce product list items first - these are the most reliable
    const listProductElements = document.querySelectorAll('li.product');
    listProductElements.forEach(el => uniqueElements.add(el));
    
    // If no products found in the main way, try other selectors
    if (uniqueElements.size === 0) {
      const otherProductElements = [
        // Main page product listings - Bootleg Mage specific
        ...document.querySelectorAll('.products.elementor-grid .product'),
        
        // Product detail page elements (as fallback)
        ...document.querySelectorAll('.woocommerce-product-gallery__image'),
        ...document.querySelectorAll('.woocommerce-product-gallery__wrapper div[data-thumb]'),
        
        // Generic WooCommerce selectors (fallback)
        ...document.querySelectorAll('.product-container'),
        ...document.querySelectorAll('[data-product-id]')
      ];
      
      otherProductElements.forEach(el => uniqueElements.add(el));
    }
  }
  
  console.log(`Found ${uniqueElements.size} potential product elements`);
  
  // Process each product element
  uniqueElements.forEach(productElement => {
    processProductElement(productElement);
  });
}

// Extract data from all cards on the page
function extractAllCardData() {
  // Look for WooCommerce product list items
  const productElements = document.querySelectorAll('li.product');
  
  if (productElements.length === 0) {
    alert('No product cards found on the page');
    return [];
  }
  
  const cardDataItems = [];
  
  // Process each product element
  productElements.forEach(productElement => {
    const cardData = extractProductData(productElement);
    if (cardData) {
      cardDataItems.push(cardData);
    }
  });
  
  return cardDataItems;
}

// Copy all card data to clipboard
function copyAllCardData() {
  const cardDataItems = extractAllCardData();
  
  if (cardDataItems.length === 0) {
    alert('No card data found to extract');
    return;
  }
  
  // Format the data as JSON string with proper indentation
  const jsonString = JSON.stringify(cardDataItems, null, 4);
  
  // Copy to clipboard
  navigator.clipboard.writeText(jsonString)
    .then(() => {
      alert(`Data for ${cardDataItems.length} cards copied to clipboard!`);
      
      // Log to console for convenience
      console.log('Extracted Card Data for all cards:', jsonString);
    })
    .catch(err => {
      console.error('Failed to copy data:', err);
      // Fallback: show in console
      console.log('Card Data (copy manually):', jsonString);
      alert('Error copying to clipboard. See browser console for data.');
    });
}

// Create floating toggle button
function createToggleButton() {
  const toggleButton = document.createElement('button');
  toggleButton.id = 'extraction-mode-toggle';
  toggleButton.textContent = 'Extract Card Data';
  
  // Style the button
  const buttonStyle = {
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: '9999',
    backgroundColor: '#4a6ba7',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
  };
  
  Object.assign(toggleButton.style, buttonStyle);
  
  // Add hover effect
  toggleButton.addEventListener('mouseover', () => {
    toggleButton.style.backgroundColor = '#3a5a96';
  });
  
  toggleButton.addEventListener('mouseout', () => {
    toggleButton.style.backgroundColor = extractionMode ? '#dc3545' : '#4a6ba7';
  });
  
  // Add click handler
  toggleButton.addEventListener('click', () => {
    const isExtractionMode = toggleExtractionMode();
    toggleButton.textContent = isExtractionMode ? 'Return to Price Mode' : 'Extract Card Data';
    toggleButton.style.backgroundColor = isExtractionMode ? '#dc3545' : '#4a6ba7';
  });
  
  return toggleButton;
}

// Create Extract All button
function createExtractAllButton() {
  const button = document.createElement('button');
  button.id = 'extract-all-button';
  button.textContent = 'Extract All Cards';
  
  // Style the button
  const buttonStyle = {
    position: 'fixed',
    bottom: '20px',
    right: '180px',
    zIndex: '9999',
    backgroundColor: '#28a745',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
  };
  
  Object.assign(button.style, buttonStyle);
  
  // Add hover effect
  button.addEventListener('mouseover', () => {
    button.style.backgroundColor = '#218838';
  });
  
  button.addEventListener('mouseout', () => {
    button.style.backgroundColor = '#28a745';
  });
  
  // Add click handler
  button.addEventListener('click', () => {
    copyAllCardData();
  });
  
  return button;
}

// Observe DOM changes to handle dynamically loaded content
function observePageChanges() {
  const observer = new MutationObserver(mutations => {
    let shouldScan = false;
    
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        // Check if any added nodes are products or contain products
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList && node.classList.contains('product')) {
              shouldScan = true;
              break;
            }
            
            const hasProducts = node.querySelectorAll('.product, li.product').length > 0;
            if (hasProducts) {
              shouldScan = true;
              break;
            }
          }
        }
        
        if (shouldScan) break;
      }
    }
    
    if (shouldScan) {
      // Add a small delay to let DOM fully update
      setTimeout(scanPage, 100);
    }
  });
  
  observer.observe(document.body, { 
    childList: true, 
    subtree: true 
  });
}

// Handle messages from popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'reloadCardData') {
    // Clear processed elements cache to force re-processing
    processedElements = new WeakSet();
    
    // Remove existing badges
    document.querySelectorAll('.scryfall-price-badge').forEach(badge => {
      badge.remove();
    });
    
    loadCardData().then(() => {
      scanPage();
    });
    return Promise.resolve({success: true});
  }

  if (message.action === 'addToCart') {
    return addToCart(message.productId, message.quantity);
  }
  
  if (message.action === 'getWishlistItems') {
    return Promise.resolve({success: true, wishlistItems});
  }
  
  if (message.action === 'removeFromWishlist') {
    const { productId } = message;
    wishlistItems = wishlistItems.filter(item => item.productId !== productId);
    saveWishlistData();
    return Promise.resolve({success: true});
  }
  
  if (message.action === 'clearWishlist') {
    wishlistItems = [];
    saveWishlistData();
    return Promise.resolve({success: true});
  }
  
  if (message.action === 'updateWishlistItems') {
    // Update wishlist with the new items (includes quantity changes)
    if (message.wishlistItems && Array.isArray(message.wishlistItems)) {
      wishlistItems = message.wishlistItems;
      saveWishlistData();
    }
    return Promise.resolve({success: true});
  }
  
  if (message.action === 'addWishlistToCart') {
    // Check if there are items to add
    if (!wishlistItems || wishlistItems.length === 0) {
      return Promise.resolve({
        success: true,
        added: 0,
        failed: 0
      });
    }
    
    // Fix: Use sequential processing instead of Promise.all to ensure items are added one by one
    return addWishlistItemsSequentially(wishlistItems)
      .then(results => {
        return {
          success: true,
          added: results.success,
          failed: results.failed
        };
      })
      .catch(error => {
        console.error("Error adding wishlist items:", error);
        return {
          success: false,
          error: error.message
        };
      });
  }
});

// Add wishlist items to cart sequentially to prevent race conditions
async function addWishlistItemsSequentially(items) {
  let success = 0;
  let failed = 0;
  
  // Create a copy of the array to work with
  const itemsToProcess = [...items];
  
  // Process each item sequentially
  for (const item of itemsToProcess) {
    try {
      // Get quantity from item or default to 1
      const quantity = item.quantity || 1;
      
      console.log(`Adding item to cart: ${item.productName || 'Unknown'}, ID: ${item.productId}, Quantity: ${quantity}`);
      const result = await addToCart(item.productId, quantity, item.productSku);
      
      // Add small delay between requests to prevent overloading the server
      await new Promise(resolve => setTimeout(resolve, 300));
      
      if (result.success) {
        success++;
        console.log(`Successfully added item: ${item.productName || 'Unknown'} (Qty: ${quantity})`);
      } else {
        failed++;
        console.error(`Failed to add item: ${item.productName || 'Unknown'}, Error: ${result.error}`);
      }
    } catch (error) {
      failed++;
      console.error(`Error processing item ${item.productName || 'Unknown'}:`, error);
    }
  }
  
  return { success, failed };
}

// Add a card to cart by product ID and quantity
async function addToCart(productId, quantity = 1, productSku = null) {
  try {
    if (!productId) {
      return Promise.resolve({success: false, error: "No product ID provided"});
    }

    // Ensure quantity is properly parsed as an integer
    const parsedQuantity = parseInt(quantity, 10);
    if (isNaN(parsedQuantity) || parsedQuantity < 1) {
      console.warn("Invalid quantity provided, defaulting to 1:", quantity);
      quantity = 1;
    } else {
      quantity = parsedQuantity;
    }

    // First, try to get the product name and SKU if not provided
    let productName = '';
    
    // If we have card data loaded, try to find additional product info
    if (cardData && Array.isArray(cardData)) {
      const cardInfo = cardData.find(card => card.productId === productId);
      if (cardInfo) {
        if (!productSku && cardInfo.productSku) {
          productSku = cardInfo.productSku;
        }
        if (cardInfo.name) {
          productName = cardInfo.name;
        }
      }
    }
    
    // If we still don't have a product name, try to get it from the page
    if (!productName) {
      // Look for product name on the current page based on product ID
      const productElement = document.querySelector(`[data-product_id="${productId}"], .post-${productId}`);
      if (productElement) {
        const nameElement = productElement.querySelector('.woocommerce-loop-product__title') || 
                           productElement.querySelector('h2') || 
                           productElement.querySelector('h1');
        if (nameElement) {
          productName = nameElement.textContent.trim();
        }
      }
    }
    
    // Generate a success message if we have a product name
    const successMessage = productName ? 
      encodeURIComponent(`"${productName}" has been added to your cart`) : '';

    // Create form data for the request
    const formData = new FormData();
    formData.append('product_id', productId);
    formData.append('quantity', quantity.toString()); // Make sure quantity is a string
    
    // Add product SKU if available
    if (productSku) {
      formData.append('product_sku', productSku);
    }
    
    // Add success message if available
    if (successMessage) {
      formData.append('success_message', successMessage);
    }
    
    // IMPORTANT: Remove the add-to-cart parameter as it's likely causing the double-add issue
    // When using the WC-AJAX endpoint, this parameter is not needed and might be triggering
    // a separate add-to-cart action
    // formData.append('add-to-cart', productId);
    
    console.log(`Sending add to cart request: Product ID=${productId}, Quantity=${quantity}, SKU=${productSku || 'N/A'}`);
    
    // Send the request to add item to cart
    const response = await fetch('https://bootlegmage.com/?wc-ajax=add_to_cart', {
      method: 'POST',
      body: formData,
      headers: {
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    if (!response.ok) {
      console.error("Failed to add item to cart:", response.status, response.statusText);
      return Promise.resolve({success: false, error: `Failed to add to cart: ${response.statusText}`});
    }
    
    const data = await response.json();
    
    if (data.error) {
      console.error("Error adding to cart:", data.error);
      return Promise.resolve({success: false, error: data.error});
    }
    
    // Update cart fragments in the UI if available
    if (data.fragments) {
      // Update mini cart fragments if available
      if (data.fragments['div.widget_shopping_cart_content']) {
        document.querySelectorAll('.widget_shopping_cart_content').forEach(el => {
          // Replace unsafe innerHTML with a safer approach using DOM parser
          const parser = new DOMParser();
          const fragmentDoc = parser.parseFromString(data.fragments['div.widget_shopping_cart_content'], 'text/html');
          // Clear existing content
          while (el.firstChild) {
            el.removeChild(el.firstChild);
          }
          // Append new content
          while (fragmentDoc.body.firstChild) {
            el.appendChild(fragmentDoc.body.firstChild);
          }
        });
      }
      
      // Update cart count if available
      if (data.fragments['.elementor-menu-cart__wrapper']) {
        document.querySelectorAll('.elementor-menu-cart__wrapper').forEach(el => {
          // Replace unsafe innerHTML with a safer approach using DOM parser
          const parser = new DOMParser();
          const fragmentDoc = parser.parseFromString(data.fragments['.elementor-menu-cart__wrapper'], 'text/html');
          // Clear existing content
          while (el.firstChild) {
            el.removeChild(el.firstChild);
          }
          // Append new content
          while (fragmentDoc.body.firstChild) {
            el.appendChild(fragmentDoc.body.firstChild);
          }
        });
      }
    }
    
    console.log(`Added product ${productId} to cart with quantity ${quantity}`);
    return Promise.resolve({success: true, productName});
    
  } catch (error) {
    console.error("Error adding to cart:", error);
    return Promise.resolve({success: false, error: error.message});
  }
}

// Initialize the extension
async function init() {
  await loadSettings();
  // Add a small delay to ensure the page is fully loaded
  setTimeout(() => {
    scanPage();
    observePageChanges();
  }, 500);
}

// Start the extension
if (document.readyState === 'loading') {
  window.addEventListener('load', init);
} else {
  init();
}

// Re-scan on page navigation for single-page applications
let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    console.log('URL changed, rescanning page');
    
    setTimeout(() => {
      scanPage();
    }, 500);
  }
}).observe(document, {subtree: true, childList: true});