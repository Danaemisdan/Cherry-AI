/**
 * Cherry AI Chat — bridges /ai/chat to local LLM (port 11434)
 * Supports: multi-tool suggestions, image pipeline, continuous background tasks
 */

const LLM_URL = process.env.CHERRY_LLM_URL || 'http://localhost:11434';

// Per-user conversation sessions
const chatSessions = new Map();

function getSession(userId) {
  if (!chatSessions.has(userId)) {
    chatSessions.set(userId, { history: [], createdAt: Date.now() });
  }
  return chatSessions.get(userId);
}

// ── Tool → Task payload mapper ────────────────────────────────────────────────
function toolToTaskPayload(toolDef) {
  const { tool, params = {} } = toolDef;

  const platform   = params.platform || params.aiPlatform || params.socialPlatform || 'instagram';
  const target     = params.target || params.username || '';
  const goal       = params.goal || 'Get a meeting';
  const tone       = params.tone || 'Casual and brief';
  const query      = params.query || params.subject || '';
  const maxResults = Number(params.maxResults) || 15;
  const imagePath  = params.imagePath || params.attachmentPath || '';
  const instruction= params.instruction || goal;
  const aiPlatform = params.aiPlatform || 'chatgpt';
  const socialPlatform = params.socialPlatform || 'instagram';
  const cadence    = params.cadenceMinutes || null;

  const MAP = {
    // Outreach
    send_dm: {
      operation: platform === 'gmail' ? 'auto_dm' : 'auto_dm_contact',
      prompt: `Send a DM to ${target || 'the user'} on ${platform}. Goal: ${goal}. Tone: ${tone}.${imagePath ? ` Attach: ${imagePath}` : ''}`,
      extra: { username: target, attachmentPath: imagePath || undefined },
    },
    send_image_dm: {
      operation: 'send_image_dm',
      prompt: `Send a DM with image to ${target || 'the user'} on ${platform}. Image: ${imagePath}. Goal: ${goal}.`,
      extra: { username: target, attachmentPath: imagePath },
    },
    bulk_dm: {
      operation: 'bulk_dm_csv',
      prompt: `Bulk DM campaign on ${platform}. Goal: ${goal}. Tone: ${tone}.${imagePath ? ` Image: ${imagePath}` : ''}`,
      extra: { attachmentPath: imagePath || undefined },
    },

    // Leads
    find_leads: {
      operation: 'find_leads',
      prompt: `Find ${maxResults} leads on ${platform} for "${query || goal}" and export.`,
      extra: { query, maxResults },
    },
    scrape_followers: {
      operation: 'scrape_followers',
      prompt: `Scrape ${maxResults} followers from ${target || query} on ${platform}.`,
      extra: { query: target || query, maxResults },
    },
    deep_scrape: {
      operation: 'execute_deep_scrape',
      prompt: `Deep scrape ${platform} for "${query}". Open each profile. Limit: ${maxResults}.`,
      extra: { query, maxResults },
    },

    // Engagement
    like_post: {
      operation: 'like_post',
      prompt: `Like ${target || 'the user'}'s most recent post on ${platform}.`,
      extra: { username: target },
    },
    comment_post: {
      operation: 'engage_post',
      prompt: `Leave an AI comment on ${target || 'the user'}'s post on ${platform}. Tone: ${tone}.`,
      extra: { username: target },
    },
    follow_user: {
      operation: 'follow_user',
      prompt: `Follow ${target || 'the user'} on ${platform}.`,
      extra: { username: target },
    },
    follow_and_dm: {
      operation: 'follow_and_message',
      prompt: `Follow ${target} on ${platform} then send a DM. Goal: ${goal}. Tone: ${tone}.`,
      extra: { username: target },
    },

    // Content
    auto_post: {
      operation: 'auto_post',
      prompt: `Create and publish a post on ${platform}. Goal: ${goal}. Tone: ${tone}.${imagePath ? ` Asset: ${imagePath}` : ''}`,
      extra: { attachmentPath: imagePath || undefined },
    },
    generate_image: {
      operation: 'generate_image',
      prompt: `Generate an image via ${aiPlatform}: "${query || goal}". Style: ${params.style || tone}.`,
      platform: aiPlatform,
      extra: { query: query || goal, imageSubject: query || goal },
    },
    upload_image_to_ai: {
      operation: 'upload_to_ai',
      prompt: `Upload image to ${aiPlatform} and ${instruction}. File: ${imagePath}.`,
      platform: aiPlatform,
      extra: { attachmentPath: imagePath, query: instruction },
    },
    generate_and_post: {
      operation: 'generate_and_post',
      prompt: `Generate an image via ${aiPlatform} of "${query || goal}", then post it on ${socialPlatform}. Goal: ${goal}.`,
      platform: aiPlatform,
      extra: { query: query || goal, attachmentPath: imagePath || undefined, destination: socialPlatform },
    },
    generate_and_dm: {
      operation: 'generate_and_dm',
      prompt: `Generate an image via ${aiPlatform} of "${query || goal}", then DM it to ${target} on ${socialPlatform}.`,
      platform: aiPlatform,
      extra: { query: query || goal, username: target, destination: socialPlatform },
    },

    // Image ops
    download_image: {
      operation: 'download_image',
      prompt: `Download image/media from ${target || 'the post'} on ${platform}.`,
      extra: { username: target },
    },
    attach_image: {
      operation: 'upload_file',
      prompt: `Attach image: ${imagePath}`,
      extra: { attachmentPath: imagePath },
    },

    // Inbox
    get_inbox: {
      operation: platform === 'gmail' ? 'gmail_get_context' : 'get_context',
      prompt: `Read and summarize ${platform} inbox.`,
      extra: { maxResults: 20 },
    },
    search_inbox: {
      operation: platform === 'gmail' ? 'gmail_search' : 'search',
      prompt: `Search ${platform} for: ${query}.`,
      extra: { query },
    },
    get_profile_context: {
      operation: 'gmail_get_profile',
      prompt: `Get full profile context for ${target} on ${platform}.`,
      extra: { username: target },
    },

    // Continuous passthrough
    run_continuous: null, // handled at workflow level
  };

  const mapped = MAP[tool];
  if (!mapped) return null;

  const finalPlatform = mapped.platform || platform;

  return {
    prompt: mapped.prompt,
    context: {
      operation: mapped.operation,
      platform: finalPlatform,
      messageGoal: goal,
      tone,
      query: mapped.extra?.query ?? query,
      maxResults,
      attachmentPath: mapped.extra?.attachmentPath,
      username: mapped.extra?.username,
      emailSubject: params.subject || undefined,
      destination: mapped.extra?.destination || undefined,
      ...(mapped.extra || {}),
    },
    preferredBrowserMode: finalPlatform === 'research' ? 'managed' : 'attached',
  };
}

