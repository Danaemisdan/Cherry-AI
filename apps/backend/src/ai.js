/**
 * Cherry AI — streaming chat + intent-based suggestions
 *
 * Key design decision:
 * When an intent is matched (dm/monitor/leads/etc), we skip the LLM entirely
 * and send a canned confident reply. The LLM only runs for pure conversation.
 * This eliminates hallucinated limitations like "I don't have access to WhatsApp".
 */

const LLM_URL = process.env.CHERRY_LLM_URL || 'http://localhost:11434';

// Per-user conversation sessions (server memory)
const chatSessions = new Map();
function getSession(userId) {
  if (!chatSessions.has(userId)) chatSessions.set(userId, { history: [] });
  return chatSessions.get(userId);
}

// ── Platform detection ────────────────────────────────────────────────────────
const PLATFORM_HINTS = {
  instagram: /instagram|ig\b/i,
  twitter:   /twitter|\bx\b|tweet/i,
  linkedin:  /linkedin|\bli\b/i,
  facebook:  /facebook|\bfb\b/i,
  gmail:     /gmail|email|inbox/i,
  whatsapp:  /whatsapp|\bwa\b/i,
  chatgpt:   /chatgpt|gpt|openai/i,
  gemini:    /gemini|google ai/i,
};

function detectPlatforms(text) {
  const found = Object.entries(PLATFORM_HINTS)
    .filter(([, re]) => re.test(text))
    .map(([p]) => p);
  return found.length ? found : ['instagram'];
}

// ── Intent → key ─────────────────────────────────────────────────────────────
function detectIntentKey(text) {
  if (/monitor|watch|auto.?reply|always.*reply|respond.*auto/i.test(text)) return 'monitor';
  if (/send.*dm|dm\b|direct.*message|message.*people|outreach|reach out/i.test(text)) return 'dm';
  if (/find.*lead|lead gen|get.*lead|prospect/i.test(text)) return 'leads';
  if (/like|comment|engage/i.test(text)) return 'engage';
  if (/\bfollow\b/i.test(text)) return 'follow';
  if (/\bpost\b|publish|auto.?post/i.test(text)) return 'post';
  if (/generate.*image|create.*image|make.*image|ai.*image/i.test(text)) return 'image';
  if (/download.*image|save.*image/i.test(text)) return 'download';
  if (/scrape|competitor.*audience/i.test(text)) return 'scrape';
  if (/read.*inbox|check.*inbox|check.*email/i.test(text)) return 'inbox';
  return null;
}

// ── Canned replies — confident, never claim inability ────────────────────────
const CANNED_REPLY = {
  monitor: (p) => `On it — I'll watch your ${p} inbox and auto-reply to new messages. Pick how often:`,
  dm:      (p) => `Yep, I can DM people on ${p}. Here's how you want to run it:`,
  leads:   (p) => `I can find leads on ${p} for you. Pick an option:`,
  engage:  (p) => `I can like and comment on ${p} posts. Here's what I can do:`,
  follow:  (p) => `I can follow users on ${p}. Here's the plan:`,
  post:    (p) => `I can post on ${p} for you. Here's the option:`,
  image:   ()  => `I can generate images with ChatGPT or Gemini. Pick an option:`,
  download:(p) => `I can download images from ${p}. Here's how:`,
  scrape:  (p) => `I can scrape the audience from ${p}. Here's the plan:`,
  inbox:   (p) => `I'll read your ${p} inbox. Here's what I can do:`,
};

