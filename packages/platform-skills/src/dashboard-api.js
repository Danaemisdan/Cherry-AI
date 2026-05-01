// Dashboard API - REST endpoints for contact metrics and intelligence
// Provides data for the dashboard to display contact maps, analytics, and insights

import { mapAllContacts, exportForDashboard, analyzeContactIntelligence } from './contact-mapper.js';

/**
 * Dashboard data store - holds cached contact data
 */
class DashboardDataStore {
  constructor() {
    this.cache = new Map();
    this.lastUpdated = null;
  }

  set(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
    this.lastUpdated = Date.now();
  }

  get(key, maxAge = 5 * 60 * 1000) { // 5 minute default cache
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    const age = Date.now() - entry.timestamp;
    if (age > maxAge) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  clear() {
    this.cache.clear();
    this.lastUpdated = null;
  }

  getAll() {
    const result = {};
    for (const [key, entry] of this.cache) {
      result[key] = entry.data;
    }
    return result;
  }
}

const dataStore = new DashboardDataStore();

/**
 * Get contact metrics summary for dashboard
 */
export async function getContactMetrics(attachedBrowser, options = {}) {
  const cacheKey = 'contact_metrics';
  const cached = dataStore.get(cacheKey, options.refresh ? 0 : 10 * 60 * 1000);
  
  if (cached && !options.refresh) {
    return cached;
  }

  try {
    const contactMap = await mapAllContacts(attachedBrowser, {
      platforms: options.platforms || ['whatsapp', 'linkedin', 'instagram', 'twitter', 'facebook'],
      includeConversations: true,
      analyzeIntelligence: true,
    });

    const metrics = {
      summary: {
        totalContacts: contactMap.totalContacts,
        totalPlatforms: Object.keys(contactMap.platforms).length,
        lastUpdated: contactMap.timestamp,
      },
      
      // Categorization breakdown
      categories: {
        leads: contactMap.categorized.leads?.length || 0,
        partners: contactMap.categorized.partners?.length || 0,
        candidates: contactMap.categorized.candidates?.length || 0,
        customers: contactMap.categorized.customers?.length || 0,
        network: contactMap.categorized.network?.length || 0,
        audience: contactMap.categorized.audience?.length || 0,
        unknown: contactMap.categorized.unknown?.length || 0,
      },
      
      // Platform breakdown
      platforms: Object.entries(contactMap.platforms).map(([platform, data]) => ({
        name: platform,
        total: data.count || data.totalCount || 0,
        connections: data.connections?.length || data.followers?.length || data.contacts?.length || 0,
        pending: data.pendingRequests?.length || 0,
        error: data.error || null,
      })),
      
      // Recent activity (contacts with recent messages)
      recentActivity: Object.values(contactMap.categorized)
        .flat()
        .filter(c => c.lastMessageAt && Date.now() - c.lastMessageAt < 7 * 24 * 60 * 60 * 1000) // 7 days
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
        .slice(0, 20)
        .map(c => ({
          id: c.id,
          name: c.displayName,
          platform: c.platform,
          category: c.category,
          potentialUse: c.potentialUse,
          lastMessage: c.conversations[0]?.summary || '',
          lastMessageAt: c.lastMessageAt,
        })),
      
      // Sentiment analysis
      sentiment: {
        positive: Object.values(contactMap.categorized).flat().filter(c => c.sentiment === 'positive').length,
        neutral: Object.values(contactMap.categorized).flat().filter(c => c.sentiment === 'neutral').length,
        negative: Object.values(contactMap.categorized).flat().filter(c => c.sentiment === 'negative').length,
      },
    };

    dataStore.set(cacheKey, metrics);
    return metrics;
  } catch (error) {
    return {
      error: error.message,
      summary: { totalContacts: 0, totalPlatforms: 0 },
      categories: {},
      platforms: [],
    };
  }
}

/**
 * Get detailed contact list with filtering
 */
export async function getContacts(attachedBrowser, filters = {}) {
  const {
    platform,
    category,
    potentialUse,
    relationship,
    sentiment,
    limit = 50,
    offset = 0,
    search,
  } = filters;

  try {
    const contactMap = await mapAllContacts(attachedBrowser, {
      platforms: platform ? [platform] : ['whatsapp', 'linkedin', 'instagram', 'twitter', 'facebook'],
    });

    let allContacts = Object.values(contactMap.categorized).flat();

    // Apply filters
    if (category) {
      allContacts = allContacts.filter(c => c.category === category);
    }
    if (potentialUse) {
      allContacts = allContacts.filter(c => c.potentialUse === potentialUse);
    }
    if (relationship) {
      allContacts = allContacts.filter(c => c.relationship === relationship);
    }
    if (sentiment) {
      allContacts = allContacts.filter(c => c.sentiment === sentiment);
    }
    if (search) {
      const searchLower = search.toLowerCase();
      allContacts = allContacts.filter(c => 
        c.displayName?.toLowerCase().includes(searchLower) ||
        c.username?.toLowerCase().includes(searchLower) ||
        c.bio?.toLowerCase().includes(searchLower)
      );
    }

    // Sort by last activity
    allContacts.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));

    const total = allContacts.length;
    const paginated = allContacts.slice(offset, offset + limit);

