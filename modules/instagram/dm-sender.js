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
  await StealthEngine.sleep(2500);
}

async function clickComposeMessage(tabId) {
  console.log('[Cherry IG] Opening new message dialog...');

  const composeEval = await evalOnPage(tabId, `
    (() => {
      // Strategy 1: Look by text content
      let candidates = Array.from(document.querySelectorAll('a, button, div[role="button"], div[role="link"]'));
      let match = candidates.find((el) => {
        const text = (el.textContent || '').trim().toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        return text.includes('new message') || ariaLabel.includes('new message');
      });
      
      // Strategy 2: Look for SVG with new message icon near it
      if (!match) {
        const svgs = document.querySelectorAll('svg');
        for (const svg of svgs) {
          const ariaLabel = (svg.getAttribute('aria-label') || '').toLowerCase();
          if (ariaLabel.includes('new message')) {
            // Find nearest clickable parent
            let parent = svg.parentElement;
            for (let i = 0; i < 5 && parent; i++) {
              if (parent.tagName === 'A' || parent.tagName === 'BUTTON' || parent.getAttribute('role') === 'button') {
                match = parent;
                break;
              }
              parent = parent.parentElement;
            }
            break;
          }
        }
      }
      
      // Strategy 3: Look for pencil/edit icon in header
      if (!match) {
        const header = document.querySelector('header, [role="banner"]');
        if (header) {
          const buttons = header.querySelectorAll('a, button, div[role="button"]');
          for (const btn of buttons) {
            if (btn.querySelector('svg')) {
              const rect = btn.getBoundingClientRect();
              if (rect.width > 30 && rect.width < 100) {
                match = btn;
                break;
              }
            }
          }
        }
      }
      
      if (!match) return { found: false };
      const rect = match.getBoundingClientRect();
      return {
        found: true,
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
        text: match.textContent?.substring(0, 30)
      };
    })();
  `);

  const result = composeEval.result?.value;
  if (!result?.found) {
    throw new Error('New message button could not be found.');
  }

  console.log(`[Cherry IG] Found New Message button at (${result.x}, ${result.y})`);
  
  // Temporarily focus tab for the click (required for Instagram dialog to open)
  const wasActive = await chrome.tabs.get(tabId).then(t => t.active);
  if (!wasActive) {
    console.log('[Cherry IG] Temporarily focusing tab for compose click...');
    await chrome.tabs.update(tabId, { active: true });
    await StealthEngine.sleep(500);
  }
  
  // Click using CDP (works when tab is focused)
  await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { 
    type: 'mousePressed', x: result.x, y: result.y, button: 'left', clickCount: 1 
  });
  await StealthEngine.sleep(50);
  await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { 
    type: 'mouseReleased', x: result.x, y: result.y, button: 'left', clickCount: 1 
  });
  
  console.log('[Cherry IG] Clicked compose, waiting for dialog...');
  await StealthEngine.sleep(3000);
  
  // Return tab to background if it wasn't active before
  if (!wasActive) {
    console.log('[Cherry IG] Returning tab to background...');
    // Note: We can't directly "unfocus" a tab, but we can switch to another tab
    // Get all tabs and switch to a different one
    const allTabs = await chrome.tabs.query({ currentWindow: true });
    const otherTab = allTabs.find(t => t.id !== tabId && t.id);
    if (otherTab) {
      await chrome.tabs.update(otherTab.id, { active: true });
    }
  }
  
  // Verify dialog opened
  const dialogCheck = await evalOnPage(tabId, `
    (() => {
      const dialog = document.querySelector('[role="dialog"]');
      return { hasDialog: !!dialog, dialogHTML: dialog ? dialog.innerHTML.substring(0, 200) : null };
    })();
  `);
  console.log('[Cherry IG] Dialog check:', dialogCheck.result?.value);
}