// ── Suggestion builder ────────────────────────────────────────────────────────
const INTENT_SUGGESTIONS = {
  monitor: (platforms) => [
    { label: `Monitor ${platforms[0]} & auto-reply (every 30s)`, tools: [{ tool: 'get_inbox', params: { platform: platforms[0] } }, { tool: 'run_continuous', params: { platform: platforms[0], objective: 'Monitor inbox and auto-reply', cadenceSeconds: 30 } }], mode: 'continuous', cadenceSeconds: 30 },
    { label: `Monitor ${platforms[0]} & auto-reply (every 5 min)`, tools: [{ tool: 'get_inbox', params: { platform: platforms[0] } }, { tool: 'run_continuous', params: { platform: platforms[0], objective: 'Monitor inbox and auto-reply', cadenceSeconds: 300 } }], mode: 'continuous', cadenceSeconds: 300 },
  ],
  dm: (platforms) => [
    { label: `Send DMs on ${platforms[0]}`, tools: [{ tool: 'send_dm', params: { platform: platforms[0], goal: 'Connect and introduce', tone: 'Casual and brief' } }], mode: 'burst' },
    { label: `Send DMs on ${platforms[0]} continuously`, tools: [{ tool: 'bulk_dm', params: { platform: platforms[0], goal: 'Connect and introduce', tone: 'Casual and brief' } }], mode: 'continuous', cadenceMinutes: 60 },
  ],
  leads: (platforms) => [
    { label: `Find leads on ${platforms[0]}`, tools: [{ tool: 'find_leads', params: { platform: platforms[0], query: 'founders', maxResults: 25 } }], mode: 'burst' },
    { label: `Find leads + DM them on ${platforms[0]}`, tools: [{ tool: 'find_leads', params: { platform: platforms[0], query: 'founders', maxResults: 25 } }, { tool: 'bulk_dm', params: { platform: platforms[0], goal: 'Introduce and connect', tone: 'Casual and brief' } }], mode: 'burst' },
  ],
  engage: (platforms) => [{ label: `Like & comment on ${platforms[0]} posts`, tools: [{ tool: 'like_post', params: { platform: platforms[0] } }, { tool: 'comment_post', params: { platform: platforms[0], tone: 'Friendly and genuine' } }], mode: 'burst' }],
  follow: (platforms) => [{ label: `Follow users on ${platforms[0]}`, tools: [{ tool: 'follow_user', params: { platform: platforms[0] } }], mode: 'burst' }],
  post:   (platforms) => [{ label: `Auto-post on ${platforms[0]}`, tools: [{ tool: 'auto_post', params: { platform: platforms[0], goal: 'Share valuable content', tone: 'Professional' } }], mode: 'burst' }],
  image:  ()          => [
    { label: 'Generate image with ChatGPT', tools: [{ tool: 'generate_image', params: { aiPlatform: 'chatgpt', subject: 'your subject' } }], mode: 'burst' },
    { label: 'Generate image → Post to Instagram', tools: [{ tool: 'generate_image', params: { aiPlatform: 'chatgpt', subject: 'your subject' } }, { tool: 'auto_post', params: { platform: 'instagram' } }], mode: 'burst' },
  ],
  download: (platforms) => [{ label: `Download images from ${platforms[0]}`, tools: [{ tool: 'download_image', params: { platform: platforms[0] } }], mode: 'burst' }],
  scrape:   (platforms) => [{ label: `Scrape audience from ${platforms[0]}`, tools: [{ tool: 'scrape_followers', params: { platform: platforms[0], maxResults: 50 } }], mode: 'burst' }],
  inbox:    (platforms) => [{ label: `Read ${platforms[0]} inbox`, tools: [{ tool: 'get_inbox', params: { platform: platforms[0] } }], mode: 'burst' }],
};

function detectIntent(text) {
  const key = detectIntentKey(text);
  if (!key) return { key: null, suggestions: null, reply: null };
  const platforms = detectPlatforms(text);
  return {
    key,
    suggestions: INTENT_SUGGESTIONS[key]?.(platforms) || null,
    reply: CANNED_REPLY[key]?.(platforms[0]) || null,
  };
}

