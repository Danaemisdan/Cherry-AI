/**
 * Cherry AI Chat — routes /ai/chat to the local LLM server (port 11434)
 * and converts tool calls into real Cherry task dispatches.
 */

const LLM_URL = process.env.CHERRY_LLM_URL || 'http://localhost:11434';

// In-memory conversation sessions keyed by userId
const chatSessions = new Map();

function getSession(userId) {
  if (!chatSessions.has(userId)) {
    chatSessions.set(userId, { history: [], createdAt: Date.now() });
  }
  return chatSessions.get(userId);
}

/** Map LLM tool names → Cherry task payloads */
function toolToTask(toolCall, sessionContext = {}) {
  const { tool, params = {}, mode = 'burst' } = toolCall;
  const platform = params.platform || sessionContext.platform || 'instagram';
  const target = params.target || params.username || '';
  const goal = params.goal || sessionContext.goal || 'Get a meeting';
  const tone = params.tone || sessionContext.tone || 'Casual and brief';
  const query = params.query || sessionContext.query || '';
  const maxResults = params.maxResults || sessionContext.maxResults || 15;

  const TOOL_MAP = {
    send_dm: {
      operation: platform === 'gmail' ? 'auto_dm' : 'auto_dm_contact',
      prompt: `Send an automated DM to ${target || 'the user'} on ${platform}. Goal: ${goal}. Tone: ${tone}.`,
    },
    find_leads: {
      operation: 'find_leads',
      prompt: `Find ${maxResults} leads on ${platform} for "${query}" and export to sheet.`,
    },
    like_post: {
      operation: 'like_post',
      prompt: `Like ${target || 'the user'}'s most recent post on ${platform}.`,
    },
    ai_comment: {
      operation: 'engage_post',
      prompt: `Leave an AI comment on ${target || 'the user'}'s post on ${platform}. Tone: ${tone}.`,
    },
    follow_user: {
      operation: 'follow_user',
      prompt: `Follow ${target || 'the user'} on ${platform}.`,
    },
    auto_post: {
      operation: 'auto_post',
      prompt: `Create and publish a post on ${platform}. Goal: ${goal}. Tone: ${tone}.`,
    },
    bulk_dm: {
      operation: 'bulk_dm_csv',
      prompt: `Bulk DM campaign on ${platform}. Goal: ${goal}. Tone: ${tone}.`,
    },
    scrape_followers: {
      operation: 'scrape_followers',
      prompt: `Scrape followers from ${target || query} on ${platform}. Limit: ${maxResults}.`,
    },
    generate_image: {
      operation: 'generate_image',
      prompt: `Generate an image: ${params.subject || query}. Style: ${params.style || tone}.`,
    },
    ask_ai: {
      operation: 'ask',
      prompt: params.question || query,
    },
    gmail_search: {
      operation: 'gmail_search',
      prompt: `Search Gmail for: ${params.query || query}`,
    },
    get_inbox_context: {
      operation: 'gmail_get_context',
      prompt: `Read and extract context from ${platform} inbox.`,
    },
    run_continuous: {
      operation: 'run_campaign',
      prompt: `Run always-on campaign on ${(params.platforms || [platform]).join(', ')}. Objective: ${params.objective || goal}.`,
    },
  };

  const mapped = TOOL_MAP[tool];
  if (!mapped) return null;

  return {
    prompt: mapped.prompt,
    context: {
      operation: mapped.operation,
      platform,
      username: target || undefined,
      messageGoal: goal,
      tone,
      query,
      maxResults: Number(maxResults) || 15,
      attachmentPath: params.attachment || undefined,
      emailSubject: params.subject || undefined,
      mode,
    },
    preferredBrowserMode: platform === 'research' ? 'managed' : 'attached',
    isContinuous: mode === 'continuous',
    cadenceMinutes: params.cadenceMinutes || 60,
  };
}