async function focusSearchInput(tabId) {
  console.log('[Cherry IG] Looking for search input in message dialog...');
  
  // First, ensure we're looking within the dialog only
  const focusEval = await evalOnPage(tabId, `
    (() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) {
        console.log('[Cherry IG Debug] No dialog found for search');
        return { found: false, reason: 'no-dialog' };
      }
      
      // Look for search input ONLY within the dialog
      const selectors = [
        'input[placeholder*="Search"]',
        'input[aria-label*="Search"]',
        'input[type="text"]',
        'textarea[placeholder*="Search"]',
        '[contenteditable="true"]'
      ];
      
      for (const selector of selectors) {
        // Use querySelector on dialog element specifically
        const input = dialog.querySelector(selector);
        if (!input) continue;
        
        const rect = input.getBoundingClientRect();
        // Must be visible and reasonably sized
        if (rect.width < 50 || rect.height < 20) continue;
        // Must be in upper portion of dialog (search input is near top)
        if (rect.y > 300) continue;
        
        input.focus();
        input.click?.();
        input.select?.();
        return { found: true, selector, y: rect.y };
      }
      
      // Fallback: find any text input near top of dialog
      const allInputs = dialog.querySelectorAll('input, textarea, [contenteditable="true"]');
      for (const input of allInputs) {
        const rect = input.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 20 && rect.y < 250) {
          input.focus();
          input.click?.();
          return { found: true, selector: 'fallback', y: rect.y };
        }
      }
      
      return { found: false, reason: 'no-input-in-dialog' };
    })();
  `);

  const result = focusEval.result?.value;
  if (result?.found) {
    console.log(`[Cherry IG] Found search input in dialog: ${result.selector} at y=${result.y}`);
    return true;
  } else {
    console.error(`[Cherry IG] Could not find search input in dialog: ${result?.reason}`);
    return false;
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
  const searchQuery = normalizedUsername;

  const focused = await focusSearchInput(tabId);
  if (!focused) {
    console.log('[Cherry IG] Could not focus search input');
    return null;
  }
  
  await clearFocusedInput(tabId);
  console.log(`[Cherry IG] Typing search query: ${searchQuery}`);
  await StealthEngine.simulateTyping(tabId, searchQuery);
  await StealthEngine.sleep(3000);

  // Wait for search results and find the user
  const resultEval = await evalOnPage(tabId, `
    (() => {
      const target = ${JSON.stringify(normalizedUsername.toLowerCase())};
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) {
        return { error: 'no-dialog' };
      }
      
      // Find all elements in dialog
      const allDivs = dialog.querySelectorAll('div');
      let foundElement = null;
      let foundText = '';
      
      for (const el of allDivs) {
        const text = (el.innerText || el.textContent || '').toLowerCase();
        const rect = el.getBoundingClientRect();
        
        // Must be visible and reasonably sized for a user row
        if (rect.width < 100 || rect.height < 30 || rect.y < 150) continue;
        
        // Split into lines and look for EXACT username match
        const lines = text.split('\\n').map(l => l.trim().replace(/^@/, ''));
        let exactMatch = false;
        
        for (const line of lines) {
          // Must be EXACT match, not partial
          if (line === target) {
            exactMatch = true;
            break;
          }
        }
        
        if (exactMatch) {
          // Prefer clickable elements (user rows)
          const isClickable = el.getAttribute('role') === 'button' || 
                             el.tagName === 'BUTTON' || 
                             el.onclick ||
                             window.getComputedStyle(el).cursor === 'pointer';
          
          // Prefer elements that look like user rows (reasonable height)
          const isUserRow = rect.height >= 50 && rect.height <= 80;
          
          if (!foundElement || (isClickable && isUserRow)) {
            foundElement = el;
            foundText = text;
          }
        }
      }
      
      if (foundElement) {
        const rect = foundElement.getBoundingClientRect();
        return {
          found: true,
          text: foundText.split('\\n')[0].substring(0, 30),
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2)
        };
      }
      
      return { found: false, target: target };
    })();
  `);

  const result = resultEval.result?.value;
  if (result?.found) {
    console.log(`[Cherry IG] Found user: "${result.text}" at (${result.x}, ${result.y})`);
    return { text: result.text, x: result.x, y: result.y };
  }
  
  console.log(`[Cherry IG] Could not find user: ${normalizedUsername}`);
  return null;
}

async function clickChatButton(tabId) {
  console.log('[Cherry IG] Looking for Chat button...');
  
  // Try multiple strategies to find the Chat button
  for (let attempt = 0; attempt < 3; attempt++) {
    const buttonEval = await evalOnPage(tabId, `
      (() => {
        // Strategy 1: Primary button in dialog
        const primaryBtns = Array.from(document.querySelectorAll('div[role="dialog"] button, div[role="dialog"] div[role="button"]'));
        for (const btn of primaryBtns) {
          const text = (btn.textContent || '').trim().toLowerCase();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          
          if (text === 'chat' || text.includes('chat') || 
              ariaLabel.includes('chat') || ariaLabel.includes('new message')) {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              return { 
                found: true, 
                x: Math.round(rect.x + rect.width / 2), 
                y: Math.round(rect.y + rect.height / 2),
                text: btn.textContent,
                strategy: 'primary'
              };
            }
          }
        }
        
        // Strategy 2: Blue/primary colored button at bottom of dialog
        const allBtns = Array.from(document.querySelectorAll('div[role="dialog"] button, div[role="dialog"] div[role="button"]'));
        const bottomBtns = allBtns.filter(btn => {
          const rect = btn.getBoundingClientRect();
          return rect.y > window.innerHeight * 0.7 && rect.width > 100;
        });
        
        if (bottomBtns.length > 0) {
          // Pick the one that looks like a primary action (usually has specific styling)
          const primary = bottomBtns.find(btn => {
            const style = window.getComputedStyle(btn);
            const bg = style.backgroundColor || style.background || '';
            return bg.includes('rgb(0, 149') || bg.includes('rgb(56, 151') || bg.includes('blue') || btn.textContent.toLowerCase().includes('chat');
          }) || bottomBtns[0];
          
          const rect = primary.getBoundingClientRect();
          return { 
            found: true, 
            x: Math.round(rect.x + rect.width / 2), 
            y: Math.round(rect.y + rect.height / 2),
            text: primary.textContent,
            strategy: 'bottom-button'
          };
        }
        
        return { found: false };
      })();
    `);
    
    if (buttonEval.result?.value?.found) {
      const { x, y, text, strategy } = buttonEval.result.value;
      console.log(`[Cherry IG] Found Chat button: "${text}" using ${strategy} at (${x}, ${y})`);
      await StealthEngine.organicClick(tabId, x, y);
      await StealthEngine.sleep(2000);
      return true;
    }
    
    console.log(`[Cherry IG] Chat button not found on attempt ${attempt + 1}, waiting...`);
    await StealthEngine.sleep(1000);
  }
  
  console.log('[Cherry IG] Could not find Chat button after retries');
  return false;
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

async function followUserOnInstagram(tabId, username) {
  console.log(`[Cherry IG] Following @${username} first...`);
  
  // Navigate to profile
  await CDPController.sendCommand(tabId, 'Page.navigate', { url: `https://www.instagram.com/${username}/` });
  await StealthEngine.waitForPageLoad(tabId);
  await StealthEngine.sleep(4000); // Wait longer for profile to load
  
  // Find follow button with multiple strategies
  const followEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
    expression: `
      (() => {
        const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
        
        // Strategy 1: Exact text match (case insensitive)
        let followBtn = btns.find(b => {
          const text = (b.textContent || '').trim().toLowerCase();
          return text === 'follow';
        });
        
        // Strategy 2: Check for aria-label
        if (!followBtn) {
          followBtn = btns.find(b => {
            const label = (b.getAttribute('aria-label') || '').toLowerCase();
            return label.includes('follow') && !label.includes('following');
          });
        }
        
        // Strategy 3: Check header area buttons (follow is usually in header near profile info)
        if (!followBtn) {
          const headerBtns = btns.filter(b => {
            const rect = b.getBoundingClientRect();
            // Follow button is typically in the header section, below profile pic
            return rect.y > 150 && rect.y < 350 && rect.width > 80 && rect.width < 200;
          });
          followBtn = headerBtns.find(b => {
            const text = (b.textContent || '').trim().toLowerCase();
            // Must be EXACTLY 'follow', not 'following' or other variations
            return text === 'follow';
          });
        }
        
        if (followBtn) {
          const rect = followBtn.getBoundingClientRect();
          return { 
            found: true, 
            x: Math.round(rect.x + rect.width / 2), 
            y: Math.round(rect.y + rect.height / 2),
            text: followBtn.textContent?.trim()
          };
        }
        
        // Check if already following
        const followingBtn = btns.find(b => {
          const text = (b.textContent || '').trim().toLowerCase();
          return text === 'following' || text === 'requested';
        });
        if (followingBtn) {
          return { found: false, alreadyFollowing: true, text: followingBtn.textContent?.trim() };
        }
        
        return { found: false };
      })();
    `,
    returnByValue: true
  });
  
  const result = followEval.result?.value;
  
  if (result?.found) {
    console.log(`[Cherry IG] Found follow button: "${result.text}" at (${result.x}, ${result.y})`);
    await StealthEngine.organicClick(tabId, result.x, result.y);
    await StealthEngine.sleep(2000); // Wait for follow action to complete
    console.log(`[Cherry IG] Followed @${username}`);
    return true;
  } else if (result?.alreadyFollowing) {
    console.log(`[Cherry IG] Already following @${username} (button shows: "${result.text}")`);
    return true;
  }
  
  console.log(`[Cherry IG] Could not find follow button for @${username} - may be private/unavailable`);
  return false;
}

