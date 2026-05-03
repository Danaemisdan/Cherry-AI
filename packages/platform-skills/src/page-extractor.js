// Smart Page Extraction - Extracts full page content and intelligently parses it
// This is more resilient than brittle CSS selectors that break on UI updates

import { minimalDelay } from './common.js';

/**
 * Extract all visible text content from the page
 * Returns structured data that can be parsed intelligently
 */
export async function extractPageContent(page, options = {}) {
  const { includeHidden = false, maxLength = 50000 } = options;
  
  return await page.evaluate((opts) => {
    const { includeHidden, maxLength } = opts;
    
    // Helper to get visible text
    function getVisibleText(element) {
      if (!element) return '';
      const style = window.getComputedStyle(element);
      if (!includeHidden && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) {
        return '';
      }
      return element.innerText || element.textContent || '';
    }
    
    // Extract all interactive elements
    const interactiveElements = [];
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a[href], input, textarea, [contenteditable="true"]'));
    
    buttons.forEach((el, index) => {
      const text = getVisibleText(el).trim();
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const href = el.getAttribute('href') || '';
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      
      if (text || ariaLabel || title) {
        interactiveElements.push({
          index,
          tag: el.tagName.toLowerCase(),
          role,
          text: text.slice(0, 200),
          ariaLabel: ariaLabel.slice(0, 100),
          title: title.slice(0, 100),
          href: href.slice(0, 200),
          rect: el.getBoundingClientRect ? {
            top: el.getBoundingClientRect().top,
            left: el.getBoundingClientRect().left,
            visible: el.getBoundingClientRect().top > 0 && el.getBoundingClientRect().top < window.innerHeight
          } : null
        });
      }
    });
    
    // Extract main content areas
    const mainContent = [];
    const contentSelectors = [
      'main', 'article', '[role="main"]', '.main-content', '#main-content',
      '.content', '[data-testid]', '.feed', '.timeline', '.posts'
    ];
    
    contentSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el, idx) => {
        const text = getVisibleText(el).trim();
        if (text.length > 50) {
          mainContent.push({
            selector: `${selector}:nth-of-type(${idx + 1})`,
            text: text.slice(0, 1000),
            length: text.length
          });
        }
      });
    });
    
    // Get page metadata
    const metadata = {
      title: document.title || '',
      url: window.location.href,
      description: document.querySelector('meta[name="description"]')?.content || '',
    };
    
    // Get all headings for structure
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
      level: h.tagName,
      text: getVisibleText(h).trim().slice(0, 200)
    }));
    
    // Get all images with alt text
    const images = Array.from(document.querySelectorAll('img')).map(img => ({
      src: img.src?.slice(0, 200) || '',
      alt: img.alt?.slice(0, 100) || '',
      ariaLabel: img.getAttribute('aria-label')?.slice(0, 100) || ''
    })).filter(img => img.alt || img.ariaLabel);
    
    return {
      metadata,
      headings: headings.slice(0, 20),
      interactiveElements: interactiveElements.slice(0, 100),
      mainContent: mainContent.slice(0, 10),
      images: images.slice(0, 20),
      fullText: document.body.innerText?.slice(0, maxLength) || ''
    };
  }, { includeHidden, maxLength });
}

/**
 * Find elements by text content using fuzzy matching
 */