// ── Tool → Task payload ───────────────────────────────────────────────────────
function toolToTaskPayload(toolDef) {
  const { tool, params = {} } = toolDef;
  const platform   = params.platform || params.aiPlatform || 'instagram';
  const target     = params.target || params.username || '';
  const goal       = params.goal || 'Get a meeting';
  const tone       = params.tone || 'Casual and brief';
  const query      = params.query || '';
  const maxResults = Number(params.maxResults) || 15;
  const imagePath  = params.imagePath || params.attachmentPath || '';
  const aiPlatform = params.aiPlatform || 'chatgpt';

  const MAP = {
    send_dm:            { op: platform === 'gmail' ? 'auto_dm' : 'auto_dm_contact', prompt: `Send a DM to ${target || 'the user'} on ${platform}. Goal: ${goal}. Tone: ${tone}.` },
    send_image_dm:      { op: 'send_image_dm', prompt: `Send a DM with image to ${target || 'the user'} on ${platform}. Image: ${imagePath}. Goal: ${goal}.` },
    bulk_dm:            { op: 'bulk_dm_csv', prompt: `Bulk DM campaign on ${platform}. Goal: ${goal}. Tone: ${tone}.` },
    find_leads:         { op: 'find_leads', prompt: `Find ${maxResults} leads on ${platform} for "${query || goal}" and export.` },
    scrape_followers:   { op: 'scrape_followers', prompt: `Scrape ${maxResults} followers from ${target || query} on ${platform}.` },
    like_post:          { op: 'like_post', prompt: `Like ${target || 'the user'}'s most recent post on ${platform}.` },
    comment_post:       { op: 'engage_post', prompt: `AI comment on ${target || 'the user'}'s post on ${platform}. Tone: ${tone}.` },
    follow_user:        { op: 'follow_user', prompt: `Follow ${target || 'the user'} on ${platform}.` },
    auto_post:          { op: 'auto_post', prompt: `Post on ${platform}. Goal: ${goal}. Tone: ${tone}.` },
    generate_image:     { op: 'generate_image', prompt: `Generate image via ${aiPlatform}: "${query || goal}". Style: ${params.style || 'professional'}.`, platform: aiPlatform },
    generate_and_post:  { op: 'generate_and_post', prompt: `Generate image via ${aiPlatform} of "${query}", then post to ${params.socialPlatform || 'instagram'}.`, platform: aiPlatform },
    generate_and_dm:    { op: 'generate_and_dm', prompt: `Generate image via ${aiPlatform} of "${query}", then DM to ${target}.`, platform: aiPlatform },
    download_image:     { op: 'download_image', prompt: `Download image from ${target || 'the post'} on ${platform}.` },
    upload_image_to_ai: { op: 'upload_to_ai', prompt: `Upload ${imagePath} to ${aiPlatform} and ${params.instruction || goal}.`, platform: aiPlatform },
    get_inbox:          { op: platform === 'gmail' ? 'gmail_get_context' : 'get_context', prompt: `Read and summarize ${platform} inbox.` },
    run_continuous:     { op: 'run_campaign', prompt: `Run always-on campaign on ${platform}. Objective: ${params.objective || goal}.` },
    deep_scrape:        { op: 'execute_deep_scrape', prompt: `Deep scrape ${platform} for "${query}". Limit: ${maxResults}.` },
  };

  const m = MAP[tool];
  if (!m) return null;
  return {
    prompt: m.prompt,
    context: { operation: m.op, platform: m.platform || platform, messageGoal: goal, tone, query, maxResults, attachmentPath: imagePath || undefined, username: target || undefined },
    preferredBrowserMode: (m.platform || platform) === 'research' ? 'managed' : 'attached',
  };
}

function dispatchTask(payload, { upsertTask, broadcast, createId }) {
  const task = upsertTask({
    id: createId('task'),
    status: 'queued',
    prompt: payload.prompt,
    context: payload.context,
    preferredBrowserMode: payload.preferredBrowserMode,
    events: [{ type: 'task.created', taskId: createId('event'), prompt: payload.prompt }],
    createdAt: new Date().toISOString(),
  });
  broadcast({ type: 'task.created', taskId: task.id, prompt: task.prompt });
  return task;
}

function createCampaign(suggestion, { campaigns, broadcast, createId, CampaignSchema }) {
  const platform = suggestion.tools?.[0]?.params?.platform || 'instagram';
  const cadenceSecs = suggestion.cadenceSeconds || (suggestion.cadenceMinutes ? suggestion.cadenceMinutes * 60 : 1800);
  const cadenceMins = Math.max(cadenceSecs / 60, 0.016);
  const cadenceLabel = cadenceSecs < 60 ? `Every ${cadenceSecs}s` : cadenceSecs < 3600 ? `Every ${Math.round(cadenceSecs / 60)}m` : `Every ${Math.round(cadenceSecs / 3600)}h`;
  const campaign = CampaignSchema.parse({
    id: createId('campaign'),
    name: `🍒 ${suggestion.label.slice(0, 60)}`,
    objective: suggestion.label,
    platforms: [platform],
    browserStrategy: { defaultMode: 'attached', perPlatform: {} },
    schedules: [{ id: 'primary', label: cadenceLabel, cadenceMinutes: cadenceMins }],
    caps: { perPlatformDailyActions: {}, perPlatformDailyMessages: {}, maxConcurrentTabs: 2, maxConcurrentConversations: 1 },
    quietHours: { timezone: 'Asia/Kolkata', windows: [{ start: '23:00', end: '07:00' }] },
    targets: { usernames: [], emails: [], keywords: [], notes: '' },
    leadSources: [],
    stopRules: [{ type: 'daily_cap_reached' }, { type: 'consecutive_failures', count: 5 }],
    contentPolicy: { tone: 'Casual and brief', outreachGoal: suggestion.label, allowAutonomousReplies: false },
    status: 'draft',
  });
  campaigns.set(campaign.id, campaign);
  broadcast({ type: 'campaign.updated', campaignId: campaign.id, status: campaign.status });
  return campaign;
}

