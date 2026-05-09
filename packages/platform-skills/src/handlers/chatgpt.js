import path from 'node:path';
import fs from 'node:fs';
import {
  openAttachedPage,
  pauseLikeHuman,
  waitForAppShell,
  waitForVisible,
  minimalDelay,
  dismissPopups,
} from '../common.js';

const CHATGPT_URL = 'https://chat.openai.com/';
const CHATGPT_IMAGES_URL = 'https://chat.openai.com/?model=gpt-4o';

// ── Shared helpers ────────────────────────────────────────────────────────────

async function openChatGPT(attachedBrowser, url = CHATGPT_URL) {
  const page = await openAttachedPage(attachedBrowser, url, { platform: 'chatgpt' });
  await waitForAppShell(page, 'chatgpt');
  await dismissPopups(page);
  return page;
}

// Find the main prompt textarea — confirmed from ChatGPT-home.html
async function getPromptInput(page) {
  return waitForVisible(page, [
    'textarea[name="prompt-textarea"]',
    'textarea[aria-label="Chat with ChatGPT"]',
    'textarea#prompt-textarea',
    'div[contenteditable="true"][aria-label*="message"]',
    'div[contenteditable="true"]',
  ], 12000);
}

// Type prompt and send
async function sendPrompt(page, text) {
  const input = await getPromptInput(page);
  if (!input) throw new Error('ChatGPT prompt input not found — are you logged in?');

  await input.click();
  await minimalDelay(300);
  await input.fill('');
  await page.keyboard.type(text, { delay: 18 });
  await minimalDelay(400);

  // Send button confirmed: data-testid="send-button", aria-label="Send prompt"
  const sendBtn = page.locator('[data-testid="send-button"], #composer-submit-button').first();
  if (await sendBtn.count() > 0 && await sendBtn.isEnabled().catch(() => false)) {
    await sendBtn.click();
  } else {
    await page.keyboard.press('Enter');
  }
}

// Upload a file/image via the + (composer-plus-btn) attachment flow
async function attachFile(page, filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;

  // Click the + button (confirmed: data-testid="composer-plus-btn", aria-label="Add files and more")
  const plusBtn = page.locator('[data-testid="composer-plus-btn"], #composer-plus-btn').first();
  if (await plusBtn.count() > 0) {
    await plusBtn.click();
    await minimalDelay(600);
  }

  // Look for file input that appears after clicking +
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(filePath);
    await minimalDelay(2000); // Wait for upload
    return true;
  }

  // Fallback: trigger file chooser via keyboard
  const [fileChooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 4000 }).catch(() => null),
    page.keyboard.press('Escape'),
  ]);
  if (fileChooser) {
    await fileChooser.setFiles(filePath);
    await minimalDelay(2000);
    return true;
  }

  return false;
}

// Wait for ChatGPT to finish responding (stop button disappears)
async function waitForResponse(page, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Stop button disappears when generation is done
    const stopBtn = page.locator('[data-testid="stop-button"], button[aria-label="Stop streaming"]');
    const isGenerating = await stopBtn.count().then(c => c > 0).catch(() => false);
    if (!isGenerating) return true;
    await minimalDelay(1000);
  }
  return false;
}

// Extract the last assistant message text
async function getLastResponse(page) {
  return page.evaluate(() => {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    const last = msgs[msgs.length - 1];
    return last ? (last.innerText || last.textContent || '').trim() : '';
  });
}

// Extract generated image src from last assistant message
async function getGeneratedImageSrc(page) {
  return page.evaluate(() => {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    const last = msgs[msgs.length - 1];
    if (!last) return null;
    const img = last.querySelector('img[src]');
    return img ? img.src : null;
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const chatgptHandler = {
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;

    // ── generate_image — prompt only ─────────────────────────────────────────
    if (action === 'generate_image') {
      const page = await openChatGPT(attachedBrowser, CHATGPT_IMAGES_URL);

      const prompt = args.prompt || args.messageGoal || 'A beautiful futuristic landscape';
      const referenceImagePath = args.attachmentPath || args.referenceImagePath || null;

      // If a reference image was supplied, upload it first
      if (referenceImagePath) {
        const uploaded = await attachFile(page, referenceImagePath);
        if (!uploaded) console.warn('[ChatGPT] Could not attach reference image:', referenceImagePath);
        await minimalDelay(1000);
      }

      const fullPrompt = referenceImagePath
        ? `Using the uploaded image as a reference, generate: ${prompt}`
        : `Generate an image: ${prompt}`;

      await sendPrompt(page, fullPrompt);
      await pauseLikeHuman(page, 4000, 6000);
      await waitForResponse(page, 90000);

      const imgSrc = await getGeneratedImageSrc(page);
      if (imgSrc) {
        return {
          status: 'completed',
          summary: `Image generated on ChatGPT: "${prompt.slice(0, 60)}"`,
          data: { imageUrl: imgSrc },
        };
      }

      // Image might be there but in a different format — return the response text
      const responseText = await getLastResponse(page);
      return {
        status: 'completed',
        summary: 'ChatGPT responded (image may need manual save)',
        data: { response: responseText },
      };
    }

    // ── chat / ask — plain text prompt ───────────────────────────────────────
    if (action === 'open_workspace' || action === 'chat' || action === 'ask') {
      const page = await openChatGPT(attachedBrowser);

      const prompt = args.prompt || args.messageGoal || args.query;
      if (!prompt) {
        return { status: 'completed', summary: 'ChatGPT opened', data: {} };
      }

      // Optionally attach a file/reference asset before prompting
      if (args.attachmentPath) {
        await attachFile(page, args.attachmentPath);
        await minimalDelay(800);
      }

      await sendPrompt(page, prompt);
      await pauseLikeHuman(page, 2000, 3000);
      await waitForResponse(page, 120000);

      const response = await getLastResponse(page);
      return {
        status: 'completed',
        summary: `ChatGPT responded to: "${prompt.slice(0, 60)}"`,
        data: { response },
      };
    }

    // ── upload_file — attach any file to a new chat ───────────────────────────
    if (action === 'upload_file') {
      const page = await openChatGPT(attachedBrowser);
      const filePath = args.attachmentPath || args.filePath;
      if (!filePath) throw new Error('upload_file requires attachmentPath');

      const uploaded = await attachFile(page, filePath);
      if (!uploaded) throw new Error(`Could not attach file: ${filePath}`);

      const followUp = args.prompt || `Analyze this file: ${path.basename(filePath)}`;
      await sendPrompt(page, followUp);
      await pauseLikeHuman(page, 2000, 3000);
      await waitForResponse(page, 120000);

      const response = await getLastResponse(page);
      return {
        status: 'completed',
        summary: `File uploaded and ChatGPT responded`,
        data: { response },
      };
    }

    throw new Error(`ChatGPT handler does not support action: ${action}`);
  },
};