async function getProfileInfoQuick(tabId, username) {
  // Try to get profile info from current page or navigate quickly
  const result = await evalOnPage(tabId, `
    (() => {
      const username = ${JSON.stringify(username)};
      let displayName = '';
      let bio = '';
      let recentPosts = [];
      
      // Try to get display name from title
      try {
        const title = document.title || '';
        const match = title.match(/^(.+?)\\s*[@(]/);
        if (match) displayName = match[1].trim();
      } catch (e) {}
      
      // Try to get bio from various selectors
      try {
        const selectors = [
          'header section div > span',
          'header section span',
          'section > div > span'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim().length > 2) {
            bio = el.textContent.trim();
            break;
          }
        }
      } catch (e) {}
      
      return { username, displayName, bio, recentPosts };
    })();
  `);
  return result.result?.value || { username, displayName: '', bio: '', recentPosts: [] };
}

export const InstagramDMSender = {
  async sendDM(tabId, username, profileData, userGoal, tonePrompt, attachmentUrl, followFirst = false) {
    const normalizedUsername = normalizeUsername(username);
    if (!normalizedUsername) {
      throw new Error('Username is required.');
    }

    console.log(`[Cherry IG] Starting DM flow for @${normalizedUsername} (followFirst=${followFirst})`);
    
    // Step 1: Follow first if requested - navigate to profile, follow, then continue
    let profileInfo = { username: normalizedUsername, displayName: '', bio: '' };
    if (followFirst) {
      console.log(`[Cherry IG] Step 1: Following @${normalizedUsername}...`);
      await followUserOnInstagram(tabId, normalizedUsername);
      // Get profile info while we're on the profile page
      profileInfo = await getProfileInfoQuick(tabId, normalizedUsername);
      await StealthEngine.sleep(1500);
    }

    // Step 2: Go to inbox and open compose dialog
    console.log(`[Cherry IG] Step 2: Opening inbox...`);
    await openInstagramInbox(tabId);
    
    console.log(`[Cherry IG] Step 3: Clicking compose...`);
    await clickComposeMessage(tabId);

    // Step 3: Search for the recipient
    console.log(`[Cherry IG] Step 4: Searching for @${normalizedUsername}...`);
    let bestMatch = await searchMessagesRecipient(tabId, normalizedUsername);
    
    // If dialog closed (no results), try reopening
    if (!bestMatch) {
      console.log(`[Cherry IG] Search failed, checking if dialog is open...`);
      const dialogCheck = await evalOnPage(tabId, `(() => { return { hasDialog: !!document.querySelector('[role="dialog"]') }; })();`);
      if (!dialogCheck.result?.value?.hasDialog) {
        console.log(`[Cherry IG] Dialog closed, reopening...`);
        await clickComposeMessage(tabId);
        await StealthEngine.sleep(2000);
        bestMatch = await searchMessagesRecipient(tabId, normalizedUsername);
      }
    }
    if (!bestMatch) {
      console.log(`[Cherry IG] No matching recipient found for @${normalizedUsername}`);
      return { status: `No matching recipient found for @${normalizedUsername}.` };
    }

    console.log(`[Cherry IG] Found match: "${bestMatch.text}" at (${bestMatch.x}, ${bestMatch.y})`);
    
    // Step 4: Click on the matched user row to select them
    console.log(`[Cherry IG] Step 5: Clicking on user row to select...`);
    
    // Try clicking on the row itself
    try {
      await StealthEngine.organicClick(tabId, bestMatch.x, bestMatch.y);
    } catch (err) {
      console.log(`[Cherry IG] Organic click failed, trying direct click...`);
      await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: bestMatch.x, y: bestMatch.y, button: 'left', clickCount: 1 });
      await StealthEngine.sleep(50);
      await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: bestMatch.x, y: bestMatch.y, button: 'left', clickCount: 1 });
    }
    await StealthEngine.sleep(1000);
    
    // Verify the user was selected - look for filled checkbox or selected state
    let selectionCheck = await evalOnPage(tabId, `
      (() => {
        // Look for any checked/selected indicator in the dialog
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return { selected: false, hasDialog: false };
        
        // Check for checked radio buttons
        const checkedRadio = dialog.querySelector('[role="radio"][aria-checked="true"]');
        if (checkedRadio) return { selected: true, type: 'radio' };
        
        // Check for SVG with checkmark or filled state
        const svgs = dialog.querySelectorAll('svg');
        for (const svg of svgs) {
          const ariaLabel = svg.getAttribute('aria-label') || '';
          if (ariaLabel.toLowerCase().includes('selected') || ariaLabel.toLowerCase().includes('checked')) {
            return { selected: true, type: 'svg' };
          }
          // Check for filled circle (Instagram uses this for selection)
          const circles = svg.querySelectorAll('circle');
          for (const circle of circles) {
            const fill = circle.getAttribute('fill');
            if (fill && fill !== 'none' && fill !== 'transparent') {
              return { selected: true, type: 'circle' };
            }
          }
        }
        
        // Check if any user row has a "selected" class or style
        const rows = dialog.querySelectorAll('div[role="button"], div[role="listitem"]');
        for (const row of rows) {
          const style = window.getComputedStyle(row);
          const bg = style.backgroundColor;
          // Selected rows often have different background
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            return { selected: true, type: 'background' };
          }
        }
        
        return { selected: false, hasDialog: true };
      })();
    `);
    
    const isSelected = selectionCheck.result?.value?.selected;
    console.log(`[Cherry IG] User selected: ${isSelected}`);
    
    // If not selected, try clicking more precisely on the row
    if (!isSelected) {
      console.log(`[Cherry IG] User not selected, trying alternative click method...`);
      
      // Try clicking directly on the text/username area
      const rowClick = await evalOnPage(tabId, `
        (() => {
          const target = ${JSON.stringify(normalizedUsername.toLowerCase())};
          const dialog = document.querySelector('[role="dialog"]');
          if (!dialog) return { found: false };
          
          const rows = dialog.querySelectorAll('div[role="button"], div[role="listitem"]');
          for (const row of rows) {
            const text = (row.innerText || '').toLowerCase();
            if (text.includes(target)) {
              const rect = row.getBoundingClientRect();
              // Click on the left side where the avatar is (more reliable)
              return { 
                found: true, 
                x: Math.round(rect.x + 60), 
                y: Math.round(rect.y + rect.height / 2),
                width: rect.width,
                height: rect.height
              };
            }
          }
          return { found: false };
        })();
      `);
      
      if (rowClick.result?.value?.found) {
        const { x, y } = rowClick.result.value;
        console.log(`[Cherry IG] Clicking on row at (${x}, ${y})...`);
        await StealthEngine.organicClick(tabId, x, y);
        await StealthEngine.sleep(1500);
      }
    }

    // Step 5: Click Chat button
    console.log(`[Cherry IG] Step 6: Looking for Chat button...`);
    const chatClicked = await clickChatButton(tabId);
    if (!chatClicked) {
      console.log(`[Cherry IG] Warning: Could not find Chat button, attempting to continue anyway...`);
      // Try pressing Enter as fallback
      await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, code: 'Enter' });
      await StealthEngine.sleep(50);
      await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, code: 'Enter' });
    }
    
    // Wait for dialog to close and conversation to open
    console.log(`[Cherry IG] Waiting for conversation to open...`);
    await StealthEngine.sleep(3000);
    
    // Check if we're now in a conversation (URL should change or dialog should be gone)
    const conversationCheck = await evalOnPage(tabId, `
      (() => {
        const hasDialog = !!document.querySelector('[role="dialog"]');
        const hasComposer = !!document.querySelector('[contenteditable="true"][role="textbox"], [data-lexical-editor="true"]');
        const url = window.location.href;
        return { hasDialog, hasComposer, url, inConversation: !hasDialog && hasComposer };
      })();
    `);
    
    const checkResult = conversationCheck.result?.value;
    console.log(`[Cherry IG] Conversation check:`, checkResult);
    
    if (!checkResult?.inConversation) {
      console.log(`[Cherry IG] Conversation didn't open properly, dialog closed but no composer found`);
      // The user might be selected but Chat didn't work - try navigating directly
      if (!checkResult?.hasDialog) {
        console.log(`[Cherry IG] Attempting direct navigation to conversation...`);
        await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
          expression: `window.location.href = 'https://www.instagram.com/direct/t/${normalizedUsername}/'`
        });
        await StealthEngine.sleep(3000);
      }
    }

    // Step 6: If we didn't get profile info from following, try now (we're in chat)
    if (!profileInfo.displayName && !profileInfo.bio) {
      profileInfo = { username: normalizedUsername, displayName: '', bio: '' };
    }

    // Step 7: Generate message
    const prompt = buildMessagePrompt({
      username: normalizedUsername,
      profileData: { ...profileData, ...profileInfo },
      goal: userGoal,
      tonePrompt
    });
    const fallbackPrompt = `Write one short Instagram DM to @${normalizedUsername}.
Return only the DM text.
Start with ${profileInfo.displayName || `@${normalizedUsername}`}.
Goal: ${sanitizeGoal(userGoal)}
Tone: ${String(tonePrompt || 'Casual and brief').trim() || 'Casual and brief'}
Maximum 2 short sentences.
DM:`;

    console.log('[Cherry IG] Generating message...');
    const messageText = await generateDirectMessage({
      prompt,
      fallbackPrompt,
      username: normalizedUsername,
      profileData: { ...profileData, ...profileInfo },
      goal: userGoal,
      tonePrompt
    });

    // Step 8: Send message
    console.log('[Cherry IG] Sending message...');
    await focusAndInsertMessage(tabId, messageText);
    await attachAssetIfPresent(tabId, attachmentUrl);
    await StealthEngine.sleep(500);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, code: 'Enter' });
    await StealthEngine.sleep(50);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, code: 'Enter' });

    console.log(`[Cherry IG] DM sent to @${normalizedUsername}`);
    return { status: `DM sent to @${normalizedUsername}${followFirst ? ' (followed first)' : ''}.` };
  }
};
