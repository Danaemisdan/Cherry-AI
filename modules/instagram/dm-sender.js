import CDPController from '../../background/cdp-controller.js';
import StealthEngine from '../../background/stealth-engine.js';
import LLMClient from '../../background/llm-client.js';

const INSTAGRAM_HOME_URL = 'https://www.instagram.com/';
const INSTAGRAM_SEARCH_URL = 'https://www.instagram.com/explore/search/';
const INSTAGRAM_INBOX_URL = 'https://www.instagram.com/direct/inbox/';

function normalizeUsername(username) {
  return String(username || '').trim().replace(/^@+/, '');
}

function sanitizeGoal(goal) {
  const rawGoal = String(goal || '').trim();
  if (!rawGoal) {
    return 'start a normal conversation';
  }

  const abusivePattern = /\b(fuck|shit|bitch|idiot|moron|loser|kill yourself|hate you|go die)\b/i;
  if (abusivePattern.test(rawGoal)) {
    throw new Error('Abusive DM goals are blocked. Enter a non-abusive outreach goal.');
  }

  return rawGoal;
}

function buildMessagePrompt({ username, profileData, goal, tonePrompt }) {
  const normalizedGoal = sanitizeGoal(goal);
  const normalizedTone = String(tonePrompt || 'Casual and brief').trim() || 'Casual and brief';
  const displayName = String(profileData.displayName || '').trim();
  const openingName = displayName && displayName.toLowerCase() !== username.toLowerCase()
    ? displayName
    : `@${username}`;
  const styles = [
    'open warm and curious',
    'sound lightly playful but grounded',
    'keep it low-pressure and conversational',
    'sound confident without sounding salesy',
    'make it feel spontaneous and personal'
  ];
  const styleHint = styles[Math.floor(Math.random() * styles.length)];

  return `Write exactly one Instagram DM message.

Return only the final DM text.
Do not include instructions, labels, bullet points, notes, or quotation marks.

Recipient handle: @${username}
Opening name to use at the start: ${openingName}
Goal from the UI: ${normalizedGoal}
Tone from the UI: ${normalizedTone}
Style hint: ${styleHint}

Use only these profile facts:
Display name: ${displayName || 'Not available'}
Bio: ${profileData.bio || 'Not available'}
Recent post clues: ${(profileData.recentPosts || []).length ? profileData.recentPosts.join(' | ') : 'Not available'}

Rules:
- max 2 short sentences
- human and specific
- no marketing language
- no copy-paste feel
- no emojis unless natural
- no clichés like "hope you're doing well", "just came across your profile", or "would love to connect"
- if profile facts are missing, do not invent them

DM:`;
}