    return {
      contacts: paginated.map(c => ({
        id: c.id,
        platform: c.platform,
        username: c.username,
        displayName: c.displayName,
        avatarUrl: c.avatarUrl,
        bio: c.bio,
        title: c.title,
        company: c.company,
        category: c.category,
        relationship: c.relationship,
        potentialUse: c.potentialUse,
        sentiment: c.sentiment,
        isPrivate: c.isPrivate,
        isBusiness: c.isBusiness,
        messageCount: c.messageCount,
        lastMessageAt: c.lastMessageAt,
        profileUrl: c.profileUrl,
        tags: c.tags,
        notes: c.notes,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    };
  } catch (error) {
    return { error: error.message, contacts: [], pagination: { total: 0 } };
  }
}

/**
 * Get single contact details with conversation history
 */
export async function getContactDetails(attachedBrowser, platform, username) {
  try {
    // Find existing page
    let page = await attachedBrowser.findPage(p => p.url().includes(platform));
    if (!page) {
      return { error: `No active ${platform} session found` };
    }

    // Extract chat context
    const chatContext = await extractChatContext(page, platform, 20);
    
    // Analyze intelligence
    const profile = await analyzeContactIntelligence(page, platform, username, chatContext);

    return {
      contact: {
        id: profile.id,
        platform: profile.platform,
        username: profile.username,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        bio: profile.bio,
        title: profile.title,
        company: profile.company,
        category: profile.category,
        relationship: profile.relationship,
        potentialUse: profile.potentialUse,
        sentiment: profile.sentiment,
        isPrivate: profile.isPrivate,
        isBusiness: profile.isBusiness,
        tags: profile.tags,
        notes: profile.notes,
        profileUrl: profile.profileUrl,
        firstSeenAt: profile.firstSeenAt,
        lastUpdatedAt: profile.lastUpdatedAt,
      },
      conversations: profile.conversations,
      recentMessages: chatContext.slice(-10),
      messageCount: profile.messageCount,
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Update contact metadata (tags, notes, potentialUse)
 */
export async function updateContact(contactId, updates) {
  // This would typically save to a database
  // For now, we store in memory cache
  const existing = dataStore.get(`contact_${contactId}`);
  if (!existing) {
    return { error: 'Contact not found' };
  }

  const updated = {
    ...existing,
    ...updates,
    lastUpdatedAt: Date.now(),
  };

  dataStore.set(`contact_${contactId}`, updated);
  return { success: true, contact: updated };
}

/**
 * Get analytics insights
 */
export async function getAnalytics(attachedBrowser, options = {}) {
  const { days = 30 } = options;
  const since = Date.now() - (days * 24 * 60 * 60 * 1000);

  try {
    const metrics = await getContactMetrics(attachedBrowser, options);
    
    return {
      overview: metrics,
      insights: {
        // Growth rate calculation would need historical data
        newContactsThisWeek: metrics.recentActivity?.length || 0,
        activeConversations: Object.values(metrics.categories).reduce((a, b) => a + b, 0),
        
        // Platform distribution
        platformDistribution: metrics.platforms.map(p => ({
          name: p.name,
          percentage: metrics.summary.totalContacts > 0 
            ? Math.round((p.total / metrics.summary.totalContacts) * 100) 
            : 0,
        })),
        
        // Category distribution
        categoryDistribution: Object.entries(metrics.categories).map(([name, count]) => ({
          name,
          count,
          percentage: metrics.summary.totalContacts > 0 
            ? Math.round((count / metrics.summary.totalContacts) * 100)
            : 0,
        })),
      },
      recommendations: generateRecommendations(metrics),
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Generate AI recommendations based on metrics
 */
function generateRecommendations(metrics) {
  const recommendations = [];

  if (metrics.categories.leads > 0 && metrics.categories.leads < 10) {
    recommendations.push({
      type: 'action',
      priority: 'high',
      message: `You have ${metrics.categories.leads} leads. Consider reaching out to follow up.`,
      action: 'view_leads',
    });
  }

  if (metrics.sentiment.negative > metrics.sentiment.positive) {
    recommendations.push({
      type: 'warning',
      priority: 'medium',
      message: 'Negative sentiment is higher than positive. Review recent conversations.',
      action: 'review_sentiment',
    });
  }

  const inactivePlatforms = metrics.platforms.filter(p => p.total === 0);
  if (inactivePlatforms.length > 0) {
    recommendations.push({
      type: 'tip',
      priority: 'low',
      message: `Connect ${inactivePlatforms.map(p => p.name).join(', ')} to expand your network.`,
      action: 'connect_platforms',
    });
  }

  return recommendations;
}

/**
 * Dashboard API handler - integrates with main skill system
 */
export function createDashboardHandler() {
  return {
    async execute({ step, attachedBrowser }) {
      const { action, args = {} } = step;

      switch (action) {
        case 'get_metrics':
          return {
            status: 'completed',
            data: await getContactMetrics(attachedBrowser, args),
          };

        case 'get_contacts':
          return {
            status: 'completed',
            data: await getContacts(attachedBrowser, args),
          };

        case 'get_contact_details':
          const { platform, username } = args;
          return {
            status: 'completed',
            data: await getContactDetails(attachedBrowser, platform, username),
          };

        case 'update_contact':
          const { contactId, updates } = args;
          return {
            status: 'completed',
            data: await updateContact(contactId, updates),
          };

        case 'get_analytics':
          return {
            status: 'completed',
            data: await getAnalytics(attachedBrowser, args),
          };

        case 'refresh_data':
          dataStore.clear();
          return {
            status: 'completed',
            data: await getContactMetrics(attachedBrowser, { refresh: true }),
          };

        default:
          return { status: 'failed', error: `Unknown dashboard action: ${action}` };
      }
    },
  };
}

export default {
  getContactMetrics,
  getContacts,
  getContactDetails,
  updateContact,
  getAnalytics,
  createDashboardHandler,
  dataStore,
};
