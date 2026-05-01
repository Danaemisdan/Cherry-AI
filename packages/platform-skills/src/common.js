import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATFORM_URLS = {
  instagram: 'https://www.instagram.com/',
  twitter: 'https://x.com/home',
  linkedin: 'https://www.linkedin.com/feed/',
  facebook: 'https://www.facebook.com/',
  gmail: 'https://mail.google.com/mail/u/0/#inbox',
  whatsapp: 'https://web.whatsapp.com/',
};

const PLATFORM_DOMAINS = {
  instagram: ['instagram.com'],
  twitter: ['x.com', 'twitter.com'],
  linkedin: ['linkedin.com'],
  facebook: ['facebook.com'],
  gmail: ['mail.google.com'],
  whatsapp: ['web.whatsapp.com'],
};

const SEARCH_SELECTORS = {
  instagram: ['input[placeholder="Search"]', 'input[aria-label*="Search"]', 'input[type="text"]'],
  twitter: ['input[data-testid="SearchBox_Search_Input"]', 'input[placeholder="Search"]'],
  linkedin: ['input.search-global-typeahead__input', 'input[placeholder="Search"]', 'input[role="combobox"]'],
  facebook: ['input[aria-label="Search Facebook"]', 'input[placeholder="Search Facebook"]', 'input[type="search"]'],
  gmail: ['input[placeholder*="Search mail"]', 'input[aria-label*="Search mail"]'],
  whatsapp: ['div[contenteditable="true"][data-tab="3"]', 'div[role="textbox"][contenteditable="true"]'],
};

const READY_SELECTORS = {
  instagram: ['nav', 'svg[aria-label="Home"]', 'a[href="/direct/inbox/"]'],
  twitter: ['a[data-testid="SideNav_NewTweet_Button"]', 'div[data-testid="primaryColumn"]', 'article[data-testid="tweet"]'],
  linkedin: ['input.search-global-typeahead__input', '.global-nav', '.scaffold-layout'],
  facebook: ['div[role="feed"]', 'input[aria-label="Search Facebook"]', '[aria-label="Facebook"]'],
  gmail: ['div[role="main"]', 'input[placeholder*="Search mail"]', 'div[gh="cm"]'],
  whatsapp: ['div[data-testid="chat-list"]', 'div[role="grid"]', 'footer div[contenteditable="true"]'],
};

const LOGIN_SELECTORS = {
  instagram: ['input[name="username"]', 'form button[type="submit"]'],
  twitter: ['input[autocomplete="username"]', 'input[name="text"]'],
  linkedin: ['input#username', 'input#password', 'button[type="submit"]'],
  facebook: ['input[name="email"]', 'input[name="pass"]'],
  gmail: ['input[type="email"]', 'input[type="password"]', '#identifierId'],
  whatsapp: ['canvas[aria-label*="Scan"]', 'div[data-ref] canvas'],
};

const LOGGED_OUT_TEXT = {
  instagram: ['log in', 'login'],
  twitter: ['sign in', 'log in'],
  linkedin: ['sign in', 'forgot password'],
  facebook: ['log in', 'password'],
  gmail: ['sign in', 'to continue to gmail'],
  whatsapp: ['scan to log in', 'log in with phone number'],
};

export function normalizeUsername(username = '') {
  return String(username).trim().replace(/^@+/, '');
}

export function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function unsupported(platform, action) {
  throw new Error(`${platform} does not support the "${action}" action in Cherry yet`);
}