export function setupAiRoutes(app, { tasks, upsertTask, broadcast, campaigns, createId, CampaignSchema }) {
  // Check if local LLM is reachable
  app.get('/ai/health', async (_req, res) => {
    try {
      const r = await fetch(`${LLM_URL}/health`, { signal: AbortSignal.timeout(3000) });
      const data = await r.json();
      res.json({ llm: 'online', ...data });
    } catch {
      res.json({ llm: 'offline', url: LLM_URL });
    }
  });

  // Main chat endpoint
  app.post('/ai/chat', async (req, res) => {
    const { userId = 'default', message, reset } = req.body || {};

    if (!message?.trim()) {
      return res.status(400).json({ error: 'message required' });
    }

    const session = getSession(userId);

    if (reset) {
      session.history = [];
    }

    // Call local LLM
    let llmResult;
    try {
      const response = await fetch(`${LLM_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: session.history,
          max_tokens: 500,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`LLM returned ${response.status}`);
      }

      llmResult = await response.json();
    } catch (err) {
      // LLM offline — fall back to rule-based dialogue
      return res.status(503).json({
        error: 'Local LLM offline',
        hint: 'Run: python3 llm_server.py from the Cherry AI directory',
        fallback: true,
      });
    }

    const { reply, tool_call, elapsed, tokens } = llmResult;

    // Save to session history
    session.history.push({ role: 'user', content: message });
    session.history.push({ role: 'assistant', content: reply || '' });

    // If LLM wants to execute a tool
    let taskResult = null;
    let campaignResult = null;
    let requiresConfirm = false;

    if (tool_call) {
      const taskPayload = toolToTask(tool_call, session.context || {});

      if (taskPayload) {
        if (tool_call.confirm === true || taskPayload.isContinuous) {
          // Needs user confirmation — return the plan, don't execute yet
          requiresConfirm = true;
        } else {
          // Auto-execute burst action
          const task = upsertTask({
            id: createId('task'),
            status: 'queued',
            prompt: taskPayload.prompt,
            context: taskPayload.context,
            preferredBrowserMode: taskPayload.preferredBrowserMode,
            events: [{ type: 'task.created', taskId: createId('event'), prompt: taskPayload.prompt }],
            createdAt: new Date().toISOString(),
          });
          broadcast({ type: 'task.created', taskId: task.id, prompt: task.prompt });
          taskResult = { id: task.id, status: task.status, prompt: task.prompt };
        }
      }
    }

    res.json({
      reply,
      tool_call: tool_call || null,
      task: taskResult,
      campaign: campaignResult,
      requiresConfirm,
      elapsed,
      tokens,
      historyLength: session.history.length,
    });
  });

  // Confirm and execute a pending tool call
  app.post('/ai/confirm', async (req, res) => {
    const { userId = 'default', tool_call, approved } = req.body || {};

    if (!approved) {
      return res.json({ cancelled: true });
    }

    if (!tool_call) {
      return res.status(400).json({ error: 'tool_call required' });
    }

    const taskPayload = toolToTask(tool_call);
    if (!taskPayload) {
      return res.status(400).json({ error: 'Unknown tool' });
    }

    if (taskPayload.isContinuous) {
      // Create a campaign
      try {
        const campaign = CampaignSchema.parse({
          id: createId('campaign'),
          name: `Cherry Agent — ${tool_call.tool}`,
          objective: taskPayload.prompt,
          platforms: [taskPayload.context.platform],
          browserStrategy: { defaultMode: 'attached', perPlatform: {} },
          schedules: [{ id: 'primary', label: `Every ${taskPayload.cadenceMinutes} min`, cadenceMinutes: taskPayload.cadenceMinutes }],
          caps: { perPlatformDailyActions: {}, perPlatformDailyMessages: {}, maxConcurrentTabs: 2, maxConcurrentConversations: 1 },
          quietHours: { timezone: 'Asia/Kolkata', windows: [{ start: '23:00', end: '07:00' }] },
          targets: { usernames: [], emails: [], keywords: [], notes: '' },
          leadSources: [],
          stopRules: [{ type: 'daily_cap_reached' }, { type: 'consecutive_failures', count: 5 }],
          contentPolicy: { tone: taskPayload.context.tone || 'Casual and brief', outreachGoal: taskPayload.context.messageGoal || 'Get a meeting', allowAutonomousReplies: false },
          status: 'draft',
        });
        campaigns.set(campaign.id, campaign);
        broadcast({ type: 'campaign.updated', campaignId: campaign.id, status: campaign.status });
        return res.json({ campaign: { id: campaign.id, name: campaign.name, status: campaign.status } });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // Burst task
    const task = upsertTask({
      id: createId('task'),
      status: 'queued',
      prompt: taskPayload.prompt,
      context: taskPayload.context,
      preferredBrowserMode: taskPayload.preferredBrowserMode,
      events: [{ type: 'task.created', taskId: createId('event'), prompt: taskPayload.prompt }],
      createdAt: new Date().toISOString(),
    });
    broadcast({ type: 'task.created', taskId: task.id, prompt: task.prompt });

    res.json({ task: { id: task.id, status: task.status, prompt: task.prompt } });
  });

  // Clear chat history
  app.delete('/ai/chat/:userId', (req, res) => {
    chatSessions.delete(req.params.userId);
    res.json({ cleared: true });
  });

  // Get chat history
  app.get('/ai/chat/:userId', (req, res) => {
    const session = getSession(req.params.userId);
    res.json({ history: session.history.slice(-20) });
  });
}
