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

// Confirmed from PlatformHTML/Gemini/ captures
const GEMINI_HOME_URL   = 'https://gemini.google.com/app';
const GEMINI_IMAGES_URL = 'https://gemini.google.com/app'; // same page, just navigate & prompt

// ── Helpers ───────────────────────────────────────────────────────────────────

async function openGemini(attachedBrowser, url = GEMINI_HOME_URL) {
  const page = await openAttachedPage(attachedBrowser, url, { platform: 'gemini' });
  await waitForAppShell(page, 'gemini');
  await dismissPopups(page);
  return page;
}

/**
 * Get the main prompt input.
 * Gemini has evolved its UI — it uses a rich-textarea web component or a
 * contenteditable div. The original <textarea class="gds-body-l"> may be
 * hidden or absent in newer layouts. We try the most current selectors first.
 */
async function getPromptInput(page) {
  return waitForVisible(page, [
    // Current Gemini (2025): rich-textarea contains a contenteditable div
    'rich-textarea div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    // Older layout: textarea inside initial-input-area
    'div.initial-input-area textarea',
    // Legacy textarea selectors
    'textarea[placeholder="Ask Gemini"]',
    'textarea.gds-body-l',
    // Generic contenteditable fallback
    'div[contenteditable="true"]',
  ], 12000);
}

/**
 * Type prompt text into Gemini's input.
 * Handles both textarea and contenteditable div.
 */
async function typeIntoInput(page, text) {
  const input = await getPromptInput(page);
  if (!input) throw new Error('Gemini prompt input not found — are you logged in?');

  await input.click();
  await minimalDelay(300);

  const tag = await input.evaluate(el => el.tagName.toLowerCase()).catch(() => 'div');
  if (tag === 'textarea') {
    await input.fill('');
    await input.type(text, { delay: 20 });
  } else {
    // contenteditable div
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(text, { delay: 20 });
  }

  await minimalDelay(400);
}

/**
 * Click the send button.
 * Confirmed from HTML: <mat-icon class="send-icon ...">send</mat-icon> inside a button/anchor.
 * Grid area: icons. The send icon only appears when textarea is not empty.
 */
async function clickSend(page) {
  // Try locating the send button by its mat-icon class
  const sent = await page.evaluate(() => {
    // The send icon is a mat-icon.send-icon; its parent is the clickable element
    const icon = document.querySelector('mat-icon.send-icon');
    if (icon) {
      const btn = icon.closest('button') || icon.closest('a') || icon.closest('[role="button"]') || icon.parentElement;
      if (btn) { btn.click(); return true; }
    }
    // Fallback: any button in the icons grid area
    const iconsArea = document.querySelector('[style*="grid-area: icons"], .send-icon');
    if (iconsArea) { iconsArea.click(); return true; }
    // Fallback: button[aria-label*="Send"]
    const sendBtn = document.querySelector('button[aria-label*="Send"], button[aria-label*="send"]');
    if (sendBtn) { sendBtn.click(); return true; }
    return false;
  });

  if (!sent) {
    // Last resort — press Enter
    await page.keyboard.press('Enter');
  }
}

/**
 * Upload a file via the upload button.
 * Confirmed from HTML: <mat-icon class="upload-icon ...">add_2</mat-icon>
 * Grid area: upload-icon.
 */
async function attachFile(page, filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;

  try {
    // Trigger file chooser by clicking the upload icon button
    const [fileChooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 5000 }),
      page.evaluate(() => {
        const icon = document.querySelector('mat-icon.upload-icon');
        if (icon) {
          const btn = icon.closest('button') || icon.closest('a') || icon.closest('[role="button"]') || icon.parentElement;
          if (btn) { btn.click(); return true; }
        }
        // Try direct input
        const input = document.querySelector('input[type="file"]');
        if (input) { input.click(); return true; }
        return false;
      }),
    ]);

    if (fileChooser) {
      await fileChooser.setFiles(filePath);
      await minimalDelay(2500);
      return true;
    }
  } catch (_) {}

  // Direct setInputFiles fallback
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(filePath);
    await minimalDelay(2500);
    return true;
  }

  console.warn('[Gemini] Could not open file chooser for:', filePath);
  return false;
}

