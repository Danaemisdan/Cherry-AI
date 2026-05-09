import CDPController from '../../background/cdp-controller.js';
import StealthEngine from '../../background/stealth-engine.js';
import LLMClient from '../../background/llm-client.js';

const WHATSAPP_URL = 'https://web.whatsapp.com/';

function normalizePhone(phone) {
  // Strip spaces, dashes, brackets — keep digits and leading +
  return String(phone || '').trim().replace(/[\s\-().]/g, '');
}

async function evalOnPage(tabId, expression) {
  return CDPController.sendCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
}

async function ensureWhatsApp(tabId) {
  await StealthEngine.applySpoofing(tabId);
  const urlCheck = await evalOnPage(tabId, 'window.location.hostname');
  if (!urlCheck.result?.value?.includes('web.whatsapp.com')) {
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: WHATSAPP_URL });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(5000); // WhatsApp Web takes time to load
  }
}

async function waitForChatLoaded(tabId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await evalOnPage(tabId, `
      !!document.querySelector(
        'div[contenteditable="true"][data-tab="10"], div[contenteditable="true"][aria-placeholder*="message"], div[contenteditable="true"][data-lexical-editor]'
      )
    `);
    if (ready.result?.value) return true;
    await StealthEngine.sleep(800);
  }
  return false;
}

async function generateMessage(goal, tone, username) {
  try {
    return await LLMClient.generate(
      `Write a short, friendly WhatsApp message to ${username}.\nGoal: ${goal}\nTone: ${tone}\nMax 2 sentences. Return only the message text.`,
      100, 0.7
    );
  } catch {
    return `Hey! ${goal || 'Just wanted to reach out'} 👋`;
  }
}

export const WhatsAppStealthEngine = {
  async executeCommand(tabId, commandType, payload) {
    await ensureWhatsApp(tabId);
    StealthEngine.checkAbort();

    if (commandType === 'wa_send' || commandType === 'wa_dm') {
      return await this.sendMessage(tabId, payload);
    } else if (commandType === 'wa_search') {
      return await this.searchContact(tabId, payload.query || payload.username);
    } else if (commandType === 'wa_new_chat') {
      return await this.sendToPhone(tabId, payload);
    }

    return { status: 'Unknown WhatsApp command.' };
  },

  // ── Send to a known contact by name (search left rail) ────────────────────

  async sendMessage(tabId, { username, to, goal, tone, body }) {
    const target = normalizePhone(to || username || '');
    if (!target) throw new Error('WhatsApp recipient (username or phone) is required.');

    // Check if it's a phone number — if so, use wa.me direct link
    const isPhone = /^\+?[\d]{7,}$/.test(target.replace(/\s/g, ''));
    if (isPhone) {
      return await this.sendToPhone(tabId, { phone: target, goal, tone, body });
    }

    // Search by contact name in left rail
    const searchBox = await evalOnPage(tabId, `
      (() => {
        const el = document.querySelector(
          'div[contenteditable="true"][data-tab="3"], div[aria-label="Search input textbox"], div[aria-label*="Search"]'
        );
        if (el) {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!searchBox.result?.value) throw new Error('WhatsApp search box not found. Make sure WhatsApp Web is loaded and logged in.');
    await StealthEngine.organicClick(tabId, searchBox.result.value.x, searchBox.result.value.y);
    await StealthEngine.sleep(400);
    await StealthEngine.simulateTyping(tabId, target);
    await StealthEngine.sleep(2000);

    // Click first search result
    const result = await evalOnPage(tabId, `
      (() => {
        const items = document.querySelectorAll('div[data-testid="cell-frame-container"], div[role="listitem"] div[role="button"]');
        if (items.length > 0) {
          const rect = items[0].getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!result.result?.value) throw new Error(`WhatsApp contact not found: ${target}`);
    await StealthEngine.organicClick(tabId, result.result.value.x, result.result.value.y);
    await StealthEngine.sleep(1500);

    return await this._typeAndSend(tabId, body || await generateMessage(goal, tone, target), target);
  },

  // ── Send to a phone number via wa.me link ─────────────────────────────────

  async sendToPhone(tabId, { phone, goal, tone, body }) {
    const cleaned = normalizePhone(phone);
    if (!cleaned) throw new Error('Phone number is required for wa_new_chat.');

    // Use wa.me to open a chat with any number
    const waUrl = `https://web.whatsapp.com/send?phone=${encodeURIComponent(cleaned)}&text=`;
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: waUrl });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(4000);

    // Wait for chat to load
    const loaded = await waitForChatLoaded(tabId);
    if (!loaded) throw new Error(`Could not open WhatsApp chat with ${cleaned}. Number may not be on WhatsApp.`);

    const message = body || await generateMessage(goal, tone, cleaned);
    return await this._typeAndSend(tabId, message, cleaned);
  },

  // ── Search for a contact (left rail only) ─────────────────────────────────

  async searchContact(tabId, query) {
    if (!query) throw new Error('Search query is required.');

    const searchBox = await evalOnPage(tabId, `
      (() => {
        const el = document.querySelector(
          'div[contenteditable="true"][data-tab="3"], div[aria-label="Search input textbox"]'
        );
        if (el) {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!searchBox.result?.value) throw new Error('WhatsApp search box not found.');
    await StealthEngine.organicClick(tabId, searchBox.result.value.x, searchBox.result.value.y);
    await StealthEngine.sleep(400);
    await StealthEngine.simulateTyping(tabId, query);
    await StealthEngine.sleep(2000);

    return { status: `Searched WhatsApp for: "${query}"` };
  },

  // ── Internal: type message into composer and press Enter ──────────────────

  async _typeAndSend(tabId, message, target) {
    const composer = await evalOnPage(tabId, `
      (() => {
        const el = document.querySelector(
          'div[contenteditable="true"][data-tab="10"], div[contenteditable="true"][aria-placeholder*="message"], div[contenteditable="true"][data-lexical-editor]'
        );
        if (el) {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!composer.result?.value) throw new Error('WhatsApp message input not found.');
    const { x, y } = composer.result.value;
    await StealthEngine.organicClick(tabId, x, y);
    await StealthEngine.sleep(400);
    await StealthEngine.simulateTyping(tabId, message);
    await StealthEngine.sleep(500);

    // Press Enter to send
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, code: 'Enter' });
    await StealthEngine.sleep(50);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, code: 'Enter' });
    await StealthEngine.sleep(1000);

    return { status: `WhatsApp message sent to ${target}.` };
  },
};
