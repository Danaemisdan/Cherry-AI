// Contact Mapping System - Extract and analyze contacts across all platforms
// Maps conversations, categorizes contacts, and builds intelligence for dashboard

import { extractChatContext } from './chat-context.js';
import { extractProfileContext } from './profile-context.js';

const DEFAULT_CATEGORIES = {
  leads: [],
  partners: [],
  candidates: [],
  customers: [],
  network: [],
  audience: [],
  unknown: [],
};

const PLATFORM_HOME_URLS = {
  whatsapp: 'https://web.whatsapp.com',
  linkedin: 'https://www.linkedin.com',
  instagram: 'https://www.instagram.com',
  twitter: 'https://x.com',
  facebook: 'https://www.facebook.com',
  gmail: 'https://mail.google.com',
};

function categorizeContacts(contacts = []) {
  const categorized = Object.fromEntries(Object.entries(DEFAULT_CATEGORIES).map(([key]) => [key, []]));
  for (const contact of contacts) {
    const category = contact.potentialUse || 'unknown';
    if (categorized[category]) {
      categorized[category].push(contact);
    } else {
      categorized.unknown.push(contact);
    }
  }
  return categorized;
}

function collectContacts(contactResult = {}) {
  const contacts = [
    ...(contactResult.contacts || []),
    ...(contactResult.connections || []),
    ...(contactResult.followers || []),
    ...(contactResult.following || []),
    ...(contactResult.pendingRequests || []),
    ...(contactResult.conversations || []),
    ...(contactResult.profiles || []),
  ];
  const seen = new Set();
  return contacts.filter((contact) => {
    const key = `${contact.platform || ''}:${contact.username || contact.displayName || contact.id || ''}`.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeCategorized(target, source) {
  for (const [key, contacts] of Object.entries(source || {})) {
    if (!target[key]) target[key] = [];
    target[key].push(...(contacts || []));
  }
}

async function attachCurrentConversation(page, platform, contacts, fallbackUsername = '') {
  const chatContext = await extractChatContext(page, platform, 12).catch(() => []);
  if (!chatContext.length) return contacts;

  const username = fallbackUsername || contacts[0]?.username || contacts[0]?.displayName || 'current_chat';
  const intelligence = await analyzeContactIntelligence(page, platform, username, chatContext);
  const existing = contacts.find((contact) => contact.username === username || contact.displayName === username);
  const target = existing || intelligence;
  target.addConversation?.(chatContext);
  target.messageCount = Math.max(target.messageCount || 0, chatContext.length);
  target.lastMessageAt = target.lastMessageAt || Date.now();
  target.sentiment = intelligence.sentiment || target.sentiment || 'neutral';
  target.potentialUse = intelligence.potentialUse || target.potentialUse || 'unknown';
  if (!existing) contacts.push(target);
  return contacts;
}

/**
 * Contact profile with conversation history and categorization
 */
export class ContactProfile {
  constructor(data = {}) {
    this.id = data.id || `${data.platform}_${data.username}_${Date.now()}`;
    this.platform = data.platform || '';
    this.username = data.username || '';
    this.displayName = data.displayName || '';
    this.profileUrl = data.profileUrl || '';
    this.avatarUrl = data.avatarUrl || '';
    this.bio = data.bio || '';
    this.location = data.location || '';
    this.company = data.company || '';
    this.title = data.title || '';
    
    // Categorization
    this.category = data.category || 'unknown'; // new_follower, connection, pending_request, contacted, etc
    this.relationship = data.relationship || 'none'; // connected, following, pending, none
    this.isPrivate = data.isPrivate || false;
    this.isBusiness = data.isBusiness || false;
    
    // Conversation tracking
    this.conversations = data.conversations || [];
    this.lastMessageAt = data.lastMessageAt || null;
    this.messageCount = data.messageCount || 0;
    this.sentiment = data.sentiment || 'neutral';
    
    // Intent/Use case
    this.potentialUse = data.potentialUse || ''; // lead, partner, candidate, etc
    this.notes = data.notes || '';
    this.tags = data.tags || [];
    
    // Timestamps
    this.firstSeenAt = data.firstSeenAt || Date.now();
    this.lastUpdatedAt = data.lastUpdatedAt || Date.now();
    this.extractedAt = data.extractedAt || Date.now();
  }
  
  addConversation(messages) {
    if (messages && messages.length > 0) {
      this.conversations.push({
        date: Date.now(),
        messages: messages.slice(-10),
        summary: this.summarizeConversation(messages)
      });
      this.lastMessageAt = Date.now();
      this.messageCount += messages.length;
    }
  }
  
  summarizeConversation(messages) {
    if (!messages || messages.length === 0) return '';
    const lastMsg = messages[messages.length - 1];
    return lastMsg.text?.slice(0, 100) || '';
  }
}

/**
 * Extract contacts from WhatsApp
 */
export async function extractWhatsAppContacts(page, options = {}) {
  const { limit = 100, includeChats = true } = options;
  
  try {
    // Navigate to WhatsApp
    await page.goto('https://web.whatsapp.com');
    await page.waitForTimeout(5000);
    
    // Extract contacts from sidebar
    const contacts = await page.evaluate((maxContacts) => {
      const results = [];
      const chatElements = document.querySelectorAll('[data-testid="chat-list"] [data-testid="cell-frame-container"], [data-testid="conversation-chat-list"] [data-testid="cell-frame-container"]');
      
      chatElements.forEach((el, index) => {
        if (index >= maxContacts) return;
        
        const nameEl = el.querySelector('[data-testid="cell-frame-title"] span, .x1iyjqo2');
        const phoneEl = el.querySelector('[data-testid="cell-frame-secondary"]');
        const lastMessageEl = el.querySelector('[data-testid="cell-frame-secondary-detail"]');
        const unreadBadge = el.querySelector('[data-testid="icon-badge"]');
        
        const name = nameEl?.textContent?.trim() || '';
        const phone = phoneEl?.textContent?.trim() || '';
        const lastMessage = lastMessageEl?.textContent?.trim() || '';
        const hasUnread = !!unreadBadge;
        
        if (name && name !== 'Status') {
          results.push({
            name,
            phone,
            lastMessage,
            hasUnread,
            isGroup: name.includes('(') || lastMessage?.includes('created group'),
          });
        }
      });
      
      return results;
    }, limit);
    
    // Create contact profiles
    const profiles = contacts.map(c => new ContactProfile({
      platform: 'whatsapp',
      username: c.phone || c.name,
      displayName: c.name,
      category: c.isGroup ? 'group' : 'contact',
      relationship: c.hasUnread ? 'active_chat' : 'contact',
      potentialUse: c.isGroup ? 'community' : 'lead',
    }));
    
    return {
      platform: 'whatsapp',
      count: profiles.length,
      contacts: profiles,
      groups: profiles.filter(p => p.category === 'group'),
      individuals: profiles.filter(p => p.category === 'contact'),
    };
  } catch (error) {
    return { platform: 'whatsapp', count: 0, contacts: [], error: error.message };
  }
}

/**
 * Extract contacts from LinkedIn (connections, pending requests, etc)
 */
export async function extractLinkedInContacts(page, options = {}) {
  const { includeConnections = true, includePending = true, includeSuggestions = false } = options;
  
  const results = {
    platform: 'linkedin',
    connections: [],
    pendingRequests: [],
    suggestions: [],
    totalCount: 0,
  };
  
  try {
    // Extract 1st degree connections
    if (includeConnections) {
      await page.goto('https://www.linkedin.com/mynetwork/invite-connect/connections/');
      await page.waitForTimeout(3000);
      
      const connections = await page.evaluate(() => {
        const cards = document.querySelectorAll('.mn-connection-card, .artdeco-entity-lockup');
        return Array.from(cards).map(card => {
          const name = card.querySelector('.mn-connection-card__name, .artdeco-entity-lockup__title')?.textContent?.trim() || '';
          const title = card.querySelector('.mn-connection-card__occupation, .artdeco-entity-lockup__subtitle')?.textContent?.trim() || '';
          const link = card.querySelector('a')?.href || '';
          const img = card.querySelector('img')?.src || '';
          
          return { name, title, link, img };
        }).filter(c => c.name);
      });
      
      results.connections = connections.map(c => new ContactProfile({
        platform: 'linkedin',
        username: c.link.split('/in/')[1]?.split('/')[0] || c.name,
        displayName: c.name,
        title: c.title,
        profileUrl: c.link,
        avatarUrl: c.img,
        category: 'connection',
        relationship: 'connected',
        potentialUse: 'network',
      }));
    }
    
    // Extract pending connection requests
    if (includePending) {
      await page.goto('https://www.linkedin.com/mynetwork/invite-connect/connections/');
      await page.waitForTimeout(2000);
      
      const pending = await page.evaluate(() => {
        // Look for pending invitation indicators
        const pendingCards = document.querySelectorAll('[data-control-name="pending_invitation"], .invitation-card');
        return Array.from(pendingCards).map(card => {
          const name = card.querySelector('.invitation-card__title')?.textContent?.trim() || '';
          const link = card.querySelector('a')?.href || '';
          return { name, link };
        }).filter(c => c.name);
      });
      
      results.pendingRequests = pending.map(c => new ContactProfile({
        platform: 'linkedin',
        username: c.link.split('/in/')[1]?.split('/')[0] || c.name,
        displayName: c.name,
        category: 'pending_request',
        relationship: 'pending',
        potentialUse: 'prospect',
      }));
    }
    
    results.totalCount = results.connections.length + results.pendingRequests.length;
    return results;
  } catch (error) {
    return { ...results, error: error.message };
  }
}

/**
 * Extract Instagram contacts (followers, following, pending requests)
 */
export async function extractInstagramContacts(page, options = {}) {
  const { includeFollowers = true, includeFollowing = true, includePending = true } = options;
  
  const results = {
    platform: 'instagram',
    followers: [],
    following: [],
    pendingRequests: [],
    totalCount: 0,
  };
  
  try {
    // Helper to scroll and extract users
    const extractUsersFromList = async (url) => {
      await page.goto(url);
      await page.waitForTimeout(3000);
      
      // Scroll to load more
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"] ._aano, [role="dialog"] div[style*="overflow"]');
          if (dialog) dialog.scrollTop = dialog.scrollHeight;
        });
        await page.waitForTimeout(1500);
      }
      
      return await page.evaluate(() => {
        const users = [];
        const items = document.querySelectorAll('[role="dialog"] [data-testid="user-list-item"], [role="dialog"] ._aarf + div a, [role="dialog"] a[role="link"]');
        
        items.forEach(item => {
          const username = item.textContent?.trim() || item.getAttribute('href')?.replace('/', '');
          const link = item.href || `https://instagram.com/${username}`;
          if (username && username.length > 1 && !username.includes(' ')) {
            users.push({ username, link });
          }
        });
        
        return [...new Map(users.map(u => [u.username, u])).values()];
      });
    };
    
    // Get followers
    if (includeFollowers) {
      const followers = await extractUsersFromList('https://www.instagram.com/direct/inbox/');
      results.followers = followers.map(u => new ContactProfile({
        platform: 'instagram',
        username: u.username,
        displayName: u.username,
        profileUrl: u.link,
        category: 'follower',
        relationship: 'follower',
        potentialUse: 'audience',
      }));
    }
    
    // Get pending follow requests (if any)
    if (includePending) {
      await page.goto('https://www.instagram.com/accounts/activity/?followRequests=1');
      await page.waitForTimeout(3000);
      
      const pending = await page.evaluate(() => {
        const requests = [];
        const cards = document.querySelectorAll('[data-testid="follow-request-item"], div[role="button"]');
        cards.forEach(card => {
          const username = card.querySelector('a')?.textContent?.trim();
          if (username) requests.push({ username });
        });
        return requests;
      });
      
      results.pendingRequests = pending.map(u => new ContactProfile({
        platform: 'instagram',
        username: u.username,
        displayName: u.username,
        category: 'pending_follow_request',
        relationship: 'pending',
        potentialUse: 'follower_candidate',
      }));
    }
    
    results.totalCount = results.followers.length + results.following.length + results.pendingRequests.length;
    return results;
  } catch (error) {
    return { ...results, error: error.message };
  }
}