export async function findElementsByText(page, searchText, options = {}) {
  const { 
    tagNames = ['button', 'a', 'div', 'span', 'input', 'textarea'],
    fuzzy = true,
    caseSensitive = false 
  } = options;
  
  const searchLower = caseSensitive ? searchText : searchText.toLowerCase();
  
  return await page.evaluate((opts) => {
    const { tagNames, searchText, searchLower, fuzzy, caseSensitive } = opts;
    const results = [];
    
    tagNames.forEach(tag => {
      const elements = document.querySelectorAll(tag);
      elements.forEach((el, index) => {
        const text = (el.innerText || el.textContent || el.value || '').trim();
        const ariaLabel = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        
        const textLower = caseSensitive ? text : text.toLowerCase();
        const ariaLower = caseSensitive ? ariaLabel : ariaLabel.toLowerCase();
        const titleLower = caseSensitive ? title : title.toLowerCase();
        const placeholderLower = caseSensitive ? placeholder : placeholder.toLowerCase();
        
        let match = false;
        let matchType = '';
        let matchText = '';
        
        if (fuzzy) {
          // Fuzzy matching - includes, starts with, or contains words
          if (textLower.includes(searchLower)) {
            match = true;
            matchType = 'text';
            matchText = text;
          } else if (ariaLower.includes(searchLower)) {
            match = true;
            matchType = 'aria-label';
            matchText = ariaLabel;
          } else if (titleLower.includes(searchLower)) {
            match = true;
            matchType = 'title';
            matchText = title;
          } else if (placeholderLower.includes(searchLower)) {
            match = true;
            matchType = 'placeholder';
            matchText = placeholder;
          }
        } else {
          // Exact matching
          if (textLower === searchLower) {
            match = true;
            matchType = 'text-exact';
            matchText = text;
          } else if (ariaLower === searchLower) {
            match = true;
            matchType = 'aria-exact';
            matchText = ariaLabel;
          }
        }
        
        if (match) {
          results.push({
            tag: el.tagName.toLowerCase(),
            index,
            text: matchText.slice(0, 200),
            matchType,
            ariaLabel: ariaLabel.slice(0, 100),
            role: el.getAttribute('role') || '',
            href: el.getAttribute('href') || '',
            rect: el.getBoundingClientRect ? {
              top: el.getBoundingClientRect().top,
              left: el.getBoundingClientRect().left,
              width: el.getBoundingClientRect().width,
              height: el.getBoundingClientRect().height,
              visible: el.getBoundingClientRect().top > 0 && 
                       el.getBoundingClientRect().top < window.innerHeight &&
                       el.getBoundingClientRect().width > 0
            } : null
          });
        }
      });
    });
    
    // Sort by visibility (visible first) and then by match quality
    return results.sort((a, b) => {
      if (a.rect?.visible && !b.rect?.visible) return -1;
      if (!a.rect?.visible && b.rect?.visible) return 1;
      if (a.matchType.includes('exact') && !b.matchType.includes('exact')) return -1;
      return 0;
    });
  }, { tagNames, searchText, searchLower, fuzzy, caseSensitive });
}

/**
 * Smart element finder - tries multiple strategies
 */
export async function smartFindElement(page, searchCriteria, options = {}) {
  const { timeout = 5000, scrollToFind = true } = options;
  
  const strategies = [
    // Strategy 1: Exact text match on buttons
    async () => {
      const results = await findElementsByText(page, searchCriteria, { 
        tagNames: ['button', 'a', '[role="button"]'],
        fuzzy: false 
      });
      return results[0] || null;
    },
    
    // Strategy 2: Fuzzy text match
    async () => {
      const results = await findElementsByText(page, searchCriteria, { 
        tagNames: ['button', 'a', 'div', 'span', '[role="button"]'],
        fuzzy: true 
      });
      return results[0] || null;
    },
    
    // Strategy 3: ARIA label match
    async () => {
      const results = await findElementsByText(page, searchCriteria, { 
        tagNames: ['*'],
        fuzzy: true 
      });
      return results.find(r => r.matchType === 'aria-label') || null;
    },
    
    // Strategy 4: Partial match (for longer text)
    async () => {
      const words = searchCriteria.split(' ').filter(w => w.length > 2);
      for (const word of words) {
        const results = await findElementsByText(page, word, { 
          tagNames: ['button', 'a', '[role="button"]'],
          fuzzy: true 
        });
        if (results[0]) return results[0];
      }
      return null;
    }
  ];
  
  for (const strategy of strategies) {
    try {
      const result = await Promise.race([
        strategy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeout))
      ]);
      if (result) return result;
    } catch (e) {
      // Continue to next strategy
    }
  }
  
  return null;
}

/**
 * Parse profile information from extracted page content
 */
