// Media upload utilities for all platforms
// Supports: images, videos, audio, documents

import { minimalDelay, firstVisibleLocator, tryClick } from './common.js';

const MEDIA_TYPES = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'],
  video: ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv'],
  audio: ['.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a', '.wma'],
  document: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.zip', '.rar'],
};

function detectMediaType(filePath) {
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  for (const [type, extensions] of Object.entries(MEDIA_TYPES)) {
    if (extensions.includes(ext)) {
      return type;
    }
  }
  return 'unknown';
}

// Generic file upload helper
export async function uploadFile(page, filePath, options = {}) {
  const { waitForUpload = 2000, clickFirst = true } = options;
  const mediaType = detectMediaType(filePath);

  try {
    // Try to find file input directly
    const fileInput = await page.locator('input[type="file"]').first();
    if (await fileInput.count() > 0) {
      await fileInput.setInputFiles(filePath);
      await minimalDelay(waitForUpload);
      return { success: true, method: 'direct_input', type: mediaType };
    }

    // If no direct input, look for attachment buttons
    if (clickFirst) {
      const attachmentSelectors = [
        // Generic
        'button[aria-label*="Attach"]',
        'button[aria-label*="attachment"]',
        'button[aria-label*="file"]',
        'button[aria-label*="upload"]',
        // Images
        'button[aria-label*="photo"]',
        'button[aria-label*="image"]',
        'button[aria-label*="gallery"]',
        'svg[aria-label*="photo"]',
        'svg[aria-label*="image"]',
        // Video
        'button[aria-label*="video"]',
        // Files
        '[data-testid="attach-file"]',
        '[data-testid="add-attachment"]',
        // Platform specific
        'div[role="button"]:has(svg[aria-label*="photo"])',
        'div[role="button"]:has(svg[aria-label*="image"])',
      ];

      const attachBtn = await firstVisibleLocator(page, attachmentSelectors);
      if (attachBtn) {
        await attachBtn.click();
        await minimalDelay(800);

        // Look for file input after clicking
        const fileInputAfter = await page.locator('input[type="file"]').first();
        if (await fileInputAfter.count() > 0) {
          await fileInputAfter.setInputFiles(filePath);
          await minimalDelay(waitForUpload);
          return { success: true, method: 'button_click', type: mediaType };
        }
      }
    }

    return { success: false, error: 'No file upload mechanism found', type: mediaType };
  } catch (error) {
    return { success: false, error: error.message, type: mediaType };
  }
}

// Platform-specific upload handlers
export async function uploadToWhatsApp(page, filePath) {
  const result = await uploadFile(page, filePath, { waitForUpload: 1500 });
  if (!result.success) {
    // WhatsApp-specific fallback
    const clipBtn = await firstVisibleLocator(page, [
      'button[aria-label="Attach"]',
      'button[title="Attach"]',
      'div[data-testid="clip"]',
      'span[data-icon="attach-menu-plus"]',
    ]);
    if (clipBtn) {
      await clipBtn.click();
      await minimalDelay(500);
      const input = await page.locator('input[accept*="image"], input[accept*="video"], input[accept*="audio"]').first();
      if (await input.count() > 0) {
        await input.setInputFiles(filePath);
        await minimalDelay(2000);
        return { success: true, method: 'whatsapp_clip', type: detectMediaType(filePath) };
      }
    }
  }
  return result;
}

export async function uploadToInstagramDM(page, filePath) {
  const result = await uploadFile(page, filePath, { waitForUpload: 2000 });
  if (!result.success) {
    // Instagram DM-specific
    const galleryBtn = await firstVisibleLocator(page, [
      'button[aria-label*="Gallery"]',
      'button[aria-label*="Add"]',
      'svg[aria-label="Gallery"]',
      'svg[aria-label="Add"]',
    ]);
    if (galleryBtn) {
      await galleryBtn.click();
      await minimalDelay(800);
      const input = await page.locator('input[type="file"]').first();
      if (await input.count() > 0) {
        await input.setInputFiles(filePath);
        await minimalDelay(2000);
        return { success: true, method: 'instagram_gallery', type: detectMediaType(filePath) };
      }
    }
  }
  return result;
}

export async function uploadToLinkedInDM(page, filePath) {
  return await uploadFile(page, filePath, {
    waitForUpload: 2500,
    clickFirst: true,
  });
}

export async function uploadToTwitterDM(page, filePath) {
  return await uploadFile(page, filePath, {
    waitForUpload: 2000,
    clickFirst: true,
  });
}

export async function uploadToFacebookMessenger(page, filePath) {
  return await uploadFile(page, filePath, {
    waitForUpload: 2000,
    clickFirst: true,
  });
}

export async function uploadToGmail(page, filePath) {
  const result = await uploadFile(page, filePath, {
    waitForUpload: 3000,
    clickFirst: true,
  });
  if (!result.success) {
    // Gmail-specific: look for paperclip icon
    const attachBtn = await firstVisibleLocator(page, [
      'div[aria-label*="Attach"]',
      'div[aria-label*="attachment"]',
      'div[data-tooltip*="Attach"]',
      'div[data-tooltip*="attachment"]',
      '.wG',
      '.a1',
    ]);
    if (attachBtn) {
      await attachBtn.click();
      await minimalDelay(1000);
      const input = await page.locator('input[type="file"]').first();
      if (await input.count() > 0) {
        await input.setInputFiles(filePath);
        await minimalDelay(3000);
        return { success: true, method: 'gmail_paperclip', type: detectMediaType(filePath) };
      }
    }
  }
  return result;
}

// Batch upload multiple files
export async function uploadMultipleFiles(page, filePaths, options = {}) {
  const results = [];
  for (const filePath of filePaths) {
    const result = await uploadFile(page, filePath, options);
    results.push({ file: filePath, ...result });
    await minimalDelay(500); // Small delay between uploads
  }
  return results;
}

export { detectMediaType, MEDIA_TYPES };