export function buildSearchUrl(query, engine = 'google', domains = []) {
  const scopedQuery = domains.length ? `${query} ${domains.map((domain) => `site:${domain}`).join(' OR ')}` : query;
  if (engine === 'duckduckgo') {
    return `https://duckduckgo.com/?q=${encodeURIComponent(scopedQuery)}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(scopedQuery)}`;
}

export function buildPlatformTargetUrl(platform, username) {
  const handle = normalizeUsername(username);
  if (!handle) return PLATFORM_URLS[platform];

  if (platform === 'instagram') return `https://www.instagram.com/${handle}/`;
  if (platform === 'twitter') return `https://x.com/${handle}`;
  if (platform === 'linkedin') return handle.includes('linkedin.com') ? handle : `https://www.linkedin.com/in/${handle}/`;
  if (platform === 'facebook') return handle.startsWith('http') ? handle : `https://www.facebook.com/${handle}`;
  if (platform === 'gmail') return PLATFORM_URLS.gmail;
  if (platform === 'whatsapp') {
    const digits = handle.replace(/\D/g, '');
    return digits ? `https://web.whatsapp.com/send?phone=${digits}` : PLATFORM_URLS.whatsapp;
  }
  return PLATFORM_URLS[platform];
}

export function buildPlatformSearchUrl(platform, query) {
  if (!query) return PLATFORM_URLS[platform];
  if (platform === 'instagram') return `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}`;
  if (platform === 'twitter') return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query`;
  if (platform === 'linkedin') return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
  if (platform === 'facebook') return `https://www.facebook.com/search/top?q=${encodeURIComponent(query)}`;
  if (platform === 'gmail') return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
  if (platform === 'whatsapp') return PLATFORM_URLS.whatsapp;
  return PLATFORM_URLS[platform];
}

// Message variety helpers to prevent repetition
const VARIETY_TEMPLATES = {
  greetings: {
    casual: ['Hey', 'Hi', 'Hello', 'Hey there'],
    professional: ['Hi', 'Hello', 'Good to connect'],
    friendly: ['Hey', 'Hi there', 'Hey!'],
  },
  openingLines: {
    firstTime: [
      "Came across your profile and wanted to reach out",
      "Noticed your work and thought I'd connect",
      "Your profile caught my eye",
      "Found you through mutual interests",
      "Stumbled on your work and wanted to say hi",
    ],
    contextBased: [
      "Saw you're working on {context}",
      "Noticed your focus on {context}",
      "Your work in {context} stood out",
      "Interesting background in {context}",
    ],
  },
  followUp: [
    "Any thoughts on this?",
    "What do you think?",
    "Curious to hear your perspective",
    "Would love your take on this",
  ],
  meetingRequest: [
    "Open to a quick chat?",
    "Worth a brief conversation?",
    "Could be good to connect briefly",
    "Interested in a short call?",
  ],
  closings: {
    casual: ['', 'Thanks!', 'Chat soon', 'Talk soon'],
    professional: ['Best', 'Thanks', 'Looking forward to hearing from you'],
  },
};

// Random selection helper
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate a unique message signature based on timestamp and content hash
function getMessageSeed(username, goal) {
  const now = Date.now();
  const dayOfWeek = new Date().getDay();
  const hourOfDay = new Date().getHours();
  // Use time + username to create variety throughout the day
  return `${username}-${dayOfWeek}-${Math.floor(hourOfDay / 4)}-${Math.floor(now / 3600000)}`;
}

export function composeOutreachMessage({ username, goal, tone, query, chatContext = [], profileInfo = {} }) {
  const recipient = normalizeUsername(username);
  const objective = String(goal || 'start a useful conversation').trim();
  const context = String(query || '').trim();
  const style = String(tone || 'Casual and brief').trim().toLowerCase();
  const lowerObjective = objective.toLowerCase();
  const seed = getMessageSeed(username || '', goal || '');

  // Check for blocked content
  if (isBlockedOutreachGoal(`${objective} ${context}`)) {
    throw new Error('Cherry blocked this DM goal because it targets someone with a sexual insult or harassment. Use a non-abusive outreach goal.');
  }

  const lastMessage = chatContext.length > 0 ? chatContext[chatContext.length - 1] : null;
  const isReplying = lastMessage && lastMessage.role !== 'me';
  const isFirstTime = chatContext.length === 0;
  const hasContext = context && context.length > 5;
  const hasProfileInfo = profileInfo && (profileInfo.bio || profileInfo.recentPost);

  // Select greeting style
  let greetingStyle = 'casual';
  if (style.includes('formal') || style.includes('professional')) {
    greetingStyle = 'professional';
  } else if (style.includes('friendly') || style.includes('warm')) {
    greetingStyle = 'friendly';
  }

  // Build greeting
  const greetings = VARIETY_TEMPLATES.greetings[greetingStyle];
  const greeting = recipient
    ? `${pickRandom(greetings)} ${recipient},`
    : `${pickRandom(greetings)},`;

  // Build body based on context
  let body = '';

  if (isReplying && lastMessage) {
    // We're replying to their message - be conversational
    const theirMsg = lastMessage.text.slice(0, 50);
    const replyStarters = [
      `Thanks for that`,
      `Appreciate you sharing`,
      `Good point about ${theirMsg.slice(0, 20) || 'that'}`,
      `Interesting - ${theirMsg.slice(0, 20) || 'that'}`,
    ];
    body = pickRandom(replyStarters);

    // Add follow-up question based on goal
    if (/\b(meeting|call|chat|talk|connect|sync)\b/i.test(lowerObjective)) {
      body += `. ${pickRandom(VARIETY_TEMPLATES.meetingRequest)}`;
    } else {
      body += `. ${pickRandom(VARIETY_TEMPLATES.followUp)}`;
    }
  } else if (isFirstTime) {
    // First time message - use profile info or context
    if (hasProfileInfo && profileInfo.bio) {
      const bioSnippet = profileInfo.bio.slice(0, 40);
      body = `${pickRandom(VARIETY_TEMPLATES.openingLines.firstTime)}. ${bioSnippet ? `Love the focus on ${bioSnippet}.` : ''}`.trim();
    } else if (hasContext) {
      const contextLines = VARIETY_TEMPLATES.openingLines.contextBased;
      body = pickRandom(contextLines).replace('{context}', context.slice(0, 30));
    } else {
      body = pickRandom(VARIETY_TEMPLATES.openingLines.firstTime);
    }

    // Add meeting request if that's the goal
    if (/\b(meeting|call|chat|talk|connect|sync)\b/i.test(lowerObjective)) {
      body += ` ${pickRandom(VARIETY_TEMPLATES.meetingRequest)}`;
    } else if (/\b(question|ask|thoughts?|opinion)\b/i.test(lowerObjective)) {
      body += ` ${pickRandom(VARIETY_TEMPLATES.followUp)}`;
    }
  }

  // Add closing if style warrants it (not for very brief)
  let closing = '';
  if (!style.includes('brief') && !style.includes('short')) {
    const closings = VARIETY_TEMPLATES.closings[greetingStyle];
    closing = pickRandom(closings);
  }

  // Assemble final message
  const parts = [greeting, body, closing].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function isBlockedOutreachGoal(value) {
  const normalized = String(value || '').toLowerCase();
  return /\b(kill yourself|go die)\b/.test(normalized);
}

const nativeHostPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../native-host/llm-host.py');
let llmHostPromise = null;
let llmHost = null;
let llmMessageId = 0;

function buildOutreachPrompt({ username, goal, tone, query, platform, chatContext = [], profileInfo = {} }) {
  const recipient = normalizeUsername(username) || 'the recipient';
  const objective = String(goal || 'start a useful conversation').trim();
  const context = String(query || '').trim();
  const style = String(tone || 'Casual and brief').trim() || 'Casual and brief';

  // Determine if this is a reply or cold outreach
  const hasChatContext = chatContext && chatContext.length > 0;
  const lastMessage = hasChatContext ? chatContext[chatContext.length - 1] : null;
  const isReply = lastMessage && lastMessage.role !== 'me';

  // Build conversation history section - better formatting
  let chatHistorySection = '';
  if (hasChatContext) {
    const recentMessages = chatContext.slice(-6);
    chatHistorySection = `\n\nCONVERSATION HISTORY (most recent messages):\n${recentMessages.map((msg, i) => {
      const role = msg.role === 'me' ? 'Me' : 'Them';
      const text = msg.text?.slice(0, 250) || '';
      return `${role}: "${text}${msg.text?.length > 250 ? '...' : ''}"`;
    }).join('\n')}`;
  }

  // Profile info section
  let profileSection = '';
  if (profileInfo && (profileInfo.bio || profileInfo.recentPost)) {
    profileSection = `\n\nRECIPIENT PROFILE INFO:\n${profileInfo.bio ? `Bio: ${profileInfo.bio.slice(0, 100)}` : ''}${profileInfo.recentPost ? `\nRecent post: ${profileInfo.recentPost.slice(0, 100)}` : ''}`;
  }

  // Different instructions based on reply vs cold outreach
  if (isReply) {
    return `You are replying to a conversation with ${recipient} on ${platform}.

YOUR TASK: Write a natural, conversational reply to their last message.

CONTEXT:${chatHistorySection}

INSTRUCTIONS FOR REPLYING:
- Read the conversation history carefully
- Reply naturally to what they said in their LAST message
- Use the SAME LANGUAGE they used (English, Hindi, Telugu, Tinglish, etc.)
- Be conversational - like texting a friend
- Reference their specific points briefly, don't just say "that's interesting"
- Keep it 1-2 short sentences
- If they asked a question, answer it or acknowledge it
- Match their energy and tone
- NO generic phrases like "Good point about [quote]" or "Interesting - [quote]"
- Instead, actually respond to the substance of what they said

STYLE: ${style}

STRICT RULES:
- Return ONLY the reply message - no labels, no quotes, no explanations
- Write in the language of the conversation
- Sound like a real person texting, not a bot
- 1-2 sentences max
- NO hashtags
- Max 1 emoji if it fits naturally

Write your reply now:`;
  }

  // Cold outreach prompt
  return `You are writing an initial message to ${recipient} on ${platform}.

YOUR GOAL: ${objective}
${context ? `\nCONTEXT TO INCLUDE: ${context}` : ''}${profileSection}

INSTRUCTIONS:
- Write a natural, friendly first message
- Be genuine and specific - avoid generic fluff like "I came across your profile"
- 1-2 short sentences
- Sound like a real person, not a sales template
- NO "Hey [name], I came across your profile and..." - that's too common
- Instead, be direct and natural

STYLE: ${style}

STRICT RULES:
- Return ONLY the message text - no labels, no quotes
- Write proper English (no "u" for "you")
- NO hashtags
- Max 1 emoji
- 1-2 sentences max

Write the message now:`;
}

function sanitizeGeneratedMessage(rawText) {
  let text = String(rawText || '').replace(/\r/g, '').trim();
  if (!text) return '';

  const finalMarker = text.match(/(?:^|\n)(?:final message|dm)\s*:\s*([\s\S]*)$/i);
  if (finalMarker?.[1]) {
    text = finalMarker[1].trim();
  }

  text = text
    .replace(/<\|[^>]+?\|>/g, ' ')
    .replace(/<start_of_turn>|<end_of_turn>/g, ' ')
    .replace(/\b(user|assistant|model)\s*:/gi, ' ')
    .replace(/\bsender'?s reply\s*:/gi, ' ')
    .replace(/\breply\s*:/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const badFragments = [
    'return only the final message text',
    'write exactly one',
    'goal from the ui:',
    'tone from the ui:',
    'extra context from the ui:',
    'rules:',
    'final message:',
  ];

  const filtered = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !badFragments.some((fragment) => line.toLowerCase().includes(fragment)))
    .filter((line) => !line.startsWith('-'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const firstChunk = filtered
    .split(/(?:sender'?s reply:|reply:)/i)[0]
    .split(/(?:\s{2,}|\n)/)[0]
    .trim();

  return firstChunk.replace(/^['"\s]+|['"\s]+$/g, '').trim();
}

function looksLikePromptLeak(text) {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) return true;
  return [
    'goal from the ui:',
    'tone from the ui:',
    'rules:',
    'write exactly one',
    'final message:',
    'return only the final message text',
    "sender's reply",
    'reply:',
  ].some((fragment) => normalized.includes(fragment));
}

function isLowQualityOutreachMessage(text) {
  const value = String(text || '').trim();
  if (!value) return true;

  // Allow longer messages for proper context (was 220, now 350)
  if (value.length > 350) return true;
  // Allow up to 3 sentences
  const sentenceParts = value.split(/[.!?]+/).map(p => p.trim()).filter(Boolean);
  if (sentenceParts.length > 3) return true;

  const emojiMatches = value.match(/[\p{Extended_Pictographic}]/gu) || [];
  const hashtagMatches = value.match(/#[\p{L}\p{N}_]+/gu) || [];

  if (emojiMatches.length > 2) return true;
  if (hashtagMatches.length > 0) return true;
  if (/(.){4,}/.test(value)) return true;
  if (/\b(sender'?s reply|reply:|final message:)\b/i.test(value)) return true;

  // Check if it's just the goal text being echoed back
  const lower = value.toLowerCase();
  const goalEchoPatterns = [
    'just say something interesting',
    'say something interesting',
    'goal:',
    'your goal is',
  ];
  if (goalEchoPatterns.some(p => lower.includes(p))) return true;

  return false;
}

async function connectLocalLlmHost() {
  if (llmHost) return llmHost;
  if (llmHostPromise) return llmHostPromise;

  llmHostPromise = new Promise((resolve, reject) => {
    const child = spawn('python3', [nativeHostPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdoutBuffer = Buffer.alloc(0);
    let stderrBuffer = '';
    const callbacks = new Map();

    const failAll = (error) => {
      for (const callback of callbacks.values()) {
        callback.reject(error);
      }
      callbacks.clear();
    };

    child.stdout.on('data', (chunk) => {
      stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
      while (stdoutBuffer.length >= 4) {
        const messageLength = stdoutBuffer.readUInt32LE(0);
        if (stdoutBuffer.length < 4 + messageLength) break;
        const raw = stdoutBuffer.slice(4, 4 + messageLength).toString('utf8');
        stdoutBuffer = stdoutBuffer.slice(4 + messageLength);

        let message = null;
        try {
          message = JSON.parse(raw);
        } catch {
          continue;
        }

        const pending = callbacks.get(message.id);
        if (!pending) continue;
        callbacks.delete(message.id);

        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(String(message.text || ''));
        }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString('utf8');
    });

    child.once('spawn', () => {
      llmHost = {
        child,
        async generate(prompt, maxTokens = 120, temperature = 0.75) {
          const id = String(++llmMessageId);
          const payload = Buffer.from(JSON.stringify({
            id,
            prompt,
            max_tokens: maxTokens,
            temperature,
            stop_words: ['</s>', '<|user|>', '<|assistant|>', '<start_of_turn>', '<end_of_turn>', 'Final message:'],
          }), 'utf8');
          const header = Buffer.alloc(4);
          header.writeUInt32LE(payload.length, 0);

          return new Promise((resolveMessage, rejectMessage) => {
            const timeout = setTimeout(() => {
              callbacks.delete(id);
              rejectMessage(new Error('Local LLM timed out'));
            }, 20000);

            callbacks.set(id, {
              resolve: (value) => {
                clearTimeout(timeout);
                resolveMessage(value);
              },
              reject: (error) => {
                clearTimeout(timeout);
                rejectMessage(error);
              },
            });

            child.stdin.write(Buffer.concat([header, payload]));
          });
        },
      };

      resolve(llmHost);
    });

    child.once('error', (error) => {
      llmHost = null;
      llmHostPromise = null;
      reject(error);
    });

    child.once('exit', () => {
      const error = new Error(stderrBuffer.trim() || 'Local LLM host exited');
      failAll(error);
      llmHost = null;
      llmHostPromise = null;
    });
  });

  return llmHostPromise;
}

export async function generateOutreachMessage({ username, goal, tone, query, platform = 'social', chatContext = [], profileInfo = {} }) {
  if (isBlockedOutreachGoal(`${goal || ''} ${query || ''}`)) {
    throw new Error('Cherry blocked this DM goal because it targets someone with a sexual insult or harassment. Use a non-abusive outreach goal.');
  }

  // For replies with chat context, ALWAYS use LLM - never templates
  const hasChatContext = chatContext && chatContext.length > 0;
  const isReply = hasChatContext && chatContext[chatContext.length - 1]?.role !== 'me';

  // Build the proper prompt
  const prompt = buildOutreachPrompt({ username, goal, tone, query, platform, chatContext, profileInfo });

  try {
    const host = await connectLocalLlmHost();
    // Higher temperature for more variety, longer max tokens for context understanding
    const generated = sanitizeGeneratedMessage(await host.generate(prompt, hasChatContext ? 200 : 120, 0.85));

    if (!generated || looksLikePromptLeak(generated)) {
      // Only use fallback for cold outreach, not replies
      if (!isReply) {
        return composeOutreachMessage({ username, goal, tone, query, chatContext, profileInfo });
      }
      // For replies, generate a simple contextual response
      const lastMsg = chatContext[chatContext.length - 1]?.text?.slice(0, 30) || 'that';
      return `Thanks for sharing. ${lastMsg ? `About ${lastMsg}... ` : ''}Would love to continue this conversation.`;
    }

    return generated;
  } catch (error) {
    // Only use fallback for cold outreach, not replies
    if (!isReply) {
      return composeOutreachMessage({ username, goal, tone, query, chatContext, profileInfo });
    }
    // Simple fallback for replies
    const lastMsg = chatContext[chatContext.length - 1]?.text?.slice(0, 30) || 'that';
    return `Thanks for your message about ${lastMsg}. Let's chat more about this.`;
  }
}

export function composeComment({ tone, goal }) {
  const style = String(tone || 'Casual and brief').trim().toLowerCase();
  const objective = String(goal || 'start a conversation').trim();
  if (style.includes('brief')) return `Sharp post. ${objective}.`;
  return `This is well put together. ${objective}.`;
}

export function composePost({ platform, goal, tone, query }) {
  const objective = String(goal || `share an update on ${platform}`).trim();
  const prompt = String(query || '').trim();
  const style = String(tone || 'Clear and concise').trim();
  return `${objective}${prompt ? `\n\nContext: ${prompt}` : ''}\n\nTone: ${style}`;
}

function normalizeComparableUrl(url = '') {
  return String(url).replace(/\/+$/, '');
}

function currentHostname(url = '') {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function pageMatchesPlatform(url, platform) {
  const hostname = currentHostname(url);
  return (PLATFORM_DOMAINS[platform] || []).some((domain) => hostname.includes(domain));
}

export async function waitForAppShell(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
}

export async function bodyText(page) {
  return page.locator('body').innerText().catch(() => '');
}

export async function pageSnapshot(page) {
  return {
    title: await page.title().catch(() => ''),
    url: page.url(),
    text: (await bodyText(page)).slice(0, 12000),
  };
}

export async function firstVisibleLocator(page, selectors = []) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

export async function firstWorkingLocator(page, selectors = []) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) return locator;
  }
  return null;
}

async function detectPlatformLoginState(page, platform) {
  const loginLocator = await firstVisibleLocator(page, LOGIN_SELECTORS[platform] || []);
  if (loginLocator) {
    return { loggedIn: false, reason: `${platform} requires login in this Cherry browser profile` };
  }

  const body = (await bodyText(page)).toLowerCase();
  const loggedOutText = (LOGGED_OUT_TEXT[platform] || []).find((snippet) => body.includes(snippet));
  if (loggedOutText) {
    return { loggedIn: false, reason: `${platform} requires login in this Cherry browser profile` };
  }

  const readyLocator = await firstVisibleLocator(page, READY_SELECTORS[platform] || []);
  if (readyLocator) {
    return { loggedIn: true, reason: '' };
  }

  return { loggedIn: true, reason: '' };
}

export async function ensurePlatformReady(page, platform) {
  await waitForAppShell(page);
  const loginState = await detectPlatformLoginState(page, platform);
  if (!loginState.loggedIn) {
    throw new Error(`${loginState.reason}. Sign in once inside the Cherry debug profile, then retry.`);
  }

  const readySelectors = READY_SELECTORS[platform] || [];
  if (!readySelectors.length) return;

  const ready = await firstVisibleLocator(page, readySelectors);
  if (ready) return;

  for (const selector of readySelectors) {
    const locator = page.locator(selector).first();
    const visible = await locator.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
    if (visible) return;
  }
}

export async function navigate(page, url, platform) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (platform) {
    await ensurePlatformReady(page, platform);
  } else {
    await waitForAppShell(page);
  }
}

export async function tryClick(page, selectors = []) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 3000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

export async function clickByText(page, selectors, labels = []) {
  for (const selector of selectors) {
    for (const label of labels) {
      const locator = page.locator(selector, { hasText: label }).first();
      if (await locator.count().catch(() => 0)) {
        await locator.click({ timeout: 3000 }).catch(() => {});
        return true;
      }
    }
  }
  return false;
}

export async function fillEditable(page, selectors = [], value = '', options = {}) {
  const { humanLike = true, typingSpeed = 'fast' } = options;

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click();
      await page.waitForTimeout(100);

      if (humanLike && value.length > 10) {
        // Human-like typing with variable speed and occasional mistakes
        const chars = value.split('');
        let typed = '';

        for (let i = 0; i < chars.length; i++) {
          const char = chars[i];

          // Variable delay based on typing speed
          let delay;
          if (typingSpeed === 'fast') {
            delay = Math.random() * 30 + 10; // 10-40ms
          } else if (typingSpeed === 'normal') {
            delay = Math.random() * 80 + 40; // 40-120ms
          } else {
            delay = Math.random() * 150 + 80; // 80-230ms
          }

          // Occasionally pause longer (thinking)
          if (Math.random() < 0.05) {
            delay += Math.random() * 200 + 100;
          }

          // Very rare typo and backspace (1% chance)
          if (Math.random() < 0.01 && i > 3 && /[a-z]/i.test(char)) {
            // Type wrong character
            const wrongChar = String.fromCharCode(char.charCodeAt(0) + (Math.random() < 0.5 ? 1 : -1));
            await locator.type(wrongChar, { delay: delay / 2 });
            await page.waitForTimeout(delay);
            // Backspace it
            await locator.press('Backspace');
            await page.waitForTimeout(delay);
          }

          await locator.type(char, { delay });
          typed += char;
        }
      } else {
        await page.keyboard.press(`${modifier}+a`).catch(() => {});
        await page.keyboard.press('Backspace').catch(() => {});
        await locator.evaluate((element) => {
          if (element.isContentEditable) {
            element.textContent = '';
          }
        }).catch(() => {});
        await locator.type(value, { delay: 18 }).catch(() => {});
      }
      return { ok: true, selector };
    }
  }
  return { ok: false, selector: '' };
}

export async function submitComposer(page, selectors = [], labels = [], options = {}) {
  const { waitForEnabled = true, timeout = 5000 } = options;

  // Platform-specific button selectors if none provided
  const defaultSelectors = [
    'button[type="submit"]:not([disabled])',
    'button:has-text("Post"):not([disabled])',
    'button:has-text("Send"):not([disabled])',
    'button:has-text("Message"):not([disabled])',
    'div[role="button"]:has-text("Post"):not([aria-disabled="true"])',
    'div[role="button"]:has-text("Send"):not([aria-disabled="true"])',
    '[data-testid="tweetButtonInline"]:not([disabled])',
    '[data-testid="tweetButton"]:not([disabled])',
    '[data-testid="send-button"]:not([disabled])',
    '[aria-label*="Post"]:not([disabled])',
    '[aria-label*="Send"]:not([disabled])',
  ];

  const allSelectors = [...selectors, ...defaultSelectors];

  // Try clicking by selector first
  for (const selector of allSelectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.count().catch(() => 0)) {
        // Wait for button to be enabled if needed
        if (waitForEnabled) {
          await locator.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
        }
        await locator.click({ timeout: 3000 });
        await page.waitForTimeout(500); // Brief pause after click
        return true;
      }
    } catch { /* try next */ }
  }

  // Fallback: try clicking by text labels
  const textLabels = [...labels, 'Post', 'Send', 'Message', 'Tweet', 'Share'];
  for (const label of textLabels) {
    try {
      const locator = page.locator(`button:has-text("${label}"):not([disabled]), div[role="button"]:has-text("${label}"):not([aria-disabled="true"])`).first();
      if (await locator.count().catch(() => 0)) {
        await locator.click({ timeout: 3000 });
        await page.waitForTimeout(500);
        return true;
      }
    } catch { /* try next */ }
  }

  return false;
}

export async function openAttachedPage(attachedBrowser, url, { platform, forceNavigate = false } = {}) {
  let page = null;
  if (platform) {
    page = await attachedBrowser.findPage((candidate) => pageMatchesPlatform(candidate.url(), platform));
  }

  if (!page) {
    page = await attachedBrowser.getOrCreatePage({ url });
  }

  await page.bringToFront().catch(() => {});

  const currentUrl = normalizeComparableUrl(page.url());
  const targetUrl = normalizeComparableUrl(url);
  if (forceNavigate || !currentUrl || currentUrl !== targetUrl) {
    await navigate(page, url, platform);
  } else if (platform) {
    await ensurePlatformReady(page, platform);
  }

  return page;
}

export async function openSearchSurface(page, platform, query) {
  await navigate(page, buildPlatformSearchUrl(platform, query), platform);
  const searchBox = await firstWorkingLocator(page, SEARCH_SELECTORS[platform] || []);
  if (searchBox && platform !== 'instagram' && platform !== 'gmail') {
    await searchBox.click({ timeout: 3000 }).catch(() => {});
  }
  return page;
}

export async function scrapeGoogleResults(attachedBrowser, { query, platform, maxResults }) {
  const url = buildSearchUrl(query || 'lead generation', 'google', platform === 'research' ? [] : (PLATFORM_DOMAINS[platform] || []));
  const page = await openAttachedPage(attachedBrowser, url, { forceNavigate: true });
  await waitForAppShell(page);

  const results = await page.evaluate((limit) => {
    const cards = Array.from(document.querySelectorAll('a[href]'));
    const items = [];
    for (const link of cards) {
      const titleNode = link.querySelector('h3') || link;
      const title = titleNode.textContent?.trim();
      const href = link.href;
      if (!title || !href || href.startsWith('javascript:')) continue;
      const container = link.closest('div');
      const snippet = container?.innerText?.trim() || '';
      items.push({ title, url: href, snippet: snippet.slice(0, 400) });
      if (items.length >= limit) break;
    }
    return items;
  }, Math.max(1, Math.min(Number(maxResults) || 10, 25)));

  return {
    page,
    results: uniq(results.map((item) => JSON.stringify(item))).map((item) => JSON.parse(item)),
  };
}

export async function scrapePlatformProfiles(page, platform, maxResults) {
  await ensurePlatformReady(page, platform);
  return page.evaluate(({ currentPlatform, limit }) => {
    const clean = (value) => String(value || '').trim();
    const addUnique = (list, next) => {
      if (!next?.url) return;
      if (list.some((item) => item.url === next.url)) return;
      list.push(next);
    };

    const output = [];
    const anchors = Array.from(document.querySelectorAll('a[href]'));

    for (const anchor of anchors) {
      const href = anchor.href;
      const text = clean(anchor.textContent);
      if (!href || !text) continue;

      if (currentPlatform === 'instagram' && /instagram\.com\/[^/]+\/?$/.test(href) && !href.includes('/explore/')) addUnique(output, { title: text, url: href, snippet: text });
      if (currentPlatform === 'twitter' && /x\.com\/[^/]+\/?$/.test(href) && !href.includes('/search')) addUnique(output, { title: text, url: href, snippet: text });
      if (currentPlatform === 'linkedin' && href.includes('/in/')) addUnique(output, { title: text, url: href.split('?')[0], snippet: text });
      if (currentPlatform === 'facebook' && href.includes('facebook.com') && !href.includes('/share')) addUnique(output, { title: text, url: href, snippet: text });
      if (currentPlatform === 'gmail' && anchor.closest('[role="main"]')) addUnique(output, { title: text, url: href, snippet: anchor.closest('[role="main"]')?.innerText?.slice(0, 400) || text });
      if (currentPlatform === 'whatsapp' && anchor.closest('[role="grid"]')) addUnique(output, { title: text, url: href, snippet: anchor.closest('[role="grid"]')?.innerText?.slice(0, 400) || text });
      if (output.length >= limit) break;
    }

    return output;
  }, { currentPlatform: platform, limit: Math.max(1, Math.min(Number(maxResults) || 10, 25)) });
}

export async function openTargetPage(attachedBrowser, { platform, username }) {
  return openAttachedPage(attachedBrowser, buildPlatformTargetUrl(platform, username), { platform, forceNavigate: true });
}

export async function reviewQueue(attachedBrowser, platform) {
  const url = platform === 'gmail'
    ? PLATFORM_URLS.gmail
    : platform === 'whatsapp'
      ? PLATFORM_URLS.whatsapp
      : buildPlatformSearchUrl(platform, 'inbox');
  return { page: await openAttachedPage(attachedBrowser, url, { platform }) };
}

export async function runBatchAction(step, handler) {
  const usernames = uniq(step.args.usernames || []).slice(0, Math.max(1, Math.min(Number(step.args.maxResults) || 15, 25)));
  const outputs = [];
  for (const username of usernames) {
    outputs.push(await handler(username));
  }
  return outputs;
}

export function summarizeAction(platform, step, detail = {}) {
  const query = step.args.query || step.args.prompt || '';
  const username = step.args.username ? ` @${normalizeUsername(step.args.username)}` : '';
  const count = Array.isArray(step.args.usernames) ? step.args.usernames.length : 0;

  if (step.action === 'open_workspace') return `Opened ${platform} workspace`;
  if (step.action === 'search') return `Opened ${platform} search for "${query}"`;
  if (step.action === 'scrape_results') return `Collected visible ${platform} search results for "${query}"`;
  if (step.action === 'open_target') return `Opened${username} on ${platform}`;
  if (step.action === 'draft_message') return `Prepared message draft${username} on ${platform}`;
  if (step.action === 'send_message') return detail.sent ? `Sent message${username} on ${platform}` : `Drafted message${username} on ${platform}`;
  if (step.action === 'message_batch') return `${detail.sent ? 'Processed' : 'Prepared'} ${count} ${platform} message targets one by one`;
  if (step.action === 'engage_post') return detail.sent ? `Engaged with latest post${username} on ${platform}` : `Drafted engagement${username} on ${platform}`;
  if (step.action === 'follow_user') return detail.clicked ? `Triggered follow/connect${username} on ${platform}` : `Could not find follow control${username} on ${platform}`;
  if (step.action === 'engage_batch') return `Processed ${count} ${platform} engagement targets`;
  if (step.action === 'follow_batch') return `Processed ${count} ${platform} follow targets`;
  if (step.action === 'compose_post') return `Opened ${platform} composer`;
  if (step.action === 'publish_post') return detail.sent ? `Submitted ${platform} post` : `Drafted ${platform} post`;
  if (step.action === 'review_queue') return `Opened ${platform} queue`;
  if (step.action === 'continue_outreach') return `Opened ${platform} outreach surface`;
  if (step.action === 'open_result') return `Opened search results for "${query}"`;
  if (step.action === 'extract_context') return `Captured page context for "${query}"`;
  if (step.action === 'export_artifact') return `Prepared artifact output`;
  return `Completed ${platform}:${step.action}`;
}

export { PLATFORM_URLS, PLATFORM_DOMAINS, SEARCH_SELECTORS, READY_SELECTORS };

// Re-export new capabilities
export { checkLoginState, ensurePlatformReadyWithState } from './state-checker.js';
export { extractChatContext } from './chat-context.js';
export { createLinkedInPost, searchLinkedInJobs, applyToLinkedInJob, searchLinkedInCompanies, extractLinkedInCompanyDetails, advancedLinkedInSearch } from './expanded-linkedin.js';
export { extractContactInfo, bulkExtractContacts } from './lead-extractor.js';
export { createPost, createStory, schedulePost } from './content-poster.js';
export { MultiTabController, BackgroundScheduler } from './multi-tab.js';
