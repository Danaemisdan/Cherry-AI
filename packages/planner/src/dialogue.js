import { planTask } from './index.js';

// Strategy definitions - what the agent CAN do
const STRATEGIES = {
  sales: {
    id: 'sales',
    name: 'Sales Growth Strategy',
    description: 'Generate leads, reach out, and book meetings',
    actions: ['find_leads', 'scrape_profiles', 'send_message', 'message_batch', 'run_campaign'],
    platforms: ['instagram', 'linkedin', 'twitter', 'facebook', 'gmail', 'whatsapp'],
  },
  marketing: {
    id: 'marketing',
    name: 'Brand Marketing Strategy',
    description: 'Increase visibility, engagement, and followers',
    actions: ['engage_post', 'follow_user', 'auto_post', 'like_ai_comment'],
    platforms: ['instagram', 'linkedin', 'twitter', 'facebook'],
  },
  research: {
    id: 'research',
    name: 'Market Research Strategy',
    description: 'Gather intelligence on competitors and trends',
    actions: ['scrape_profiles', 'extract_context', 'search', 'scrape_results'],
    platforms: ['research', 'instagram', 'linkedin', 'twitter'],
  },
  monitor: {
    id: 'monitor',
    name: 'Social Monitoring Strategy',
    description: 'Watch messages, mentions, and respond automatically',
    actions: ['review_queue', 'continue_outreach'],
    platforms: ['instagram', 'linkedin', 'twitter', 'facebook', 'gmail', 'whatsapp'],
  },
  viral: {
    id: 'viral',
    name: 'Viral Growth Strategy',
    description: 'Post content, engage with trends, maximize reach',
    actions: ['auto_post', 'engage_post', 'follow_user', 'like_ai_comment'],
    platforms: ['instagram', 'linkedin', 'twitter', 'facebook'],
  },
};

// Intent patterns - what the user SAYS
const INTENT_PATTERNS = [
  {
    keywords: /sales|sell|revenue|customers|clients|booking|meetings?|demo/i,
    strategies: ['sales', 'marketing'],
    suggestedGoals: ['Book a meeting', 'Get a demo', 'Close a sale'],
  },
  {
    keywords: /brand|awareness|visibility|followers|growth|influence/i,
    strategies: ['marketing', 'viral'],
    suggestedGoals: ['Increase brand awareness', 'Gain followers', 'Build authority'],
  },
  {
    keywords: /research|competitor|market|trends|intel|information/i,
    strategies: ['research'],
    suggestedGoals: ['Analyze competitors', 'Find market trends', 'Gather intelligence'],
  },
  {
    keywords: /monitor|auto.?reply|respond|inbox|messages?|dm/i,
    strategies: ['monitor', 'sales'],
    suggestedGoals: ['Auto-respond to inquiries', 'Monitor all messages', 'Handle support'],
  },
  {
    keywords: /post|content|viral|engage|like|comment/i,
    strategies: ['viral', 'marketing'],
    suggestedGoals: ['Create viral content', 'Increase engagement', 'Post daily'],
  },
  {
    keywords: /outreach|message|dm|contact|reach.?out/i,
    strategies: ['sales', 'marketing'],
    suggestedGoals: ['Cold outreach', 'Warm follow-up', 'Network building'],
  },
  {
    keywords: /scrape|find|leads|prospects|list/i,
    strategies: ['sales', 'research'],
    suggestedGoals: ['Find leads', 'Build prospect list', 'Research targets'],
  },
];

// Dialogue states
export const DIALOGUE_STATE = {
  IDLE: 'idle',
  SELECTING_STRATEGY: 'selecting_strategy',
  SELECTING_PLATFORM: 'selecting_platform',
  SELECTING_ACTION: 'selecting_action',
  CONFIRMING_PARAMS: 'confirming_params',
  EXECUTING: 'executing',
};

export class DialogueEngine {
  constructor() {
    this.sessions = new Map();
  }

  getSession(userId) {
    if (!this.sessions.has(userId)) {
      this.sessions.set(userId, {
        state: DIALOGUE_STATE.IDLE,
        context: {},
        history: [],
      });
    }
    return this.sessions.get(userId);
  }

  parseIntent(text) {
    const lowerText = text.toLowerCase();
    const matchedIntents = INTENT_PATTERNS.filter(pattern =>
      pattern.keywords.test(lowerText)
    );

    if (matchedIntents.length === 0) {
      return null;
    }

    // Collect unique strategies
    const strategies = [...new Set(matchedIntents.flatMap(i => i.strategies))];
    const goals = [...new Set(matchedIntents.flatMap(i => i.suggestedGoals))];

    return { strategies, goals, originalText: text };
  }

  startDialogue(userId, text) {
    const session = this.getSession(userId);
    const intent = this.parseIntent(text);

    session.history.push({ role: 'user', text });

    if (!intent) {
      return {
        type: 'unknown_intent',
        message: "I'm not sure what you want to do. Here are things I can help with:",
        options: [
          { id: 'sales', label: '💰 Get more sales & customers', action: 'select_strategy', data: { strategy: 'sales' } },
          { id: 'marketing', label: '📢 Grow your brand & followers', action: 'select_strategy', data: { strategy: 'marketing' } },
          { id: 'research', label: '🔍 Research competitors & market', action: 'select_strategy', data: { strategy: 'research' } },
          { id: 'monitor', label: '👁️ Monitor & auto-respond to messages', action: 'select_strategy', data: { strategy: 'monitor' } },
          { id: 'viral', label: '🚀 Create viral content', action: 'select_strategy', data: { strategy: 'viral' } },
        ],
      };
    }

    session.context = { intent, selectedStrategies: intent.strategies };

    if (intent.strategies.length === 1) {
      // Single strategy - drill down to platform selection
      return this.selectStrategy(userId, intent.strategies[0]);
    }

    // Multiple strategies - let user choose
    session.state = DIALOGUE_STATE.SELECTING_STRATEGY;
    return {
      type: 'strategy_selection',
      message: `I can help you with ${intent.strategies.map(s => STRATEGIES[s].name).join(' or ')}. What would you like to focus on?`,
      options: intent.strategies.map(id => ({
        id,
        label: `${STRATEGIES[id].name}: ${STRATEGIES[id].description}`,
        action: 'select_strategy',
        data: { strategy: id },
      })),
    };
  }

