// Contact Mapping System - Extract and analyze contacts across all platforms
// Maps conversations, categorizes contacts, and builds intelligence for dashboard

import { extractChatContext } from './chat-context.js';

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
    platforms = ['whatsapp', 'linkedin', 'instagram'],
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
      let page = await attachedBrowser.findPage(p => p.url().includes(platform));
      if (!page) {
        page = await attachedBrowser.getOrCreatePage({
          url: platform === 'whatsapp' ? 'https://web.whatsapp.com' :
               platform === 'linkedin' ? 'https://linkedin.com' :
               'https://instagram.com',
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
      }
      
      results.platforms[platform] = contacts;
      
      // Categorize all contacts
      const allContacts = contacts.contacts || 
                         [...(contacts.connections || []), ...(contacts.followers || [])];
      
      allContacts.forEach(contact => {
        const category = contact.potentialUse || 'unknown';
        if (results.categorized[category]) {
          results.categorized[category].push(contact);
        } else {
          results.categorized.unknown.push(contact);
        }
      });
      
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
  return {
    summary: {
      totalContacts: contactMap.totalContacts,
      totalPlatforms: Object.keys(contactMap.platforms).length,
      lastUpdated: contactMap.timestamp,
    },
    categories: Object.entries(contactMap.categorized).map(([name, contacts]) => ({
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
    raw: contactMap,
  };
}

export default {
  ContactProfile,
  extractWhatsAppContacts,
  extractLinkedInContacts,
  extractInstagramContacts,
  analyzeContactIntelligence,
  mapAllContacts,
  exportForDashboard,
};
