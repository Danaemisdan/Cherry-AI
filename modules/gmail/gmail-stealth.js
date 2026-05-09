import CDPController from '../../background/cdp-controller.js';
import StealthEngine from '../../background/stealth-engine.js';
import LLMClient from '../../background/llm-client.js';

const GMAIL_URL         = 'https://mail.google.com/mail/u/0/#inbox';
const GMAIL_COMPOSE_URL = 'https://mail.google.com/mail/u/0/#inbox?compose=new';

async function evalOnPage(tabId, expression) {
  return CDPController.sendCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
}

async function ensureGmail(tabId) {
  await StealthEngine.applySpoofing(tabId);
  const urlCheck = await evalOnPage(tabId, 'window.location.hostname');
  if (!urlCheck.result?.value?.includes('mail.google.com')) {
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: GMAIL_URL });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(3000);
  }
}

async function generateEmailBody(goal, tone, toAddress) {
  try {
    return await LLMClient.generate(
      `Write a short professional email.\nRecipient: ${toAddress}\nGoal: ${goal}\nTone: ${tone}\nMax 3 sentences. Return only the email body (no subject, no greeting, no sign-off).`,
      150, 0.65
    );
  } catch {
    return goal || 'I wanted to reach out and connect with you.';
  }
}

export const GmailStealthEngine = {
  async executeCommand(tabId, commandType, payload) {
    await ensureGmail(tabId);
    StealthEngine.checkAbort();

    if (commandType === 'gmail_compose' || commandType === 'gmail_send') {
      return await this.sendEmail(tabId, payload);
    } else if (commandType === 'gmail_search') {
      return await this.searchEmails(tabId, payload.query);
    } else if (commandType === 'gmail_read') {
      return await this.readLatestEmail(tabId);
    }

    return { status: 'Unknown Gmail command.' };
  },

  // ── Compose and send an email ─────────────────────────────────────────────

  async sendEmail(tabId, { to, subject, body, goal, tone }) {
    await ensureGmail(tabId);

    const toAddress = String(to || '').trim();
    if (!toAddress) throw new Error('Email recipient (to) is required.');

    const emailBody = body || await generateEmailBody(goal || 'reach out', tone || 'Professional', toAddress);
    const emailSubject = subject || goal || 'Hello';

    // Click Compose button
    // Gmail compose button: role="button" aria-label="Compose" or text "Compose"
    const composeCoords = await evalOnPage(tabId, `
      (() => {
        const selectors = [
          'div[gh="cm"]',
          'div[role="button"][aria-label="Compose"]',
          'div.T-I.T-I-KE.L3',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0) return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
          }
        }
        // Fallback: find by text
        const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
        const found = btns.find(b => /^compose$/i.test((b.innerText || b.getAttribute('aria-label') || '').trim()));
        if (found) {
          const rect = found.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!composeCoords.result?.value) throw new Error('Gmail Compose button not found. Make sure you are logged in to Gmail.');
    await StealthEngine.organicClick(tabId, composeCoords.result.value.x, composeCoords.result.value.y);
    await StealthEngine.sleep(2000);

    // Fill To field
    const toField = await evalOnPage(tabId, `
      (() => {
        const el = document.querySelector(
          'input[name="to"], input[aria-label="To"], div[aria-label="To"] input, textarea[name="to"]'
        );
        if (el) {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!toField.result?.value) throw new Error('Gmail To field not found.');
    await StealthEngine.organicClick(tabId, toField.result.value.x, toField.result.value.y);
    await StealthEngine.sleep(300);
    await StealthEngine.simulateTyping(tabId, toAddress);
    await StealthEngine.sleep(300);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', windowsVirtualKeyCode: 9, code: 'Tab' });
    await StealthEngine.sleep(200);

    // Fill Subject field
    const subjectField = await evalOnPage(tabId, `
      (() => {
        const el = document.querySelector('input[name="subjectbox"], input[aria-label="Subject"], input[placeholder*="Subject"]');
        if (el) {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (subjectField.result?.value) {
      await StealthEngine.organicClick(tabId, subjectField.result.value.x, subjectField.result.value.y);
      await StealthEngine.sleep(200);
      await StealthEngine.simulateTyping(tabId, emailSubject);
      await StealthEngine.sleep(200);
    }

    // Fill body
    const bodyField = await evalOnPage(tabId, `
      (() => {
        const el = document.querySelector(
          'div[role="textbox"][aria-label*="message"], div[aria-label="Message Body"], div.Am.Al.editable'
        );
        if (el) {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!bodyField.result?.value) throw new Error('Gmail message body not found.');
    await StealthEngine.organicClick(tabId, bodyField.result.value.x, bodyField.result.value.y);
    await StealthEngine.sleep(300);
    await StealthEngine.simulateTyping(tabId, emailBody);
    await StealthEngine.sleep(500);

    // Click Send
    const sendBtn = await evalOnPage(tabId, `
      (() => {
        const el = document.querySelector(
          'div[aria-label*="Send"], div[data-tooltip*="Send"], div.T-I.J-J5-Ji.aoO'
        );
        if (el) {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!sendBtn.result?.value) throw new Error('Gmail Send button not found.');
    await StealthEngine.organicClick(tabId, sendBtn.result.value.x, sendBtn.result.value.y);
    await StealthEngine.sleep(2000);

    return { status: `Email sent to ${toAddress}.` };
  },

  // ── Search emails ──────────────────────────────────────────────────────────

  async searchEmails(tabId, query) {
    await ensureGmail(tabId);
    if (!query) throw new Error('Search query is required.');

    const searchBox = await evalOnPage(tabId, `
      (() => {
        const el = document.querySelector('input[aria-label*="search"], input[name="q"], input[placeholder*="Search"]');
        if (el) {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!searchBox.result?.value) throw new Error('Gmail search box not found.');
    const { x, y } = searchBox.result.value;
    await StealthEngine.organicClick(tabId, x, y);
    await StealthEngine.sleep(300);

    // Clear and type
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA' });
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA' });
    await StealthEngine.simulateTyping(tabId, query);
    await StealthEngine.sleep(400);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, code: 'Enter' });
    await StealthEngine.sleep(50);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, code: 'Enter' });
    await StealthEngine.sleep(2000);

    return { status: `Gmail search performed for: "${query}"` };
  },

  // ── Read latest email in inbox ─────────────────────────────────────────────

  async readLatestEmail(tabId) {
    await ensureGmail(tabId);

    // Click first email row
    const firstEmail = await evalOnPage(tabId, `
      (() => {
        const row = document.querySelector('tr.zA, div[role="row"] div.y6');
        if (row) {
          const rect = row.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
        }
        return null;
      })()
    `);

    if (!firstEmail.result?.value) return { status: 'No emails found in inbox.' };
    await StealthEngine.organicClick(tabId, firstEmail.result.value.x, firstEmail.result.value.y);
    await StealthEngine.sleep(2000);

    // Extract email content
    const content = await evalOnPage(tabId, `
      (() => {
        const subject = document.querySelector('h2.hP, [data-legacy-thread-id] h2')?.innerText || '';
        const from = document.querySelector('.gD')?.getAttribute('email') || '';
        const body = document.querySelector('div.a3s.aiL, div[data-message-id] .a3s')?.innerText?.slice(0, 500) || '';
        return { subject, from, body };
      })()
    `);

    const { subject, from, body } = content.result?.value || {};
    return { status: `Read email: "${subject}" from ${from}`, data: { subject, from, preview: body } };
  },
};