function sanitizeGeneratedMessage(rawText) {
  let text = String(rawText || '').replace(/\r/g, '').trim();

  if (!text) {
    return '';
  }

  const dmMarker = text.match(/(?:^|\n)DM:\s*([\s\S]*)$/i);
  if (dmMarker?.[1]) {
    text = dmMarker[1].trim();
  }

  text = text
    .replace(/<\|[^>]+?\|>/g, ' ')
    .replace(/<start_of_turn>|<end_of_turn>/g, ' ')
    .replace(/\b(user|assistant|model)\s*:/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const badFragments = [
    'constraints:',
    'profile context:',
    'use only these profile facts:',
    'goal from the ui:',
    'tone from the ui:',
    'style hint:',
    'rules:',
    'return only the final dm text',
    'write exactly one instagram dm message',
  ];

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !badFragments.some((fragment) => line.toLowerCase().includes(fragment)))
    .filter((line) => !line.startsWith('-'));

  text = lines.join(' ').replace(/\s+/g, ' ').trim();

  const sentenceMatch = text.match(/(.+?[.!?])(?:\s+.+?[.!?])?/);
  if (sentenceMatch?.[0]) {
    text = sentenceMatch[0].trim();
  }

  text = text.replace(/^['"\s]+|['"\s]+$/g, '').trim();
  return text;
}

function normalizeForCompare(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][a-z0-9._]+/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordSet(value) {
  return new Set(
    normalizeForCompare(value)
      .split(' ')
      .filter((word) => word.length > 2)
  );
}

function overlapRatio(a, b) {
  const aWords = wordSet(a);
  const bWords = wordSet(b);
  if (!aWords.size || !bWords.size) return 0;

  let overlap = 0;
  for (const word of aWords) {
    if (bWords.has(word)) overlap++;
  }
  return overlap / Math.min(aWords.size, bWords.size);
}

function extractProfileHook(profileData) {
  const source = [
    profileData.displayName || '',
    profileData.bio || '',
    ...(profileData.recentPosts || [])
  ].join(' ');
  const lower = source.toLowerCase();
  const hooks = [
    ['tech', 'tech'],
    ['programming', 'programming'],
    ['developer', 'development'],
    ['design', 'design'],
    ['designer', 'design'],
    ['illustrator', 'illustration'],
    ['art', 'art'],
    ['music', 'music'],
    ['fitness', 'fitness'],
    ['fashion', 'fashion'],
    ['travel', 'travel'],
    ['food', 'food'],
    ['founder', 'what you are building'],
    ['startup', 'what you are building'],
    ['marketing', 'marketing'],
    ['ai', 'AI'],
    ['creator', 'your content'],
  ];

  const matches = hooks
    .filter(([needle]) => lower.includes(needle))
    .map(([, label]) => label);
  return [...new Set(matches)].slice(0, 2).join(' and ') || 'your profile';
}

function buildDeterministicMessage({ username, profileData, goal, tonePrompt }) {
  const normalizedGoal = sanitizeGoal(goal);
  const tone = String(tonePrompt || '').toLowerCase();
  const displayName = String(profileData.displayName || '').trim();
  const name = displayName && displayName.toLowerCase() !== username.toLowerCase()
    ? displayName.split(/[|•(@]/)[0].trim().split(/\s+/).slice(0, 2).join(' ')
    : `@${username}`;
  const hook = extractProfileHook(profileData);
  const brief = tone.includes('brief') || tone.includes('casual');
  const asks = normalizedGoal.toLowerCase().includes('meeting') || normalizedGoal.toLowerCase().includes('call')
    ? [
        'Open to a quick chat this week?',
        'Would a quick call make sense?',
        'Could we set up a short chat?'
      ]
    : [
        `Wanted to reach out about ${normalizedGoal}.`,
        `I had a quick thought around ${normalizedGoal}.`,
        `I think there may be a useful angle around ${normalizedGoal}.`
      ];
  const openers = brief
    ? [
        `Hey ${name}, noticed your work around ${hook}.`,
        `Hey ${name}, your ${hook} angle caught my eye.`,
        `Hey ${name}, liked the focus on ${hook}.`
      ]
    : [
        `Hi ${name}, I was looking at your profile and the ${hook} stood out.`,
        `Hi ${name}, your profile around ${hook} caught my attention.`,
        `Hi ${name}, I noticed the ${hook} focus on your profile.`
      ];

  const opener = openers[Math.floor(Math.random() * openers.length)];
  const ask = asks[Math.floor(Math.random() * asks.length)];
  return `${opener} ${ask}`;
}

function looksLikeBadDM(text, { username, profileData, goal }) {
  const normalized = String(text || '').replace(/[’‘]/g, "'").toLowerCase();
  if (!normalized) {
    return true;
  }

  const markers = [
    'constraints:',
    'profile context:',
    'goal from the ui:',
    'tone from the ui:',
    'write exactly one instagram dm',
    'use only these profile facts',
    'rules:',
  ];

  if (markers.some((marker) => normalized.includes(marker))) return true;
  if (normalized.length < 18 || normalized.length > 320) return true;
  if (/\b(my name is|i am|i'm)\s+@?[a-z0-9._]+/i.test(normalized)) return true;
  const escapedUsername = escapeRegExp(normalizeUsername(username).toLowerCase());
  if (new RegExp(`\\b(my name is|i am|i'm)\\s+@?${escapedUsername}\\b`, 'i').test(normalized)) return true;
  if (/\b(i am|i'm)\s+(a|an|the)\s+\d{1,2}[- ]?year[- ]?old\b/i.test(normalized)) return true;
  if (/\bnot a fan of the term ['"]?clich/i.test(normalized)) return true;

  const bio = String(profileData?.bio || '').trim();
  if (bio) {
    const cleanMessage = normalizeForCompare(text);
    const cleanBio = normalizeForCompare(bio);
    if (cleanBio.length > 35 && cleanMessage.includes(cleanBio.slice(0, 80))) return true;
    if (overlapRatio(text, bio) > 0.68) return true;
  }

  const normalizedGoal = normalizeForCompare(goal);
  if (normalizedGoal.includes('meeting') && !/\b(chat|call|meeting|talk|connect)\b/i.test(text)) {
    return true;
  }

  return false;
}

async function generateDirectMessage({ prompt, fallbackPrompt, username, profileData, goal, tonePrompt }) {
  try {
    let messageText = sanitizeGeneratedMessage(await LLMClient.generate(prompt, 90, 0.7));
    if (!looksLikeBadDM(messageText, { username, profileData, goal })) {
      return messageText;
    }

    messageText = sanitizeGeneratedMessage(await LLMClient.generate(fallbackPrompt, 70, 0.55));
    if (!looksLikeBadDM(messageText, { username, profileData, goal })) {
      return messageText;
    }
  } catch (err) {
    console.log('[Cherry IG] LLM DM generation failed, using guarded fallback:', err.message);
  }

  return buildDeterministicMessage({ username, profileData, goal, tonePrompt });
}

async function evalOnPage(tabId, expression) {
  return CDPController.sendCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true
  });
}

async function openInstagramHome(tabId) {
  await StealthEngine.applySpoofing(tabId);
  await CDPController.sendCommand(tabId, 'Page.navigate', { url: INSTAGRAM_HOME_URL });
  await StealthEngine.waitForPageLoad(tabId);
  await StealthEngine.sleep(4000);
}

async function openInstagramSearch(tabId) {
  await openInstagramHome(tabId);

  const searchIconEval = await evalOnPage(tabId, `
    (() => {
      const candidates = Array.from(document.querySelectorAll('a[href], div[role="button"], button'));
      const scored = [];

      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 16 || rect.height < 16) continue;
        const style = window.getComputedStyle(el);
        if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;

        const descendantLabels = Array.from(el.querySelectorAll('[aria-label], svg[aria-label]'))
          .map((node) => node.getAttribute('aria-label') || '')
          .join(' ');
        const meta = [
          el.getAttribute('aria-label') || '',
          el.textContent || '',
          el.getAttribute('href') || '',
          descendantLabels
        ].join(' ').toLowerCase();

        let score = 0;
        if (meta.includes('search')) score += 100;
        if (meta.includes('/explore/search') || meta.includes('/explore/')) score += 70;
        if (rect.x < 140) score += 15;
        if (rect.y > 120 && rect.y < 520) score += 10;
        if (score <= 0) continue;

        scored.push({
          score,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2)
        });
      }

      scored.sort((a, b) => b.score - a.score);
      return scored[0] || null;
    })();
  `);

  if (searchIconEval.result?.value) {
    await StealthEngine.organicClick(tabId, searchIconEval.result.value.x, searchIconEval.result.value.y);
    await StealthEngine.sleep(2000);
    return;
  }

  await CDPController.sendCommand(tabId, 'Page.navigate', { url: INSTAGRAM_SEARCH_URL });
  await StealthEngine.waitForPageLoad(tabId);
  await StealthEngine.sleep(2500);
}

async function clickMessagesNav(tabId) {
  const navEval = await evalOnPage(tabId, `
    (() => {
      const candidates = Array.from(document.querySelectorAll('a[href], div[role="button"], button'));
      const scored = [];

      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 16 || rect.height < 16) continue;
        const style = window.getComputedStyle(el);
        if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;

        const descendantLabels = Array.from(el.querySelectorAll('[aria-label], svg[aria-label]'))
          .map((node) => node.getAttribute('aria-label') || '')
          .join(' ');
        const meta = [
          el.getAttribute('aria-label') || '',
          el.textContent || '',
          el.getAttribute('href') || '',
          descendantLabels
        ].join(' ').toLowerCase();

        let score = 0;
        if (meta.includes('/direct/inbox')) score += 120;
        if (meta.includes('messages') || meta.includes('message')) score += 80;
        if (rect.x < 180 || rect.x > window.innerWidth * 0.7) score += 10;
        if (score <= 0) continue;

        scored.push({
          score,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2)
        });
      }

      scored.sort((a, b) => b.score - a.score);
      return scored[0] || null;
    })();
  `);

  if (navEval.result?.value) {
    await StealthEngine.organicClick(tabId, navEval.result.value.x, navEval.result.value.y);
    await StealthEngine.sleep(3500);
    return;
  }

  await CDPController.sendCommand(tabId, 'Page.navigate', { url: INSTAGRAM_INBOX_URL });
  await StealthEngine.waitForPageLoad(tabId);
  await StealthEngine.sleep(2500);
}

async function openInstagramInbox(tabId) {
  await StealthEngine.applySpoofing(tabId);
  await CDPController.sendCommand(tabId, 'Page.navigate', { url: INSTAGRAM_INBOX_URL });
  await StealthEngine.waitForPageLoad(tabId);
  await StealthEngine.sleep(3500);
}

async function clickComposeMessage(tabId) {
  const composeEval = await evalOnPage(tabId, `
    (() => {
      const candidates = Array.from(document.querySelectorAll('button, div[role="button"]'));
      const match = candidates.find((el) => {
        const label = ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).trim().toLowerCase();
        return label.includes('new message') || label === 'send message' || label === 'chat';
      });
      if (!match) return null;
      const rect = match.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        ? { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
        : null;
    })();
  `);

  if (!composeEval.result?.value) {
    throw new Error('New message button could not be found.');
  }

  await StealthEngine.organicClick(tabId, composeEval.result.value.x, composeEval.result.value.y);
  await StealthEngine.sleep(2500);
}

async function focusSearchInput(tabId) {
  const focusEval = await evalOnPage(tabId, `
    (() => {
      const selectors = [
        'input[placeholder="Search..."]',
        'input[placeholder="Search"]',
        'input[aria-label*="Search"]',
        'input[name="queryBox"]',
        'input[type="text"]'
      ];
      for (const selector of selectors) {
        const input = document.querySelector(selector);
        if (!input) continue;
        const rect = input.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        input.focus();
        input.select?.();
        return true;
      }
      return false;
    })();
  `);

  if (!focusEval.result?.value) {
    throw new Error('Search input could not be focused.');
  }
}

async function clearFocusedInput(tabId) {
  await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA' });
  await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA' });
  await StealthEngine.sleep(120);
  await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8, code: 'Backspace' });
  await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8, code: 'Backspace' });
  await StealthEngine.sleep(180);
}

async function searchMessagesRecipient(tabId, username) {
  const normalizedUsername = normalizeUsername(username);
  const searchQuery = `@${normalizedUsername}`;

  await focusSearchInput(tabId);
  await clearFocusedInput(tabId);
  await StealthEngine.simulateTyping(tabId, searchQuery);
  await StealthEngine.sleep(3000);

  const resultEval = await evalOnPage(tabId, `
    (() => {
      const target = ${JSON.stringify(normalizedUsername.toLowerCase())};
      const bodyText = document.body?.innerText || '';
      const noResults = /no account found|no results found|no results|couldn't find anything/i.test(bodyText);
      const scoreHandle = (value) => {
        if (!value) return 0;
        const clean = value.toLowerCase().replace(/^@/, '').trim();
        if (clean === target) return 100;
        if (clean.startsWith(target)) return 85;
        if (target.startsWith(clean)) return 75;
        if (clean.includes(target) || target.includes(clean)) return 60;
        return 0;
      };

      const candidates = [];
      for (const el of document.querySelectorAll('button, div[role="button"], label')) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) continue;
        const text = (el.innerText || el.textContent || '').trim();
        if (!text) continue;
        const lines = text.split('\\n').map((line) => line.trim()).filter(Boolean);
        if (!lines.length) continue;
        const score = Math.max(...lines.map(scoreHandle));
        if (score <= 0) continue;
        candidates.push({
          score,
          text,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2)
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      return {
        noResults,
        best: candidates[0] || null
      };
    })();
  `);

  const payload = resultEval.result?.value;
  if (payload?.best) {
    return payload.best;
  }
  if (payload?.noResults) {
    return null;
  }

  return null;
}

async function searchAndOpenProfile(tabId, username) {
  const normalizedUsername = normalizeUsername(username);
  await openInstagramSearch(tabId);
  await focusSearchInput(tabId);
  await clearFocusedInput(tabId);
  await StealthEngine.simulateTyping(tabId, `@${normalizedUsername}`);
  await StealthEngine.sleep(3000);

  const candidateEval = await evalOnPage(tabId, `
    (() => {
      const target = ${JSON.stringify(normalizedUsername.toLowerCase())};
      const text = document.body?.innerText || '';
      const noResults = /no results|couldn't find anything for that search|no account found/i.test(text);
      const bad = new Set(['explore', 'reels', 'direct', 'stories', 'p', 'reel', 'accounts', '']);
      const score = (value) => {
        if (!value) return 0;
        const clean = value.toLowerCase().replace(/^@/, '').trim();
        if (!clean || bad.has(clean)) return 0;
        if (clean === target) return 100;
        if (clean.startsWith(target)) return 85;
        if (target.startsWith(clean)) return 70;
        if (clean.includes(target) || target.includes(clean)) return 55;
        return 0;
      };

      const candidates = [];
      for (const anchor of document.querySelectorAll('a[href]')) {
        const rect = anchor.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) continue;
        const parts = anchor.pathname.split('/').filter(Boolean);
        if (parts.length !== 1) continue;
        const handle = parts[0];
        const textScore = Math.max(...(anchor.innerText || anchor.textContent || '').split('\\n').map(score), 0);
        const finalScore = Math.max(score(handle), textScore);
        if (finalScore <= 0) continue;
        candidates.push({
          score: finalScore,
          username: handle,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2)
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      return { noResults, best: candidates[0] || null };
    })();
  `);

  const payload = candidateEval.result?.value;
  if (!payload?.best) {
    return null;
  }

  await StealthEngine.organicClick(tabId, payload.best.x, payload.best.y);
  await StealthEngine.sleep(4500);
  return payload.best.username;
}

async function extractProfileInfo(tabId, username) {
  const normalizedUsername = normalizeUsername(username);
  const result = await evalOnPage(tabId, `
    (() => {
      const username = ${JSON.stringify(normalizedUsername)};
      let descText = '';
      let titleText = document.title || '';
      try {
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) descText = metaDesc.content || '';
        const metaTitle = document.querySelector('meta[property="og:title"]');
        if (metaTitle) titleText = metaTitle.content || titleText;
      } catch (e) {}

      let displayName = '';
      try {
        const nameMatch = titleText.match(/^(.+?)\\s*[(@•]/);
        if (nameMatch) displayName = nameMatch[1].trim();
      } catch (e) {}

      let bio = '';
      try {
        const bioSelectors = [
          'header section > div > span',
          'header section span._aacl',
          'header section div > span',
          'header section p',
          'section > div > span'
        ];
        for (const selector of bioSelectors) {
          const node = document.querySelector(selector);
          if (node && node.textContent.trim().length > 2) {
            bio = node.textContent.trim();
            break;
          }
        }
        if (!bio && descText) {
          bio = descText.split(' - See Instagram')[0].trim();
        }
      } catch (e) {}

      let recentPosts = [];
      try {
        const postCandidates = Array.from(document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]'))
          .slice(0, 6)
          .map((anchor) => {
            const img = anchor.querySelector('img[alt]');
            const label = anchor.getAttribute('aria-label') || '';
            const text = [img?.getAttribute('alt') || '', label].join(' ').trim();
            return text;
          })
          .map((text) => text.replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        recentPosts = postCandidates.slice(0, 3);
      } catch (e) {}

      return {
        username,
        displayName: displayName || '',
        bio: bio || '',
        recentPosts
      };
    })();
  `);

  return result.result?.value || { username: normalizedUsername, displayName: '', bio: '', recentPosts: [] };
}

async function openConversationFromCurrentContext(tabId, username) {
  await openInstagramInbox(tabId);
  await clickComposeMessage(tabId);

  const bestMatch = await searchMessagesRecipient(tabId, username);
  if (!bestMatch) {
    return null;
  }

  await StealthEngine.organicClick(tabId, bestMatch.x, bestMatch.y);
  await StealthEngine.sleep(1200);

  const nextEval = await evalOnPage(tabId, `
    (() => {
      const candidates = Array.from(document.querySelectorAll('button, div[role="button"]'));
      const match = candidates.find((el) => {
        const text = (el.textContent || '').trim().toLowerCase();
        return text === 'chat' || text === 'next';
      });
      if (!match) return null;
      const rect = match.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        ? { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
        : null;
    })();
  `);

  if (nextEval.result?.value) {
    await StealthEngine.organicClick(tabId, nextEval.result.value.x, nextEval.result.value.y);
    await StealthEngine.sleep(2500);
  }

  return bestMatch;
}

async function focusAndInsertMessage(tabId, messageText) {
  let composerFocused = false;

  for (let attempt = 0; attempt < 24; attempt++) {
    const focused = await evalOnPage(tabId, `
      (() => {
        const candidates = Array.from(document.querySelectorAll([
          'div[contenteditable="true"][role="textbox"][aria-placeholder*="Message"]',
          '[data-lexical-editor="true"][role="textbox"][aria-placeholder*="Message"]',
          '[aria-placeholder*="Message"][role="textbox"]',
          '[aria-placeholder*="Message"][contenteditable="true"]',
          'div[contenteditable="true"][role="textbox"]',
          '[data-lexical-editor="true"][role="textbox"]',
          'input[placeholder*="Message"]',
          'textarea[placeholder*="Message"]',
          '[role="textbox"]',
          '[contenteditable="true"]'
        ].join(',')));

        const scoreNode = (node) => {
          const rect = node.getBoundingClientRect();
          if (rect.width < 20 || rect.height < 20) return -1;
          const style = window.getComputedStyle(node);
          if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return -1;

          const meta = [
            node.getAttribute('aria-placeholder') || '',
            node.getAttribute('placeholder') || '',
            node.getAttribute('aria-label') || '',
            node.getAttribute('role') || ''
          ].join(' ').toLowerCase();
          const text = (node.textContent || '').toLowerCase();

          if (meta.includes('search') || text.includes('search')) return -1;

          let score = 0;
          if (meta.includes('message')) score += 120;
          if (node.getAttribute('data-lexical-editor') === 'true') score += 60;
          if ((node.getAttribute('role') || '').toLowerCase() === 'textbox') score += 40;
          if (node.getAttribute('contenteditable') === 'true') score += 35;
          if (rect.bottom > window.innerHeight * 0.75) score += 35;
          if (rect.left > window.innerWidth * 0.25) score += 20;
          if (rect.width > 200) score += 15;
          return score;
        };

        let best = null;
        let bestScore = -1;

        for (const node of candidates) {
          const score = scoreNode(node);
          if (score > bestScore) {
            best = node;
            bestScore = score;
          }
        }

        if (!best || bestScore < 40) {
          const fallbackPoints = [
            [window.innerWidth * 0.65, window.innerHeight * 0.94],
            [window.innerWidth * 0.75, window.innerHeight * 0.92],
            [window.innerWidth * 0.55, window.innerHeight * 0.9]
          ];

          for (const [x, y] of fallbackPoints) {
            const hit = document.elementFromPoint(x, y);
            let current = hit;
            while (current) {
              const meta = [
                current.getAttribute?.('aria-placeholder') || '',
                current.getAttribute?.('placeholder') || '',
                current.getAttribute?.('aria-label') || '',
                current.getAttribute?.('role') || ''
              ].join(' ').toLowerCase();
              const isEditable = current.getAttribute?.('contenteditable') === 'true' ||
                (current.getAttribute?.('role') || '').toLowerCase() === 'textbox' ||
                current.tagName === 'INPUT' ||
                current.tagName === 'TEXTAREA';
              if (isEditable && meta.includes('message') && !meta.includes('search')) {
                best = current;
                bestScore = 200;
                break;
              }
              current = current.parentElement;
            }
            if (best) break;
          }
        }

        if (!best || bestScore < 40) return false;

        best.focus?.();
        best.click?.();

        if (best.tagName === 'INPUT' || best.tagName === 'TEXTAREA') {
          best.value = '';
          best.dispatchEvent(new Event('input', { bubbles: true }));
          best.setSelectionRange?.(0, 0);
          return document.activeElement === best;
        }

        if (best.getAttribute('contenteditable') === 'true' || (best.getAttribute('role') || '').toLowerCase() === 'textbox') {
          best.textContent = '';
          best.dispatchEvent(new InputEvent('input', { bubbles: true, data: '', inputType: 'deleteContentBackward' }));
          const range = document.createRange();
          range.selectNodeContents(best);
          range.collapse(false);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          return document.activeElement === best || best.contains(document.activeElement);
        }

        return false;
      })();
    `);

    if (focused.result?.value) {
      composerFocused = true;
      break;
    }

    await StealthEngine.sleep(500);
  }

  if (!composerFocused) {
    throw new Error('Chat input box not found.');
  }

  await StealthEngine.sleep(200);
  await CDPController.sendCommand(tabId, 'Input.insertText', { text: messageText });
  await StealthEngine.sleep(400);
}

async function attachAssetIfPresent(tabId, attachmentUrl) {
  if (!attachmentUrl || !attachmentUrl.trim()) {
    return;
  }

  try {
    console.log(`[Cherry IG] Injecting local attachment asset: ${attachmentUrl}`);
    const docObj = await CDPController.sendCommand(tabId, 'DOM.getDocument', {});
    const fileInputNode = await CDPController.sendCommand(tabId, 'DOM.querySelector', {
      nodeId: docObj.root.nodeId,
      selector: 'input[type="file"]'
    });
    if (fileInputNode.nodeId) {
      await CDPController.sendCommand(tabId, 'DOM.setFileInputFiles', {
        files: [attachmentUrl.trim()],
        nodeId: fileInputNode.nodeId
      });
      await StealthEngine.sleep(4500);
    }
  } catch (err) {
    console.error('[Cherry IG] File injection exception:', err);
  }
}

export const InstagramDMSender = {
  async sendDM(tabId, username, profileData, userGoal, tonePrompt, attachmentUrl) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      throw new Error('Username is required.');
    }

    console.log(`Starting DM flow for @${normalizedUsername}`);

    const matchedProfileUsername = await searchAndOpenProfile(tabId, normalizedUsername);
    if (!matchedProfileUsername) {
      return { status: `No matching profile found for @${normalizedUsername}.` };
    }
    const resolvedProfileData = matchedProfileUsername
      ? await extractProfileInfo(tabId, matchedProfileUsername)
      : { username: normalizedUsername, displayName: '', bio: '' };

    const prompt = buildMessagePrompt({
      username: resolvedProfileData.username || normalizedUsername,
      profileData: {
        ...profileData,
        ...resolvedProfileData
      },
      goal: userGoal,
      tonePrompt
    });
    const fallbackPrompt = `Write one short Instagram DM to @${resolvedProfileData.username || normalizedUsername}.
Return only the DM text.
Start with ${resolvedProfileData.displayName || `@${resolvedProfileData.username || normalizedUsername}`}.
Goal: ${sanitizeGoal(userGoal)}
Tone: ${String(tonePrompt || 'Casual and brief').trim() || 'Casual and brief'}
Maximum 2 short sentences.
DM:`;

    console.log('Asking Cherry AI Engine for message...');
    const messageText = await generateDirectMessage({
      prompt,
      fallbackPrompt,
      username: resolvedProfileData.username || normalizedUsername,
      profileData: {
        ...profileData,
        ...resolvedProfileData
      },
      goal: userGoal,
      tonePrompt
    });

    const match = await openConversationFromCurrentContext(tabId, matchedProfileUsername);
    if (!match) {
      return { status: `No matching message recipient found for @${normalizedUsername}.` };
    }

    await focusAndInsertMessage(tabId, messageText);
    await attachAssetIfPresent(tabId, attachmentUrl);
    await StealthEngine.sleep(500);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, code: 'Enter' });
    await StealthEngine.sleep(50);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, code: 'Enter' });

    console.log(`Sent DM to @${normalizedUsername}`);
    return { status: `DM sent to closest match for @${normalizedUsername}.` };
  }
};