/**
 * Wait for Gemini to finish generating a response.
 * Gemini shows a loading state while streaming; we detect when it's done.
 */
async function waitForResponse(page, timeoutMs = 90000) {
  const start = Date.now();
  // First wait a moment for generation to start
  await minimalDelay(1500);

  while (Date.now() - start < timeoutMs) {
    const isDone = await page.evaluate(() => {
      // Loading indicators Gemini uses
      const loading = document.querySelector(
        '.loading-indicator, [aria-label*="Generating"], ' +
        '.progress-spinner, mat-progress-bar, ' +
        '[aria-label*="Stop generating"], .stop-button'
      );
      return !loading;
    }).catch(() => true);

    if (isDone) return true;
    await minimalDelay(1000);
  }
  return false;
}

/**
 * Extract the last Gemini response text.
 * Confirmed from HTML: .response-container contains the assistant output.
 */
async function getLastResponse(page) {
  return page.evaluate(() => {
    // Look for response containers (confirmed class prefix from HTML)
    const containers = document.querySelectorAll(
      'model-response, .response-container, .response-content, ' +
      'message-content, .gemini-message, [data-response-index]'
    );
    if (containers.length) {
      const last = containers[containers.length - 1];
      return (last.innerText || last.textContent || '').trim();
    }
    // Generic fallback
    const all = document.querySelectorAll('[class*="response"]');
    const last = all[all.length - 1];
    return last ? (last.innerText || '').trim() : '';
  });
}

/**
 * Get generated image URL from Gemini response.
 * Imagen produces image thumbnails in .generated-image or similar containers.
 */
async function getGeneratedImageSrc(page) {
  return page.evaluate(() => {
    // Look in response containers for any non-icon image
    const candidates = document.querySelectorAll(
      'model-response img, .response-container img, ' +
      '.generated-image img, img.generated-image, ' +
      'img[src*="gstatic"], img[src*="googleusercontent"], ' +
      'img[alt*="generated"], img[alt*="image"]'
    );
    for (const img of candidates) {
      const src = img.src || '';
      // Skip icons, avatars, logos
      if (src && !src.includes('icon') && !src.includes('avatar') &&
          !src.includes('logo') && !src.includes('sparkle') &&
          (src.startsWith('http') || src.startsWith('blob'))) {
        return src;
      }
    }
    return null;
  });
}

