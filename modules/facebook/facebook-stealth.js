import CDPController from '../../background/cdp-controller.js';
import StealthEngine from '../../background/stealth-engine.js';
import LLMClient from '../../background/llm-client.js';

const FB_HOME_URL     = 'https://www.facebook.com/';
const FB_MESSAGES_URL = 'https://www.facebook.com/messages/';

function normalizeUsername(username) {
  return String(username || '').trim().replace(/^@+/, '');
}

async function evalOnPage(tabId, expression) {
  return CDPController.sendCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
}

async function ensureFacebook(tabId) {
  await StealthEngine.applySpoofing(tabId);
  const urlCheck = await evalOnPage(tabId, 'window.location.hostname');
  if (!urlCheck.result?.value?.includes('facebook.com')) {
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: FB_HOME_URL });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(3000);
  }
}

async function generateMessage(goal, tone, username) {
  try {
    return await LLMClient.generate(
      `Write a short, friendly Facebook message to @${username}.\nGoal: ${goal}\nTone: ${tone}\nMax 2 sentences. Return only the message text.`,
      100, 0.7
    );
  } catch {
    return `Hey! ${goal || 'Just wanted to reach out'} 👋`;
  }
}

export const FacebookStealthEngine = {
  async executeCommand(tabId, commandType, payload) {
    await ensureFacebook(tabId);
    StealthEngine.checkAbort();

    if (commandType === 'fb_dm') {
      return await this.sendDM(tabId, payload.username, payload.userGoal, payload.tonePrompt);
    } else if (commandType === 'fb_post') {
      return await this.createPost(tabId, payload.userGoal, payload.tonePrompt);
    } else if (commandType === 'fb_engage') {
      return await this.engagePost(tabId, payload.username, payload.userGoal, payload.tonePrompt);
    } else if (commandType === 'fb_follow') {
      return await this.followPage(tabId, payload.username);
    } else if (commandType === 'fb_scrape') {
      const results = await this.scrapeSearch(tabId, payload.hashtag, 10);
      return { type: 'csv', data: results, status: `Scraped ${results.length} profiles.` };
    }

    return { status: 'Unknown Facebook command.' };
  },

  // ── Send a DM via Messenger ───────────────────────────────────────────────

  async sendDM(tabId, username, goal, tone) {
    const handle = normalizeUsername(username);

    // Navigate to Messenger search
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: FB_MESSAGES_URL });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(3000);

    // Find and click the search/new message button
    const searchBtnCoords = await evalOnPage(tabId, `
      (() => {
        const selectors = [
          'a[aria-label="New message"]',
          'div[aria-label="New message"]',
          '[aria-label="Search Messenger"]',
          'input[placeholder="Search Messenger"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0) return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
          }
        }
        return null;
      })()
    `);

    if (!searchBtnCoords.result?.value) throw new Error('Could not find Messenger search. Make sure you are logged in to Facebook.');

    const { x, y } = searchBtnCoords.result.value;
    await StealthEngine.organicClick(tabId, x, y);
    await StealthEngine.sleep(1200);

    // Type the username into the search field
    const searchInput = await evalOnPage(tabId, `
      (() => {
        const el = document.querySelector('input[placeholder*="Search"], input[type="text"], [role="combobox"] input');
        if (el) {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (searchInput.result?.value) {
      const { x: sx, y: sy } = searchInput.result.value;
      await StealthEngine.organicClick(tabId, sx, sy);
    }

    await StealthEngine.simulateTyping(tabId, handle);
    await StealthEngine.sleep(2000);

    // Click the first search result
    const resultClicked = await evalOnPage(tabId, `
      (() => {
        const results = document.querySelectorAll('[role="option"], [role="listitem"], li[data-testid]');
        if (results.length > 0) {
          const rect = results[0].getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!resultClicked.result?.value) throw new Error(`Could not find Facebook user: ${handle}`);
    const { x: rx, y: ry } = resultClicked.result.value;
    await StealthEngine.organicClick(tabId, rx, ry);
    await StealthEngine.sleep(1500);

    // Look for an Open button or Chat button
    const openBtn = await evalOnPage(tabId, `
      (() => {
        for (const label of ['Open', 'Chat', 'Message']) {
          const btns = Array.from(document.querySelectorAll('div[role="button"], a[role="button"]'));
          const found = btns.find(b => b.innerText?.trim() === label);
          if (found) {
            const rect = found.getBoundingClientRect();
            return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
          }
        }
        return null;
      })()
    `);
    if (openBtn.result?.value) {
      await StealthEngine.organicClick(tabId, openBtn.result.value.x, openBtn.result.value.y);
      await StealthEngine.sleep(2000);
    }

    // Generate the message
    const message = await generateMessage(goal, tone, handle);

    // Find the message input
    const composerCoords = await evalOnPage(tabId, `
      (() => {
        const sel = [
          'div[contenteditable="true"][role="textbox"]',
          'div[aria-label*="message"]',
          'div[aria-placeholder*="message"]',
        ];
        for (const s of sel) {
          const el = document.querySelector(s);
          if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0) return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
          }
        }
        return null;
      })()
    `);

    if (!composerCoords.result?.value) throw new Error('Could not find Messenger message composer.');
    const { x: cx, y: cy } = composerCoords.result.value;
    await StealthEngine.organicClick(tabId, cx, cy);
    await StealthEngine.sleep(500);
    await StealthEngine.simulateTyping(tabId, message);
    await StealthEngine.sleep(500);

    // Send with Enter
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, code: 'Enter' });
    await StealthEngine.sleep(50);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, code: 'Enter' });

    await StealthEngine.sleep(1000);
    return { status: `Facebook DM sent to ${handle}.` };
  },

  // ── Create a post on the feed ─────────────────────────────────────────────

  async createPost(tabId, goal, tone) {
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: FB_HOME_URL });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(3000);

    const postText = await generateMessage(goal, tone, 'everyone');

    // Click "What's on your mind?" composer
    const composerCoords = await evalOnPage(tabId, `
      (() => {
        const sel = [
          'div[aria-label*="mind"]',
          'div[data-testid="status-attachment-mentions-input"]',
          'div[role="button"][tabindex="0"][class*="compose"]',
        ];
        for (const s of sel) {
          const el = document.querySelector(s);
          if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0) return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
          }
        }
        // Fallback: find by text
        const btns = Array.from(document.querySelectorAll('div[role="button"]'));
        const wb = btns.find(b => /what.*mind|create.*post/i.test(b.innerText || b.getAttribute('aria-label') || ''));
        if (wb) {
          const rect = wb.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!composerCoords.result?.value) throw new Error('Facebook post composer not found. Make sure you are logged in.');
    const { x, y } = composerCoords.result.value;
    await StealthEngine.organicClick(tabId, x, y);
    await StealthEngine.sleep(2000);

    // Type post content in the modal
    const modalInput = await evalOnPage(tabId, `
      (() => {
        const el = document.querySelector(
          'div[contenteditable="true"][role="textbox"], div[data-testid="status-attachment-mentions-input"] div[contenteditable]'
        );
        if (el) {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!modalInput.result?.value) throw new Error('Facebook post text input not found.');
    const { x: mx, y: my } = modalInput.result.value;
    await StealthEngine.organicClick(tabId, mx, my);
    await StealthEngine.sleep(300);
    await StealthEngine.simulateTyping(tabId, postText);
    await StealthEngine.sleep(800);

    // Click Post button
    const posted = await evalOnPage(tabId, `
      (() => {
        const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
        const postBtn = btns.find(b => /^post$/i.test((b.innerText || b.getAttribute('aria-label') || '').trim()));
        if (postBtn) {
          const rect = postBtn.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!posted.result?.value) throw new Error('Facebook Post button not found.');
    await StealthEngine.organicClick(tabId, posted.result.value.x, posted.result.value.y);
    await StealthEngine.sleep(2000);

    return { status: 'Facebook post published.' };
  },

  // ── Like + Comment on a post ──────────────────────────────────────────────

  async engagePost(tabId, username, goal, tone) {
    const handle = normalizeUsername(username);
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: `https://www.facebook.com/${handle}/` });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(3000);

    // Like the first post
    const liked = await evalOnPage(tabId, `
      (() => {
        const btns = Array.from(document.querySelectorAll('[aria-label="Like"], [aria-label*="React"]'));
        if (btns.length > 0) {
          const rect = btns[0].getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);
    if (liked.result?.value) {
      await StealthEngine.organicClick(tabId, liked.result.value.x, liked.result.value.y);
      await StealthEngine.sleep(800);
    }

    // Post a comment
    const comment = await generateMessage(goal, tone, handle);
    const commentBox = await evalOnPage(tabId, `
      (() => {
        const el = document.querySelector(
          'div[aria-label*="comment"], div[aria-label="Write a comment"], div[data-lexical-editor]'
        );
        if (el) {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!commentBox.result?.value) return { status: `Liked ${handle}'s post. Comment box not found.` };
    const { x: cbx, y: cby } = commentBox.result.value;
    await StealthEngine.organicClick(tabId, cbx, cby);
    await StealthEngine.sleep(400);
    await StealthEngine.simulateTyping(tabId, comment);
    await StealthEngine.sleep(400);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, code: 'Enter' });
    await StealthEngine.sleep(50);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, code: 'Enter' });

    return { status: `Liked and commented on ${handle}'s Facebook post.` };
  },

  // ── Follow / Like a page ──────────────────────────────────────────────────

  async followPage(tabId, username) {
    const handle = normalizeUsername(username);
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: `https://www.facebook.com/${handle}/` });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(3000);

    const btn = await evalOnPage(tabId, `
      (() => {
        const labels = ['Follow', 'Like Page', 'Like', 'Add Friend'];
        const btns = Array.from(document.querySelectorAll('div[role="button"], a[role="button"]'));
        for (const label of labels) {
          const found = btns.find(b => (b.innerText || b.getAttribute('aria-label') || '').trim() === label);
          if (found) {
            const rect = found.getBoundingClientRect();
            if (rect.width > 0) return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), label };
          }
        }
        return null;
      })()
    `);

    if (!btn.result?.value) return { status: `Already following ${handle} or button not found.` };
    const { x, y, label } = btn.result.value;
    await StealthEngine.organicClick(tabId, x, y);
    await StealthEngine.sleep(1500);
    return { status: `Clicked "${label}" on Facebook page: ${handle}.` };
  },

  // ── Scrape search results ─────────────────────────────────────────────────

  async scrapeSearch(tabId, query, maxResults = 10) {
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: `https://www.facebook.com/search/people/?q=${encodeURIComponent(query)}` });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(3000);

    const results = [];
    let lastCount = 0;
    for (let pass = 0; pass < 5 && results.length < maxResults; pass++) {
      const scraped = await evalOnPage(tabId, `
        (() => {
          const cards = Array.from(document.querySelectorAll('[data-testid="browse-result-content"] a, [role="article"] a[href*="facebook.com"]'));
          const seen = new Set();
          const out = [];
          for (const a of cards) {
            const href = a.href || '';
            if (!href.includes('facebook.com') || seen.has(href)) continue;
            seen.add(href);
            const nameEl = a.querySelector('span') || a;
            out.push({ name: (nameEl.innerText || '').trim(), profileUrl: href });
            if (out.length >= 20) break;
          }
          return out;
        })()
      `);

      const batch = scraped.result?.value || [];
      for (const p of batch) {
        if (results.length >= maxResults) break;
        if (!results.find(r => r.profileUrl === p.profileUrl)) results.push(p);
      }

      if (results.length === lastCount) break;
      lastCount = results.length;

      // Scroll to load more
      await CDPController.sendCommand(tabId, 'Runtime.evaluate', { expression: 'window.scrollBy(0, window.innerHeight * 2)' });
      await StealthEngine.sleep(2000);
    }

    return results;
  },
};