  selectStrategy(userId, strategyId) {
    const session = this.getSession(userId);
    const strategy = STRATEGIES[strategyId];

    session.context.selectedStrategy = strategyId;
    session.state = DIALOGUE_STATE.SELECTING_PLATFORM;

    // Platform options
    return {
      type: 'platform_selection',
      message: `Great! ${strategy.name} selected. Which platforms should I work on?`,
      options: strategy.platforms.map(platform => ({
        id: platform,
        label: platform.charAt(0).toUpperCase() + platform.slice(1),
        action: 'select_platform',
        data: { platform, strategy: strategyId },
      })),
      multiSelect: true,
      continueAction: { label: 'Continue →', action: 'confirm_platforms' },
    };
  }

  confirmPlatforms(userId, selectedPlatforms) {
    const session = this.getSession(userId);
    session.context.selectedPlatforms = selectedPlatforms;
    session.state = DIALOGUE_STATE.SELECTING_ACTION;

    const strategy = STRATEGIES[session.context.selectedStrategy];

    // Show relevant actions
    return {
      type: 'action_selection',
      message: `Perfect! I'll work on ${selectedPlatforms.join(', ')}. What specific action should I take?`,
      options: strategy.actions.map(action => ({
        id: action,
        label: this.formatActionLabel(action),
        action: 'execute_action',
        data: { action, platforms: selectedPlatforms, strategy: session.context.selectedStrategy },
      })),
    };
  }

  formatActionLabel(action) {
    const labels = {
      find_leads: '🔍 Find leads',
      scrape_profiles: '📋 Scrape profiles',
      send_message: '💬 Send single message',
      message_batch: '📤 Bulk message',
      run_campaign: '🤖 Run always-on campaign',
      engage_post: '❤️ Like & comment on posts',
      follow_user: '➕ Follow users',
      auto_post: '📝 Auto-post content',
      like_ai_comment: '🤖 AI-powered engagement',
      review_queue: '📥 Review message queue',
      continue_outreach: '🔄 Continue outreach',
      extract_context: '📊 Extract data',
      search: '🔎 Search & analyze',
      scrape_results: '📈 Scrape search results',
    };
    return labels[action] || action;
  }

  executeAction(userId, actionData, params = {}) {
    const session = this.getSession(userId);
    session.state = DIALOGUE_STATE.EXECUTING;

    const { action, platforms, strategy } = actionData;

    // Build task prompts for each platform
    const tasks = platforms.map(platform => {
      const prompt = this.buildTaskPrompt(action, platform, params);
      return {
        platform,
        prompt,
        context: {
          operation: action,
          platform,
          strategy,
          ...params,
        },
      };
    });

    return {
      type: 'execution_plan',
      message: `I'll execute ${this.formatActionLabel(action)} on ${platforms.join(', ')}. Starting now...`,
      tasks,
    };
  }

  buildTaskPrompt(action, platform, params) {
    const { goal, query, username, count = 25 } = params;

    const templates = {
      find_leads: `Find ${count} leads on ${platform} for: ${query || goal}`,
      scrape_profiles: `Scrape ${count} profiles from ${platform} search: ${query || goal}`,
      send_message: `Send a message to ${username || 'the target'} on ${platform} about: ${goal}`,
      message_batch: `Send bulk messages to ${count} users on ${platform} about: ${goal}`,
      run_campaign: `Run an always-on campaign on ${platform} to ${goal}`,
      engage_post: `Engage with posts on ${platform} for: ${query || goal}`,
      follow_user: `Follow users on ${platform} related to: ${query || goal}`,
      auto_post: `Create and post content on ${platform} about: ${goal}`,
      like_ai_comment: `Like and comment on ${platform} posts about: ${query || goal}`,
      review_queue: `Review and respond to messages on ${platform}`,
      continue_outreach: `Continue outreach campaign on ${platform}`,
      extract_context: `Extract context from ${platform} about: ${query || goal}`,
      search: `Search ${platform} for: ${query || goal}`,
      scrape_results: `Scrape results from ${platform} for: ${query || goal}`,
    };

    return templates[action] || `${action} on ${platform}`;
  }

  handleChoice(userId, choice) {
    const { action, data } = choice;

    switch (action) {
      case 'select_strategy':
        return this.selectStrategy(userId, data.strategy);

      case 'select_platform':
        // Toggle platform selection (handled in frontend)
        return { type: 'platform_toggled', platform: data.platform };

      case 'confirm_platforms':
        // This comes from frontend with selected platforms
        return this.confirmPlatforms(userId, data.platforms);

      case 'execute_action':
        return this.executeAction(userId, data);

      default:
        return { type: 'error', message: 'Unknown action' };
    }
  }

  reset(userId) {
    this.sessions.delete(userId);
  }
}

export const dialogueEngine = new DialogueEngine();