// ── Dispatch a single task to backend queue ───────────────────────────────────
function dispatchTask(payload, { tasks, upsertTask, broadcast, createId }) {
  const task = upsertTask({
    id: createId('task'),
    status: 'queued',
    prompt: payload.prompt,
    context: payload.context,
    preferredBrowserMode: payload.preferredBrowserMode || 'attached',
    events: [{ type: 'task.created', taskId: createId('event'), prompt: payload.prompt }],
    createdAt: new Date().toISOString(),
  });
  broadcast({ type: 'task.created', taskId: task.id, prompt: task.prompt });
  return task;
}

// ── Create a campaign for continuous actions ──────────────────────────────────
function createCampaign(suggestion, deps) {
  const { campaigns, broadcast, createId, CampaignSchema } = deps;
  const platform = suggestion.tools[0]?.params?.platform || 'instagram';
  const objective = suggestion.label || 'Cherry automated campaign';

  try {
    const campaign = CampaignSchema.parse({
      id: createId('campaign'),
      name: `🍒 ${objective.slice(0, 60)}`,
      objective,
      platforms: [platform],
      browserStrategy: { defaultMode: 'attached', perPlatform: {} },
      schedules: [{
        id: 'primary',
        label: `Every ${suggestion.cadenceMinutes || 60} min`,
        cadenceMinutes: suggestion.cadenceMinutes || 60,
      }],
      caps: {
        perPlatformDailyActions: {},
        perPlatformDailyMessages: {},
        maxConcurrentTabs: 2,
        maxConcurrentConversations: 1,
      },
      quietHours: { timezone: 'Asia/Kolkata', windows: [{ start: '23:00', end: '07:00' }] },
      targets: { usernames: [], emails: [], keywords: [], notes: '' },
      leadSources: [],
      stopRules: [
        { type: 'daily_cap_reached' },
        { type: 'consecutive_failures', count: 5 },
      ],
      contentPolicy: {
        tone: suggestion.tools[0]?.params?.tone || 'Casual and brief',
        outreachGoal: suggestion.tools[0]?.params?.goal || objective,
        allowAutonomousReplies: false,
      },
      status: 'draft',
    });
    campaigns.set(campaign.id, campaign);
    broadcast({ type: 'campaign.updated', campaignId: campaign.id, status: campaign.status });
    return campaign;
  } catch (e) {
    throw new Error(`Campaign creation failed: ${e.message}`);
  }
}