export function parseProfileFromContent(content, platform) {
  const { fullText, headings, interactiveElements, images } = content;
  const text = fullText || '';
  
  const profile = {
    name: '',
    handle: '',
    bio: '',
    location: '',
    company: '',
    jobTitle: '',
    followers: '',
    following: '',
    isVerified: false,
    isBusiness: false,
    isPrivate: false,
    category: '',
    website: '',
    email: '',
    phone: '',
    rawText: text.slice(0, 2000)
  };
  
  if (platform === 'instagram') {
    // Instagram patterns
    const nameMatch = text.match(/^(\w+(?:\s+\w+)?)\s*\n/);
    if (nameMatch) profile.name = nameMatch[1].trim();
    
    // Bio is usually after name and before Followers/Following/Posts
    const bioMatch = text.match(/\d+\s*(?:posts|followers|following)/i);
    if (bioMatch) {
      const bioEnd = text.indexOf(bioMatch[0]);
      profile.bio = text.slice(0, bioEnd).replace(profile.name, '').trim().slice(0, 500);
    }
    
    // Followers/Following/Posts
    const followersMatch = text.match(/(\d[\d,\.]*)\s*followers/i);
    const followingMatch = text.match(/(\d[\d,\.]*)\s*following/i);
    if (followersMatch) profile.followers = followersMatch[1];
    if (followingMatch) profile.following = followingMatch[1];
    
    // Category/Business
    const categoryMatch = text.match(/(?:\w+\s+)?(?:Business|Creator|Musician|Blogger|Artist|Public Figure|Educator)/i);
    if (categoryMatch) {
      profile.category = categoryMatch[0];
      profile.isBusiness = true;
    }
    
    // Private account
    profile.isPrivate = text.includes('This Account is Private') || 
                        text.includes('Private Account');
    
    // Website
    const websiteMatch = text.match(/(https?:\/\/[^\s]+)/);
    if (websiteMatch) profile.website = websiteMatch[1];
  }
  
  if (platform === 'linkedin') {
    // LinkedIn patterns
    // Name is usually the first heading
    if (headings && headings[0]) {
      profile.name = headings[0].text;
    }
    
    // Headline (job title + company)
    const headlineMatch = text.match(/^[\w\s]+\s+(?:at|@|with)\s+([\w\s]+)/m);
    if (headlineMatch) {
      profile.jobTitle = text.split('\n')[1]?.split(' at ')[0]?.trim();
      profile.company = headlineMatch[1].trim();
    }
    
    // Location
    const locationMatch = text.match(/([\w\s,]+(?:Area|Region|Country|India|USA|UK|Canada|Australia|Germany|France|Spain|Italy|Brazil|Mexico|Japan|China))/i);
    if (locationMatch) profile.location = locationMatch[1].trim();
    
    // Connections
    const connectionsMatch = text.match(/(\d[\d,\.]*)\s*connections?/i);
    if (connectionsMatch) profile.followers = connectionsMatch[1] + ' connections';
    
    // Open to work / hiring
    profile.openToWork = text.includes('Open to work') || text.includes('#OpenToWork');
    profile.hiring = text.includes('Hiring') || text.includes('#Hiring');
    
    // About section
    const aboutMatch = text.match(/About\s+([\s\S]{50,500}?)\s+(?:Experience|Education|Skills)/i);
    if (aboutMatch) profile.bio = aboutMatch[1].trim();
  }
  
  if (platform === 'twitter' || platform === 'x') {
    // Twitter/X patterns
    const nameMatch = text.match(/^([\w\s]+)\s*@(\w+)/m);
    if (nameMatch) {
      profile.name = nameMatch[1].trim();
      profile.handle = '@' + nameMatch[2];
    }
    
    // Bio comes after handle
    const lines = text.split('\n');
    const handleIndex = lines.findIndex(l => l.startsWith('@'));
    if (handleIndex >= 0 && lines[handleIndex + 1]) {
      profile.bio = lines[handleIndex + 1].slice(0, 500);
    }
    
    // Followers/Following
    const followersMatch = text.match(/(\d[\d,\.KM]*)\s*[Ff]ollowers/);
    const followingMatch = text.match(/(\d[\d,\.KM]*)\s*[Ff]ollowing/);
    if (followersMatch) profile.followers = followersMatch[1];
    if (followingMatch) profile.following = followingMatch[1];
    
    // Verified
    profile.isVerified = text.includes('Verified account') || interactiveElements.some(e => 
      e.ariaLabel?.includes('Verified') || e.text?.includes('Verified')
    );
    
    // Location
    const locationMatch = text.match(/(?:📍|Location:)\s*([\w\s,]+)/);
    if (locationMatch) profile.location = locationMatch[1].trim();
  }
  
  return profile;
}

/**
 * Detect relationship status (following/follower/mutual/none)
 */