/**
 * Extract X/Twitter contacts from visible messages, profile, followers/following, or search results.
 */
export async function extractTwitterContacts(page, options = {}) {
  const { limit = 80, includeConversations = true, username = '' } = options;
  const results = {
    platform: 'twitter',
    contacts: [],
    profiles: [],
    conversations: [],
    totalCount: 0,
  };

  try {
    const visibleContacts = await page.evaluate((maxContacts) => {
      const contacts = [];
      const seen = new Set();
      const add = (data) => {
        const username = String(data.username || '').replace(/^@/, '').trim();
        const displayName = String(data.displayName || username || '').trim();
        const key = username || displayName;
        if (!key || seen.has(key.toLowerCase())) return;
        seen.add(key.toLowerCase());
        contacts.push({ ...data, username, displayName });
      };

      document.querySelectorAll('[data-testid="conversation"], [data-testid="cellInnerDiv"], article[data-testid="tweet"]').forEach((el) => {
        if (contacts.length >= maxContacts) return;
        const link = Array.from(el.querySelectorAll('a[href^="/"]')).find((anchor) => /^\/[^/]+$/.test(anchor.getAttribute('href') || ''));
        const username = link?.getAttribute('href')?.replace('/', '') || '';
        const name = el.querySelector('[data-testid="User-Name"] span, [data-testid="UserName"] span, span[dir="ltr"]')?.textContent?.trim() || username;
        const bio = el.querySelector('[data-testid="tweetText"], div[dir="auto"]')?.textContent?.trim() || '';
        if (username || name) {
          add({
            username,
            displayName: name,
            bio: bio.slice(0, 280),
            profileUrl: link ? new URL(link.getAttribute('href'), location.origin).href : '',
          });
        }
      });

      const profileName = document.querySelector('[data-testid="UserName"] span, h1')?.textContent?.trim() || '';
      const profileHandle = location.pathname.split('/').filter(Boolean)[0] || '';
      if (profileName || profileHandle) {
        add({
          username: profileHandle,
          displayName: profileName || profileHandle,
          bio: document.querySelector('[data-testid="UserDescription"]')?.textContent?.trim() || '',
          profileUrl: location.href,
        });
      }

      return contacts.slice(0, maxContacts);
    }, limit);

    const contacts = visibleContacts.map((contact) => new ContactProfile({
      platform: 'twitter',
      username: contact.username,
      displayName: contact.displayName,
      bio: contact.bio,
      profileUrl: contact.profileUrl,
      category: 'profile',
      relationship: 'visible',
      potentialUse: contact.bio ? 'lead' : 'unknown',
    }));

    if (includeConversations) {
      await attachCurrentConversation(page, 'twitter', contacts, username);
    }

    results.contacts = contacts;
    results.profiles = contacts;
    results.conversations = contacts.filter((contact) => contact.messageCount > 0);
    results.totalCount = contacts.length;
    return results;
  } catch (error) {
    return { ...results, error: error.message };
  }
}