// ── Route setup ───────────────────────────────────────────────────────────────
export function setupAiRoutes(app, deps) {
  const { tasks, upsertTask, broadcast, campaigns, createId, CampaignSchema } = deps;
  const dispatchDeps = { tasks, upsertTask, broadcast, createId };

  // Health check — is local LLM running?
  app.get('/ai/health', async (_req, res) => {
    try {
      const r = await fetch(`${LLM_URL}/health`, { signal: AbortSignal.timeout(3000) });
      const data = await r.json();
      res.json({ llm: 'online', ...data });
    } catch {
      res.json({ llm: 'offline', url: LLM_URL });
    }
  });

  // Main AI chat endpoint
  app.post('/ai/chat', async (req, res) => {
    const { userId = 'default', message, reset } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });

    const session = getSession(userId);
    if (reset) session.history = [];

    let llmResult;
    try {
      const r = await fetch(`${LLM_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: session.history,
          max_tokens: 800,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) throw new Error(`LLM ${r.status}`);
      llmResult = await r.json();
    } catch (err) {
      return res.status(503).json({
        error: 'Local LLM offline',
        hint: 'Run: python3 llm_server.py',
        fallback: true,
      });
    }

    const { reply, actions, elapsed, tokens } = llmResult;

    // Save to history
    session.history.push({ role: 'user', content: message });
    session.history.push({ role: 'assistant', content: reply || '' });

    // Validate actions structure
    const suggestions = Array.isArray(actions) ? actions.filter(a => a.label && Array.isArray(a.tools)) : null;

    res.json({
      reply: reply || '',
      suggestions,
      elapsed,
      tokens,
      historyLength: session.history.length,
    });
  });

  // Execute a suggestion (burst: dispatch tasks, continuous: create campaign)
  app.post('/ai/execute', async (req, res) => {
    const { suggestion } = req.body || {};
    if (!suggestion || !Array.isArray(suggestion.tools)) {
      return res.status(400).json({ error: 'suggestion with tools array required' });
    }

    const mode = suggestion.mode || 'burst';

    if (mode === 'continuous') {
      try {
        const campaign = createCampaign(suggestion, { campaigns, broadcast, createId, CampaignSchema });
        return res.json({ mode: 'continuous', campaign: { id: campaign.id, name: campaign.name, status: campaign.status } });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // Burst — dispatch each tool as a sequential task
    const dispatched = [];
    for (const toolDef of suggestion.tools) {
      const payload = toolToTaskPayload(toolDef);
      if (!payload) continue;
      const task = dispatchTask(payload, dispatchDeps);
      dispatched.push({ id: task.id, status: task.status, prompt: task.prompt, tool: toolDef.tool });
    }

    res.json({ mode: 'burst', tasks: dispatched, count: dispatched.length });
  });

  // Clear history
  app.delete('/ai/chat/:userId', (req, res) => {
    chatSessions.delete(req.params.userId);
    res.json({ cleared: true });
  });

  // Get history
  app.get('/ai/chat/:userId', (req, res) => {
    const session = getSession(req.params.userId);
    res.json({ history: session.history.slice(-20) });
  });
}