export async function detectRelationshipStatus(page, platform) {
  const content = await extractPageContent(page);
  const { fullText, interactiveElements } = content;
  const text = fullText || '';
  
  const status = {
    isFollowing: false,
    isFollower: false,
    canFollow: false,
    canMessage: false,
    isConnected: false,
    isFriend: false,
    requestPending: false,
    isBlocked: false,
    relationship: 'unknown'
  };
  
  if (platform === 'instagram') {
    // Check for Following button (means we follow them)
    status.isFollowing = interactiveElements.some(e => 
      e.text === 'Following' || e.text === 'Requested'
    );
    
    // Check for Follow button (means we don't follow them)
    status.canFollow = interactiveElements.some(e => 
      e.text === 'Follow' || e.ariaLabel === 'Follow'
    );
    
    // Check for Message button (means we can message)
    status.canMessage = interactiveElements.some(e => 
      e.text?.includes('Message') || e.ariaLabel?.includes('Message')
    );
    
    // Request pending (private account)
    status.requestPending = text.includes('Requested') || 
                          interactiveElements.some(e => e.text === 'Requested');
    
    // Is follower? (Instagram doesn't show this directly on profile)
    // We'd need to check followers list separately
    
    status.relationship = status.isFollowing ? 'following' : 
                         status.requestPending ? 'pending' :
                         status.canFollow ? 'not_following' : 'unknown';
  }
  
  if (platform === 'linkedin') {
    // Connected
    status.isConnected = interactiveElements.some(e => 
      e.text?.includes('Message') || e.text === 'Connected'
    );
    
    // Can connect
    status.canFollow = interactiveElements.some(e => 
      e.text?.includes('Connect') || e.ariaLabel?.includes('Connect')
    );
    
    // Following (follow without connecting)
    status.isFollowing = interactiveElements.some(e => 
      e.text === 'Following' || e.text?.includes('Unfollow')
    );
    
    // Can follow
    if (!status.isFollowing && !status.isConnected) {
      status.canFollow = interactiveElements.some(e => 
        e.text?.includes('Follow')
      );
    }
    
    // Pending connection request
    status.requestPending = text.includes('Pending') || 
                          interactiveElements.some(e => e.text?.includes('Pending'));
    
    status.isConnected = status.isConnected;
    status.relationship = status.isConnected ? 'connected' :
                         status.requestPending ? 'pending' :
                         status.isFollowing ? 'following' :
                         status.canFollow ? 'none' : 'unknown';
  }
  
  if (platform === 'twitter' || platform === 'x') {
    status.isFollowing = interactiveElements.some(e => 
      e.text === 'Following' || e.text?.includes('Unfollow')
    );
    
    status.canFollow = interactiveElements.some(e => 
      e.text === 'Follow' || e.ariaLabel === 'Follow'
    );
    
    status.canMessage = interactiveElements.some(e => 
      e.text?.includes('Message') || e.ariaLabel?.includes('Message')
    );
    
    status.relationship = status.isFollowing ? 'following' : 
                         status.canFollow ? 'not_following' : 'unknown';
  }
  
  return status;
}

/**
 * Extract search results from page
 */
export async function extractSearchResults(page, platform) {
  const content = await extractPageContent(page);
  const { interactiveElements, fullText } = content;
  
  const results = [];
  
  if (platform === 'instagram') {
    // Instagram search results are usually in a list
    const userElements = interactiveElements.filter(e => 
      e.href?.includes('/p/') || 
      e.href?.includes('/reel/') ||
      (e.text && e.text.length < 50 && !e.text.includes(' '))
    );
    
    userElements.forEach(el => {
      results.push({
        type: el.href?.includes('/p/') ? 'post' : 
              el.href?.includes('/reel/') ? 'reel' : 'user',
        username: el.text,
        url: el.href,
        element: el
      });
    });
  }
  
  if (platform === 'linkedin') {
    // LinkedIn search results
    const peopleElements = interactiveElements.filter(e => 
      e.href?.includes('/in/') ||
      e.text?.includes('Connect') ||
      e.text?.includes('Message')
    );
    
    // Group by proximity (people cards)
    const textLines = fullText.split('\n');
    let currentPerson = null;
    
    textLines.forEach((line, idx) => {
      if (line.includes('linkedin.com/in/') || 
          (line.trim() && !line.includes(' ') && idx < textLines.length - 2)) {
        if (currentPerson) {
          results.push(currentPerson);
        }
        currentPerson = {
          type: 'person',
          name: line.trim(),
          headline: textLines[idx + 1]?.trim() || '',
          location: textLines[idx + 2]?.trim() || ''
        };
      }
    });
    
    if (currentPerson) results.push(currentPerson);
  }
  
  return results;
}

/**
 * Smart search that uses UI elements instead of direct URLs
 */
export async function performUISearch(page, platform, query, options = {}) {
  const { searchType = 'all', maxResults = 10 } = options;
  
  console.log(`[${platform}] Performing UI search for: "${query}"`);
  
  // Step 1: Find and click search input
  const searchInput = await findElementsByText(page, 'Search', {
    tagNames: ['input', 'div', 'button'],
    fuzzy: true
  });
  
  if (searchInput.length === 0) {
    console.log(`[${platform}] Could not find search input`);
    return { success: false, results: [] };
  }
  
  // Click the search input
  const inputEl = searchInput[0];
  const clickableIndex = inputEl.index;
  
  try {
    await page.evaluate((index) => {
      const inputs = document.querySelectorAll('input, div[contenteditable="true"]');
      if (inputs[index]) {
        inputs[index].click();
        inputs[index].focus();
      }
    }, clickableIndex);
    
    await minimalDelay(300);
    
    // Type the query
    await page.keyboard.type(query, { delay: 20 });
    await minimalDelay(1000); // Wait for results
    
    // Extract results
    const results = await extractSearchResults(page, platform);
    
    return {
      success: true,
      results: results.slice(0, maxResults),
      query
    };
  } catch (e) {
    console.log(`[${platform}] Search failed: ${e.message}`);
    return { success: false, error: e.message, results: [] };
  }
}