// ── SSE helper ───────────────────────────────────────────────────────────────
function sseReply(res, reply, suggestions) {
  // Stream canned reply token-by-token (word chunks feel natural)
  const words = reply.split(' ');
  let i = 0;
  const iv = setInterval(() => {
    if (i >= words.length) {
      clearInterval(iv);
      res.write(`data: ${JSON.stringify({ done: true, suggestions })}\n\n`);
      res.end();
      return;
    }
    const token = (i === 0 ? '' : ' ') + words[i++];
    res.write(`data: ${JSON.stringify({ token })}\n\n`);
  }, 30);
}

// ── Route setup ───────────────────────────────────────────────────────────────
export function setupAiRoutes(app, deps) {
  const { upsertTask, broadcast, campaigns, createId, CampaignSchema } = deps;
  const dispatchDeps = { upsertTask, broadcast, createId };

  app.get('/ai/health', async (_req, res) => {
    try {
      const r = await fetch(`${LLM_URL}/health`, { signal: AbortSignal.timeout(3000) });
      res.json({ llm: 'online', ...(await r.json()) });
    } catch {
      res.json({ llm: 'offline', url: LLM_URL });
    }
  });

  // ── Main chat endpoint (SSE) ─────────────────────────────────────────────
  app.post('/ai/chat', async (req, res) => {
    const { userId = 'default', message, reset } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });

    const session = getSession(userId);
    if (reset) session.history = [];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // Intent check — if matched, skip LLM and stream a canned reply
    const { reply: cannedReply, suggestions } = detectIntent(message);

    if (cannedReply) {
      session.history.push({ role: 'user', content: message });
      session.history.push({ role: 'assistant', content: cannedReply });
      return sseReply(res, cannedReply, suggestions);
    }

    // No intent — call LLM for real conversation
    let fullReply = '';
    try {
      const llmRes = await fetch(`${LLM_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: session.history }),
        signal: AbortSignal.timeout(45000),
      });
      if (!llmRes.ok) throw new Error('offline');

      const reader = llmRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const { token } = JSON.parse(raw);
            if (token) { fullReply += token; res.write(`data: ${JSON.stringify({ token })}\n\n`); }
          } catch {}
        }
      }
    } catch {
      const fallback = 'LLM is offline. Run: python3 llm_server.py';
      fullReply = fallback;
      res.write(`data: ${JSON.stringify({ token: fallback })}\n\n`);
    }

    session.history.push({ role: 'user', content: message });
    session.history.push({ role: 'assistant', content: fullReply });
    res.write(`data: ${JSON.stringify({ done: true, suggestions: null })}\n\n`);
    res.end();
  });

  // ── Execute suggestion ────────────────────────────────────────────────────
  app.post('/ai/execute', async (req, res) => {
    const { suggestion } = req.body || {};
    if (!suggestion?.tools?.length) return res.status(400).json({ error: 'suggestion.tools required' });

    if (suggestion.mode === 'continuous') {
      try {
        const campaign = createCampaign(suggestion, { campaigns, broadcast, createId, CampaignSchema });
        return res.json({ mode: 'continuous', campaign: { id: campaign.id, name: campaign.name, status: campaign.status } });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    const dispatched = [];
    for (const toolDef of suggestion.tools) {
      const payload = toolToTaskPayload(toolDef);
      if (!payload) continue;
      dispatched.push(dispatchTask(payload, dispatchDeps));
    }
    res.json({ mode: 'burst', tasks: dispatched.map(t => ({ id: t.id, prompt: t.prompt })), count: dispatched.length });
  });

  // ── Clear session (new chat) ──────────────────────────────────────────────
  app.delete('/ai/chat/:userId', (req, res) => {
    chatSessions.delete(req.params.userId);
    res.json({ cleared: true });
  });
}