/**
 * Extract Facebook contacts from visible messages, profile surfaces, groups, or people search.
 */
export async function extractFacebookContacts(page, options = {}) {
  const { limit = 80, includeConversations = true, username = '' } = options;
  const results = {
    platform: 'facebook',
    contacts: [],
    profiles: [],
    conversations: [],
    totalCount: 0,
  };

  try {
    const visibleContacts = await page.evaluate((maxContacts) => {
      const contacts = [];
      const seen = new Set();
      const add = (data) => {
        const displayName = String(data.displayName || '').trim();
        const username = String(data.username || displayName).trim();
        const key = username || displayName;
        if (!key || seen.has(key.toLowerCase())) return;
        seen.add(key.toLowerCase());
        contacts.push({ ...data, username, displayName });
      };

      document.querySelectorAll('[role="main"] a[href*="/profile.php"], [role="main"] a[href*="facebook.com/"], [aria-label="Chats"] a, [role="gridcell"] a').forEach((link) => {
        if (contacts.length >= maxContacts) return;
        const text = link.textContent?.trim() || link.getAttribute('aria-label') || '';
        const href = link.href || '';
        if (!text || text.length < 2 || /^(home|watch|marketplace|groups|menu)$/i.test(text)) return;
        add({
          username: href.split('facebook.com/')[1]?.split(/[/?#]/)[0] || text,
          displayName: text,
          profileUrl: href,
        });
      });

      const profileName = document.querySelector('h1, [data-testid="profile_name"]')?.textContent?.trim() || '';
      if (profileName) {
        add({
          username: location.pathname.split('/').filter(Boolean)[0] || profileName,
          displayName: profileName,
          bio: Array.from(document.querySelectorAll('[role="main"] span')).map((el) => el.textContent?.trim()).find((text) => text && text.length > 30) || '',
          profileUrl: location.href,
        });
      }

      return contacts.slice(0, maxContacts);
    }, limit);

    const contacts = visibleContacts.map((contact) => new ContactProfile({
      platform: 'facebook',
      username: contact.username,
      displayName: contact.displayName,
      bio: contact.bio || '',
      profileUrl: contact.profileUrl,
      category: 'profile',
      relationship: 'visible',
      potentialUse: contact.bio ? 'lead' : 'network',
    }));

    if (includeConversations) {
      await attachCurrentConversation(page, 'facebook', contacts, username);
    }

    results.contacts = contacts;
    results.profiles = contacts;
    results.conversations = contacts.filter((contact) => contact.messageCount > 0);
    results.totalCount = contacts.length;
    return results;
  } catch (error) {
    return { ...results, error: error.message };
  }
}

/**
 * Extract Gmail contacts from visible inbox/thread rows and current conversation.
 */
export async function extractGmailContacts(page, options = {}) {
  const { limit = 80, includeConversations = true, username = '' } = options;
  const results = {
    platform: 'gmail',
    contacts: [],
    conversations: [],
    totalCount: 0,
  };

  try {
    const visibleContacts = await page.evaluate((maxContacts) => {
      const contacts = [];
      const seen = new Set();
      const add = (data) => {
        const email = String(data.email || '').trim();
        const displayName = String(data.displayName || email || '').trim();
        const key = email || displayName;
        if (!key || seen.has(key.toLowerCase())) return;
        seen.add(key.toLowerCase());
        contacts.push({ ...data, email, displayName });
      };

      document.querySelectorAll('tr[role="row"], .h7, .adn').forEach((row) => {
        if (contacts.length >= maxContacts) return;
        const emailEl = row.querySelector('[email], [data-hovercard-id]');
        const email = emailEl?.getAttribute('email') || emailEl?.getAttribute('data-hovercard-id') || '';
        const name = emailEl?.getAttribute('name') || emailEl?.textContent?.trim() || row.querySelector('.yW span, .gD')?.textContent?.trim() || '';
        const subject = row.querySelector('.bog, .ha h2')?.textContent?.trim() || '';
        if (email || name) add({ email, displayName: name || email, bio: subject });
      });

      return contacts.slice(0, maxContacts);
    }, limit);

    const contacts = visibleContacts.map((contact) => new ContactProfile({
      platform: 'gmail',
      username: contact.email || contact.displayName,
      displayName: contact.displayName,
      bio: contact.bio || '',
      category: 'email_contact',
      relationship: 'contact',
      potentialUse: contact.bio ? 'customer' : 'unknown',
    }));

    if (includeConversations) {
      await attachCurrentConversation(page, 'gmail', contacts, username);
    }

    results.contacts = contacts;
    results.conversations = contacts.filter((contact) => contact.messageCount > 0);
    results.totalCount = contacts.length;
    return results;
  } catch (error) {
    return { ...results, error: error.message };
  }
}

/**
 * Generic visible-profile fallback for platforms that expose profile-like pages.
 */
export async function extractGenericSocialContacts(page, platform, options = {}) {
  const { limit = 50, includeConversations = true, username = '' } = options;
  const results = { platform, contacts: [], profiles: [], conversations: [], totalCount: 0 };

  try {
    const profileInfo = await extractProfileContext(page, platform, username).catch(() => null);
    const visibleContacts = await page.evaluate((maxContacts) => {
      const contacts = [];
      const seen = new Set();
      const add = (data) => {
        const displayName = String(data.displayName || '').trim();
        const username = String(data.username || displayName).replace(/^@/, '').trim();
        const key = username || displayName;
        if (!key || seen.has(key.toLowerCase())) return;
        seen.add(key.toLowerCase());
        contacts.push({ ...data, username, displayName });
      };

      document.querySelectorAll('a[href], [role="article"], [role="listitem"]').forEach((el) => {
        if (contacts.length >= maxContacts) return;
        const link = el.matches?.('a[href]') ? el : el.querySelector?.('a[href]');
        const href = link?.href || '';
        const text = (link?.textContent || el.textContent || '').trim().replace(/\s+/g, ' ');
        if (text && text.length > 2 && text.length < 90) {
          add({ displayName: text, username: href.split('/').filter(Boolean).pop() || text, profileUrl: href });
        }
      });
      return contacts.slice(0, maxContacts);
    }, limit);

    const contacts = visibleContacts.map((contact) => new ContactProfile({
      platform,
      username: contact.username,
      displayName: contact.displayName,
      profileUrl: contact.profileUrl,
      category: 'visible_profile',
      relationship: 'visible',
      potentialUse: 'unknown',
    }));

    if (profileInfo && !profileInfo.error && Object.values(profileInfo).some(Boolean)) {
      contacts.unshift(new ContactProfile({
        platform,
        username: profileInfo.username || username || 'current_profile',
        displayName: profileInfo.name || profileInfo.username || username || 'Current profile',
        bio: profileInfo.bio || profileInfo.headline || '',
        company: profileInfo.company || '',
        title: profileInfo.jobTitle || '',
        location: profileInfo.location || '',
        category: 'profile',
        relationship: 'visible',
        potentialUse: profileInfo.bio || profileInfo.headline ? 'lead' : 'unknown',
      }));
    }

    if (includeConversations) {
      await attachCurrentConversation(page, platform, contacts, username);
    }

    results.contacts = contacts;
    results.profiles = contacts;
    results.conversations = contacts.filter((contact) => contact.messageCount > 0);
    results.totalCount = contacts.length;
    return results;
  } catch (error) {
    return { ...results, error: error.message };
  }
}

/**
 * Analyze conversation context to understand relationship and intent
 */
export async function analyzeContactIntelligence(page, platform, username, chatContext = []) {
  const profile = new ContactProfile({
    platform,
    username,
  });
  
  // Add conversation if available
  if (chatContext.length > 0) {
    profile.addConversation(chatContext);
    
    // Simple sentiment analysis
    const lastMessages = chatContext.slice(-3).map(m => m.text?.toLowerCase() || '');
    const positiveWords = ['thanks', 'great', 'awesome', 'love', 'good', 'yes', 'interested', 'amazing'];
    const negativeWords = ['no', 'not', 'bad', 'hate', 'disappointed', 'problem', 'issue'];
    
    const positive = lastMessages.filter(m => positiveWords.some(w => m.includes(w))).length;
    const negative = lastMessages.filter(m => negativeWords.some(w => m.includes(w))).length;
    
    if (positive > negative) profile.sentiment = 'positive';
    else if (negative > positive) profile.sentiment = 'negative';
    else profile.sentiment = 'neutral';
    
    // Detect intent from messages
    const intentKeywords = {
      lead: ['interested', 'pricing', 'cost', 'buy', 'purchase', 'quote', 'demo'],
      partner: ['collaborate', 'partner', 'joint', 'together', 'venture'],
      candidate: ['job', 'hire', 'position', 'role', 'opportunity', 'career'],
      customer: ['order', 'product', 'service', 'support', 'help'],
    };
    
    const allText = lastMessages.join(' ');
    for (const [intent, keywords] of Object.entries(intentKeywords)) {
      if (keywords.some(k => allText.includes(k))) {
        profile.potentialUse = intent;
        break;
      }
    }
  }
  
  return profile;
}

/**
 * Master function to map all contacts from all platforms
 */
export async function mapAllContacts(attachedBrowser, options = {}) {
  const {
    platforms = ['whatsapp', 'linkedin', 'instagram', 'twitter', 'facebook', 'gmail'],
    includeConversations = true,
    analyzeIntelligence = true,
  } = options;
  
  const results = {
    timestamp: Date.now(),
    platforms: {},
    totalContacts: 0,
    categorized: {
      leads: [],
      partners: [],
      candidates: [],
      customers: [],
      network: [],
      audience: [],
      unknown: [],
    },
  };
  
  for (const platform of platforms) {
    try {
      const platformUrl = PLATFORM_HOME_URLS[platform] || PLATFORM_HOME_URLS.instagram;
      let page = await attachedBrowser.findPage(p => {
        const url = p.url();
        if (platform === 'twitter') return url.includes('twitter.com') || url.includes('x.com');
        if (platform === 'gmail') return url.includes('mail.google.com');
        return url.includes(platform);
      });
      if (!page) {
        page = await attachedBrowser.getOrCreatePage({
          url: platformUrl,
        });
      }
      
      let contacts = [];
      
      switch (platform) {
        case 'whatsapp':
          contacts = await extractWhatsAppContacts(page, options);
          break;
        case 'linkedin':
          contacts = await extractLinkedInContacts(page, options);
          break;
        case 'instagram':
          contacts = await extractInstagramContacts(page, options);
          break;
        case 'twitter':
          contacts = await extractTwitterContacts(page, { ...options, includeConversations });
          break;
        case 'facebook':
          contacts = await extractFacebookContacts(page, { ...options, includeConversations });
          break;
        case 'gmail':
          contacts = await extractGmailContacts(page, { ...options, includeConversations });
          break;
        default:
          contacts = await extractGenericSocialContacts(page, platform, { ...options, includeConversations });
          break;
      }
      
      results.platforms[platform] = contacts;
      
      // Categorize all contacts
      const allContacts = collectContacts(contacts);

      if (analyzeIntelligence && includeConversations) {
        for (const contact of allContacts) {
          if (contact.conversations?.length) continue;
          const chatContext = await extractChatContext(page, platform, 8).catch(() => []);
          if (chatContext.length) {
            const intelligence = await analyzeContactIntelligence(page, platform, contact.username, chatContext);
            contact.sentiment = intelligence.sentiment || contact.sentiment;
            contact.potentialUse = intelligence.potentialUse || contact.potentialUse;
            contact.addConversation?.(chatContext);
          }
        }
      }
      
      mergeCategorized(results.categorized, categorizeContacts(allContacts));
      
      results.totalContacts += allContacts.length;
    } catch (error) {
      results.platforms[platform] = { error: error.message };
    }
  }
  
  return results;
}

/**
 * Export contact data for dashboard
 */
export function exportForDashboard(contactMap) {
  const categorized = contactMap.categorized || {};
  const categoryCounts = Object.fromEntries(
    Object.keys(DEFAULT_CATEGORIES).map((name) => [name, categorized[name]?.length || 0])
  );
  const allContacts = Object.values(categorized).flat();

  return {
    summary: {
      totalContacts: contactMap.totalContacts || allContacts.length,
      totalPlatforms: Object.keys(contactMap.platforms || {}).length,
      lastUpdated: contactMap.timestamp || Date.now(),
    },
    categories: categoryCounts,
    categoryDetails: Object.entries(categorized).map(([name, contacts]) => ({
      name,
      count: contacts.length,
      contacts: contacts.map(c => ({
        id: c.id,
        platform: c.platform,
        name: c.displayName,
        username: c.username,
        category: c.category,
        relationship: c.relationship,
        potentialUse: c.potentialUse,
        sentiment: c.sentiment,
        lastMessageAt: c.lastMessageAt,
        profileUrl: c.profileUrl,
      })),
    })),
    platforms: Object.entries(contactMap.platforms || {}).map(([platform, data]) => ({
      name: platform,
      total: data.count || data.totalCount || collectContacts(data).length || 0,
      connections: data.connections?.length || data.followers?.length || data.contacts?.length || data.profiles?.length || 0,
      pending: data.pendingRequests?.length || 0,
      error: data.error || null,
    })),
    recentActivity: allContacts
      .filter((contact) => contact.lastMessageAt)
      .sort((left, right) => right.lastMessageAt - left.lastMessageAt)
      .slice(0, 20)
      .map((contact) => ({
        id: contact.id,
        name: contact.displayName || contact.username,
        platform: contact.platform,
        category: contact.category,
        potentialUse: contact.potentialUse,
        lastMessage: contact.conversations?.[0]?.summary || '',
        lastMessageAt: contact.lastMessageAt,
      })),
    sentiment: {
      positive: allContacts.filter((contact) => contact.sentiment === 'positive').length,
      neutral: allContacts.filter((contact) => contact.sentiment === 'neutral').length,
      negative: allContacts.filter((contact) => contact.sentiment === 'negative').length,
    },
    raw: contactMap,
  };
}

export default {
  ContactProfile,
  extractWhatsAppContacts,
  extractLinkedInContacts,
  extractInstagramContacts,
  extractTwitterContacts,
  extractFacebookContacts,
  extractGmailContacts,
  extractGenericSocialContacts,
  analyzeContactIntelligence,
  mapAllContacts,
  exportForDashboard,
};