// Detect whether the prompt is an internal "open workspace" instruction
// rather than a real user query to send to Gemini.
function isOpenWorkspacePrompt(prompt) {
  if (!prompt) return true;
  const lower = prompt.toLowerCase().trim();
  return (
    lower.startsWith('open gemini') ||
    lower.startsWith('open chatgpt') ||
    lower === 'open gemini in my attached chrome workspace.' ||
    lower === 'gemini opened'
  );
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const geminiHandler = {
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;

    // ── generate_image — multi-step process ───────────────────────────────────────
    if (action === 'generate_image') {
      console.log('[Gemini] Starting image generation process...');

      // Step 1: Open Gemini
      const page = await openGemini(attachedBrowser, GEMINI_HOME_URL);
      await pauseLikeHuman(page, 1000, 2000);

      const prompt = args.prompt || args.messageGoal || args.query || 'A beautiful futuristic landscape';
      const refImage = args.attachmentPath || args.referenceImagePath || null;

      console.log('[Gemini] Step 1: Opened Gemini, prompt:', prompt);

      // Step 2: Try to access Imagen/image generation features
      try {
        console.log('[Gemini] Step 2: Checking for Imagen/image generation UI...');

        // Look for image generation buttons or indicators
        const imageGenButton = page.locator('button:has-text("Image"), button:has-text("Imagen"), [aria-label*="image"]').first();
        if (await imageGenButton.count() > 0) {
          console.log('[Gemini] Step 2: Found image generation button, clicking...');
          await imageGenButton.click();
          await minimalDelay(1500);
        } else {
          console.log('[Gemini] Step 2: No dedicated image button found, will use text prompt');
        }
      } catch (error) {
        console.log('[Gemini] Step 2: Image UI check failed:', error.message);
      }

      // Step 3: Upload reference image if provided
      if (refImage) {
        console.log('[Gemini] Step 3: Uploading reference image...');
        const uploaded = await attachFile(page, refImage);
        if (!uploaded) {
          console.warn('[Gemini] Step 3: Reference image upload failed, continuing with text-only prompt');
        } else {
          console.log('[Gemini] Step 3: Reference image uploaded successfully');
          await minimalDelay(1000);
        }
      }

      // Step 4: Send the image generation prompt
      console.log('[Gemini] Step 4: Sending image generation prompt...');
      const fullPrompt = refImage
        ? `Using the uploaded image as a reference, generate: ${prompt}`
        : `Create an image of: ${prompt}. Use Imagen if available.`;

      await typeIntoInput(page, fullPrompt);
      await clickSend(page);
      console.log('[Gemini] Step 4: Prompt sent successfully');

      // Step 5: Wait for image generation
      console.log('[Gemini] Step 5: Waiting for image generation (this may take 1-2 minutes)...');
      await pauseLikeHuman(page, 4000, 6000);
      const generationComplete = await waitForResponse(page, 180000); // 3 minutes timeout

      if (!generationComplete) {
        console.log('[Gemini] Step 5: Generation timeout reached, checking for partial results...');
      } else {
        console.log('[Gemini] Step 5: Generation completed');
      }

      // Step 6: Extract generated image
      console.log('[Gemini] Step 6: Extracting generated image...');
      await minimalDelay(2000); // Extra delay for rendering
      const imgSrc = await getGeneratedImageSrc(page);

      if (imgSrc) {
        console.log('[Gemini] Step 6: Image extracted successfully:', imgSrc);
        return {
          status: 'completed',
          summary: `Image generated on Gemini: "${prompt.slice(0, 60)}"`,
          data: { imageUrl: imgSrc },
        };
      }

      // Step 7: Fallback - check for response text
      console.log('[Gemini] Step 7: No image URL found, checking text response...');
      const responseText = await getLastResponse(page);
      console.log('[Gemini] Step 7: Response text:', responseText.slice(0, 100));

      return {
        status: 'completed',
        summary: `Gemini responded: "${responseText.slice(0, 100)}" (check browser for image)`,
        data: { response: responseText },
      };
    }

    // ── chat / ask / open_workspace ───────────────────────────────────────────
    if (['open_workspace', 'chat', 'ask'].includes(action)) {
      const page = await openGemini(attachedBrowser);
      await pauseLikeHuman(page, 800, 1500);

      // For open_workspace: only send if it's a real user query, not the
      // internal "Open Gemini in my workspace" instruction string.
      const rawPrompt = args.prompt || args.messageGoal || args.query;
      const prompt = (action === 'open_workspace' && isOpenWorkspacePrompt(rawPrompt))
        ? null
        : rawPrompt;

      if (!prompt) {
        return { status: 'completed', summary: 'Gemini opened', data: {} };
      }

      // Optionally attach a file/reference asset before prompting
      if (args.attachmentPath) {
        const uploaded = await attachFile(page, args.attachmentPath);
        if (uploaded) await minimalDelay(800);
      }

      await typeIntoInput(page, prompt);
      await clickSend(page);

      await pauseLikeHuman(page, 2000, 3000);
      await waitForResponse(page, 120000);

      const response = await getLastResponse(page);
      return {
        status: 'completed',
        summary: `Gemini responded to: "${prompt.slice(0, 60)}"`,
        data: { response },
      };
    }

    // ── upload_file — attach a file and ask about it ──────────────────────────
    if (action === 'upload_file') {
      const page = await openGemini(attachedBrowser);
      const filePath = args.attachmentPath || args.filePath;
      if (!filePath) throw new Error('upload_file requires attachmentPath');

      const uploaded = await attachFile(page, filePath);
      if (!uploaded) throw new Error(`Could not attach file to Gemini: ${filePath}`);

      const followUp = args.prompt || `Analyze this file: ${path.basename(filePath)}`;
      await typeIntoInput(page, followUp);
      await clickSend(page);

      await pauseLikeHuman(page, 2000, 3000);
      await waitForResponse(page, 120000);

      const response = await getLastResponse(page);
      return {
        status: 'completed',
        summary: `File uploaded and Gemini responded`,
        data: { response },
      };
    }

    throw new Error(`Gemini handler does not support action: ${action}`);
  },
};
