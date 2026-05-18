/**
 * Cherry AI — streaming chat + intent-based suggestions
 *
 * Rules:
 * 1. Intent matched → clarify missing params → show action cards. LLM never runs.
 * 2. No intent → LLM runs with a strict system prompt: NEVER claim to do things, NEVER hallucinate actions.
 * 3. Clarification state is stored per session so follow-ups fill in blanks.
 */

const LLM_URL = process.env.CHERRY_LLM_URL || 'http://localhost:11434';

const SYSTEM_PROMPT = `You are Cherry, an AI automation agent that controls a browser to do social media tasks.

STRICT RULES — never break these:
- You CANNOT and have NOT sent any messages, emails, DMs, or done anything on your own.
- NEVER say "I sent", "I messaged", "I posted", "I did" — you haven't done anything until the user clicks a button.
- If the user asks "did you send?" or "did you do X?" — always say: "No, I haven't done anything yet. Use the action card to run the task."
- If the user wants to send a DM/message/email, ask: "What message should I send, and who should I send it to?"
- Keep replies SHORT (1-2 sentences max). Be direct and confident.
- You exist to HELP users set up automation tasks, not to pretend you've run them.`;

// Per-user sessions
const chatSessions = new Map();
function getSession(userId) {
  if (!chatSessions.has(userId)) chatSessions.set(userId, { history: [], pending: null });
  const s = chatSessions.get(userId);
  if (!s.pending) s.pending = null;
  return s;
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

function extractTarget(text) {
  const m = text.match(/\bto\s+@?([A-Za-z0-9._]+)|@([A-Za-z0-9._]+)/i);
  if (m) return (m[1] || m[2]).replace(/^(on|in|at)$/i, '');
  return null;
}

// ── Intent detection ──────────────────────────────────────────────────────────
function detectIntentKey(text) {
  if (/monitor|watch|auto.?reply|always.*reply|respond.*auto/i.test(text)) return 'monitor';
  // DM: broad match — "send a message", "send dm", "message Jagadeesh", "text someone", "reach out"
  if (/send.*\b(dm|message|msg|text)\b|\bdm\b|direct.*message|message.*people|outreach|reach.?out|text.*\b(to|someone)\b/i.test(text)) return 'dm';
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

// ── Clarification: what info is missing for each intent ───────────────────────
function getMissingParams(intentKey, accumulated) {
  const missing = [];
  if (intentKey === 'dm') {
    if (!accumulated.target) missing.push({ key: 'target', question: `Who should I send the message to? (name or @username)` });
    if (!accumulated.message) missing.push({ key: 'message', question: `What message should I send them?` });
  }
  if (intentKey === 'leads') {
    if (!accumulated.query) missing.push({ key: 'query', question: `What kind of leads? (e.g. "fintech founders in India")` });
  }
  if (intentKey === 'engage') {
    if (!accumulated.target) missing.push({ key: 'target', question: `Whose post should I like/comment on? (@username)` });
  }
  return missing;
}

// ── Canned final replies (after all params collected) ─────────────────────────
function buildFinalReply(intentKey, platform, acc) {
  const replies = {
    monitor: () => `Got it — I'll watch your ${platform} inbox and auto-reply to new messages. Pick how often:`,
    dm:      () => `Perfect — I'll send "${acc.message}" to ${acc.target} on ${platform}. Pick how to run it:`,
    leads:   () => `On it — finding "${acc.query}" leads on ${platform}. Pick an option:`,
    engage:  () => `I'll like and comment on @${acc.target}'s ${platform} posts. Here's what I can do:`,
    follow:  () => `I'll follow users on ${platform}. Here's the plan:`,
    post:    () => `I can post on ${platform} for you. Here's the option:`,
    image:   () => `I can generate images with ChatGPT or Gemini. Pick an option:`,
    download:() => `I can download images from ${platform}. Here's how:`,
    scrape:  () => `I can scrape the ${platform} audience. Here's the plan:`,
    inbox:   () => `I'll read your ${platform} inbox. Here's what I can do:`,
  };
  return replies[intentKey]?.() || `Got it — here's what I can do:`;
}

// ── Suggestion cards ──────────────────────────────────────────────────────────
function buildSuggestions(intentKey, platforms, acc) {
  const p = platforms[0];
  const { target = '', message = '', query = 'founders' } = acc;
  const S = {
    monitor: () => [
      { label: `Monitor ${p} & auto-reply (every 30s)`, tools: [{ tool: 'get_inbox', params: { platform: p } }, { tool: 'run_continuous', params: { platform: p, objective: 'Monitor inbox and auto-reply', cadenceSeconds: 30 } }], mode: 'continuous', cadenceSeconds: 30 },
      { label: `Monitor ${p} & auto-reply (every 5 min)`, tools: [{ tool: 'get_inbox', params: { platform: p } }, { tool: 'run_continuous', params: { platform: p, objective: 'Monitor inbox and auto-reply', cadenceSeconds: 300 } }], mode: 'continuous', cadenceSeconds: 300 },
    ],
    dm: () => [
      { label: `Send message to ${target} on ${p}`, tools: [{ tool: 'send_dm', params: { platform: p, target, message, goal: message, tone: 'Casual and brief' } }], mode: 'burst' },
      { label: `Send to ${target} on ${p} + run continuously`, tools: [{ tool: 'bulk_dm', params: { platform: p, target, message, goal: message, tone: 'Casual and brief' } }], mode: 'continuous', cadenceMinutes: 60 },
    ],
    leads: () => [
      { label: `Find "${query}" leads on ${p}`, tools: [{ tool: 'find_leads', params: { platform: p, query, maxResults: 25 } }], mode: 'burst' },
      { label: `Find + DM "${query}" leads on ${p}`, tools: [{ tool: 'find_leads', params: { platform: p, query, maxResults: 25 } }, { tool: 'bulk_dm', params: { platform: p, goal: 'Introduce and connect', tone: 'Casual and brief' } }], mode: 'burst' },
    ],
    engage:  () => [{ label: `Like & comment on @${target}'s ${p} posts`, tools: [{ tool: 'like_post', params: { platform: p, target } }, { tool: 'comment_post', params: { platform: p, target, tone: 'Friendly and genuine' } }], mode: 'burst' }],
    follow:  () => [{ label: `Follow users on ${p}`, tools: [{ tool: 'follow_user', params: { platform: p } }], mode: 'burst' }],
    post:    () => [{ label: `Auto-post on ${p}`, tools: [{ tool: 'auto_post', params: { platform: p, goal: 'Share valuable content', tone: 'Professional' } }], mode: 'burst' }],
    image:   () => [
      { label: 'Generate image with ChatGPT', tools: [{ tool: 'generate_image', params: { aiPlatform: 'chatgpt', subject: 'your subject' } }], mode: 'burst' },
      { label: 'Generate image → Post to Instagram', tools: [{ tool: 'generate_image', params: { aiPlatform: 'chatgpt', subject: 'your subject' } }, { tool: 'auto_post', params: { platform: 'instagram' } }], mode: 'burst' },
    ],
    download:() => [{ label: `Download images from ${p}`, tools: [{ tool: 'download_image', params: { platform: p } }], mode: 'burst' }],
    scrape:  () => [{ label: `Scrape audience from ${p}`, tools: [{ tool: 'scrape_followers', params: { platform: p, maxResults: 50 } }], mode: 'burst' }],
    inbox:   () => [{ label: `Read ${p} inbox`, tools: [{ tool: 'get_inbox', params: { platform: p } }], mode: 'burst' }],
  };
  return S[intentKey]?.() || null;
}

// ── Tool → Task payload ───────────────────────────────────────────────────────
function toolToTaskPayload(toolDef) {
  const { tool, params = {} } = toolDef;
  const platform   = params.platform || params.aiPlatform || 'instagram';
  const target     = params.target || params.username || '';
  const message    = params.message || params.goal || 'Hello, reaching out!';
  const goal       = params.goal || message;
  const tone       = params.tone || 'Casual and brief';
  const query      = params.query || '';
  const maxResults = Number(params.maxResults) || 15;
  const imagePath  = params.imagePath || params.attachmentPath || '';
  const aiPlatform = params.aiPlatform || 'chatgpt';

  const MAP = {
    send_dm:            { op: 'auto_dm_contact', prompt: `Send this exact message to ${target || 'the contact'} on ${platform}: "${message}". Tone: ${tone}.` },
    send_image_dm:      { op: 'send_image_dm',   prompt: `Send a DM with image to ${target || 'the contact'} on ${platform}. Message: "${message}". Image: ${imagePath}.` },
    bulk_dm:            { op: 'bulk_dm_csv',      prompt: `Bulk DM on ${platform}. Message: "${message}". Tone: ${tone}.` },
    find_leads:         { op: 'find_leads',        prompt: `Find ${maxResults} leads on ${platform} for "${query || goal}" and export.` },
    scrape_followers:   { op: 'scrape_followers',  prompt: `Scrape ${maxResults} followers from ${target || query} on ${platform}.` },
    like_post:          { op: 'like_post',         prompt: `Like ${target || 'the user'}'s most recent post on ${platform}.` },
    comment_post:       { op: 'engage_post',       prompt: `Leave an AI-generated comment on ${target || 'the user'}'s post on ${platform}. Tone: ${tone}.` },
    follow_user:        { op: 'follow_user',       prompt: `Follow ${target || 'the user'} on ${platform}.` },
    auto_post:          { op: 'auto_post',         prompt: `Post on ${platform}. Goal: ${goal}. Tone: ${tone}.` },
    generate_image:     { op: 'generate_image',    prompt: `Generate image via ${aiPlatform}: "${query || goal}". Style: ${params.style || 'professional'}.`, platform: aiPlatform },
    generate_and_post:  { op: 'generate_and_post', prompt: `Generate image via ${aiPlatform} of "${query}", then post to ${params.socialPlatform || 'instagram'}.`, platform: aiPlatform },
    download_image:     { op: 'download_image',    prompt: `Download image from ${target || 'the post'} on ${platform}.` },
    get_inbox:          { op: platform === 'gmail' ? 'gmail_get_context' : 'get_context', prompt: `Read and summarize ${platform} inbox.` },
    run_continuous:     { op: 'run_campaign',      prompt: `Run always-on campaign on ${platform}. Objective: ${params.objective || goal}.` },
    deep_scrape:        { op: 'execute_deep_scrape', prompt: `Deep scrape ${platform} for "${query}". Limit: ${maxResults}.` },
  };

  const m = MAP[tool];
  if (!m) return null;
  return {
    prompt: m.prompt,
    context: { operation: m.op, platform: m.platform || platform, messageGoal: message, tone, query, maxResults, attachmentPath: imagePath || undefined, username: target || undefined },
    preferredBrowserMode: (m.platform || platform) === 'research' ? 'managed' : 'attached',
  };
}

function dispatchTask(payload, { upsertTask, broadcast, createId }) {
  const task = upsertTask({
    id: createId('task'), status: 'queued',
    prompt: payload.prompt, context: payload.context,
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
    status: 'active',
  });
  campaigns.set(campaign.id, campaign);
  broadcast({ type: 'campaign.updated', campaignId: campaign.id, status: campaign.status });
  return campaign;
}

// ── SSE streaming helper ──────────────────────────────────────────────────────
function sseReply(res, reply, suggestions) {
  const words = reply.split(' ');
  let i = 0;
  const iv = setInterval(() => {
    if (i >= words.length) {
      clearInterval(iv);
      res.write(`data: ${JSON.stringify({ done: true, suggestions })}\n\n`);
      res.end();
      return;
    }
    res.write(`data: ${JSON.stringify({ token: (i === 0 ? '' : ' ') + words[i++] })}\n\n`);
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
    } catch { res.json({ llm: 'offline', url: LLM_URL }); }
  });

  // ── Main chat endpoint ────────────────────────────────────────────────────
  app.post('/ai/chat', async (req, res) => {
    const { userId = 'default', message, reset } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: 'message required' });

    const session = getSession(userId);
    if (reset) { session.history = []; session.pending = null; }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    session.history.push({ role: 'user', content: message });

    // ── CASE 1: In the middle of a clarification flow ─────────────────────
    if (session.pending) {
      const { intentKey, platforms, accumulated, missingQueue } = session.pending;
      // Fill the current missing param with this message
      accumulated[missingQueue[0].key] = message.trim();
      const remaining = missingQueue.slice(1).filter(m => !accumulated[m.key]);

      if (remaining.length > 0) {
        session.pending = { intentKey, platforms, accumulated, missingQueue: remaining };
        const q = remaining[0].question;
        session.history.push({ role: 'assistant', content: q });
        return sseReply(res, q, null);
      }

      // All collected — show action cards
      session.pending = null;
      const finalReply = buildFinalReply(intentKey, platforms[0], accumulated);
      const suggestions = buildSuggestions(intentKey, platforms, accumulated);
      session.history.push({ role: 'assistant', content: finalReply });
      return sseReply(res, finalReply, suggestions);
    }

    // ── CASE 2: Fresh intent detection ───────────────────────────────────
    const intentKey = detectIntentKey(message);
    if (intentKey) {
      const platforms = detectPlatforms(message);
      const accumulated = {};
      const target = extractTarget(message);
      if (target) accumulated.target = target;

      const missing = getMissingParams(intentKey, accumulated);
      if (missing.length > 0) {
        session.pending = { intentKey, platforms, accumulated, missingQueue: missing };
        const q = missing[0].question;
        session.history.push({ role: 'assistant', content: q });
        return sseReply(res, q, null);
      }

      // All info present — go straight to cards
      const reply = buildFinalReply(intentKey, platforms[0], accumulated);
      const suggestions = buildSuggestions(intentKey, platforms, accumulated);
      session.history.push({ role: 'assistant', content: reply });
      return sseReply(res, reply, suggestions);
    }

    // ── CASE 3: No intent — LLM with strict system prompt ────────────────
    let fullReply = '';
    try {
      const llmRes = await fetch(`${LLM_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: session.history, system: SYSTEM_PROMPT }),
        signal: AbortSignal.timeout(30000),
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
      // LLM offline or error — give a helpful nudge instead of hallucinating
      fullReply = `I can help with social media automation. Try: "Send a DM to @username on Instagram" or "Monitor my WhatsApp and auto-reply".`;
      res.write(`data: ${JSON.stringify({ token: fullReply })}\n\n`);
    }

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
      } catch (e) { return res.status(500).json({ error: e.message }); }
    }

    const dispatched = [];
    for (const toolDef of suggestion.tools) {
      const payload = toolToTaskPayload(toolDef);
      if (!payload) continue;
      dispatched.push(dispatchTask(payload, dispatchDeps));
    }
    res.json({ mode: 'burst', tasks: dispatched.map(t => ({ id: t.id, prompt: t.prompt })), count: dispatched.length });
  });

  // ── Clear session ─────────────────────────────────────────────────────────
  app.delete('/ai/chat/:userId', (req, res) => {
    chatSessions.delete(req.params.userId);
    res.json({ cleared: true });
  });
}
