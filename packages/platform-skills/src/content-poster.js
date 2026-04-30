// Content posting capabilities for all social platforms

import { navigate, firstWorkingLocator, fillEditable, clickByText } from './common.js';

export async function createPost(page, platform, content, options = {}) {
  const { media = [], tags = [], schedule = null } = options;

  const posters = {
    instagram: async () => {
      // Navigate to create post
      await navigate(page, 'https://www.instagram.com/create/select/');
      await page.waitForTimeout(3000);

      // Handle file upload for media
      if (media.length > 0) {
        const fileInput = await page.locator('input[type="file"]').first();
        if (fileInput) {
          await fileInput.setInputFiles(media);
          await page.waitForTimeout(3000);
        }
      }

      // Fill caption
      const captionInput = await firstWorkingLocator(page, [
        'textarea[aria-label="Write a caption..."]',
        '[data-testid="caption-input"]',
        'textarea[placeholder*="caption"]'
      ]);

      if (captionInput) {
        const fullContent = tags.length > 0 ? `${content}\n\n${tags.join(' ')}` : content;
        await fillEditable(page, captionInput, fullContent);
      }

      // Share button
      const shareBtn = await firstWorkingLocator(page, ['button:has-text("Share")', '[data-testid="share-button"]', 'button:has-text("Post")']);
      if (shareBtn) {
        await shareBtn.click();
        await page.waitForTimeout(3000);
        return { success: true, platform: 'instagram', message: 'Post shared' };
      }

      return { success: false, message: 'Could not share post' };
    },

    twitter: async () => {
      await navigate(page, 'https://twitter.com/compose/tweet');
      await page.waitForTimeout(2000);

      // Fill tweet content
      const editor = await firstWorkingLocator(page, [
        '[data-testid="tweetTextarea_0"]',
        'div[role="textbox"][data-testid="tweetTextarea_0"]',
        'div[contenteditable="true"]'
      ]);

      if (editor) {
        const fullContent = tags.length > 0 ? `${content} ${tags.join(' ')}` : content;
        await fillEditable(page, editor, fullContent);
      }

      // Add media
      if (media.length > 0) {
        const fileInput = await page.locator('input[type="file"]').first();
        if (fileInput) {
          await fileInput.setInputFiles(media);
          await page.waitForTimeout(3000);
        }
      }

      // Post
      const postBtn = await firstWorkingLocator(page, [
        '[data-testid="tweetButtonInline"]',
        '[data-testid="tweetButton"]',
        'button:has-text("Post")'
      ]);

      if (postBtn) {
        await postBtn.click();
        await page.waitForTimeout(2000);
        return { success: true, platform: 'twitter', message: 'Tweet posted' };
      }

      return { success: false, message: 'Could not post tweet' };
    },

    linkedin: async () => {
      // Use the expanded LinkedIn module
      const { createLinkedInPost } = await import('./expanded-linkedin.js');
      return await createLinkedInPost(page, content, { media, visibility: options.visibility });
    },

    facebook: async () => {
      await navigate(page, 'https://www.facebook.com/');
      await page.waitForTimeout(2000);

      // Click create post box
      const createBox = await firstWorkingLocator(page, [
        '[aria-label="Create a post"]',
        'div[role="button"]:has-text("What")',
        '[data-testid="status-attachment-input"]'
      ]);

      if (createBox) {
        await createBox.click();
        await page.waitForTimeout(1000);

        // Fill content
        const editor = await firstWorkingLocator(page, [
          'div[role="textbox"]',
          '[aria-label="What"][contenteditable]',
          'div[contenteditable="true"]'
        ]);

        if (editor) {
          const fullContent = tags.length > 0 ? `${content}\n\n${tags.join(' ')}` : content;
          await fillEditable(page, editor, fullContent);
        }

        // Add media
        if (media.length > 0) {
          const fileInput = await page.locator('input[type="file"]').first();
          if (fileInput) {
            await fileInput.setInputFiles(media);
            await page.waitForTimeout(3000);
          }
        }

        // Post
        const postBtn = await firstWorkingLocator(page, ['button:has-text("Post")', '[aria-label="Post"]', '[data-testid="react-composer-post-button"]']);
        if (postBtn) {
          await postBtn.click();
          await page.waitForTimeout(3000);
          return { success: true, platform: 'facebook', message: 'Post published' };
        }
      }

      return { success: false, message: 'Could not create post' };
    },
  };

  const poster = posters[platform];
  if (!poster) return { success: false, message: 'Platform not supported' };

  return await poster();
}

export async function createStory(page, platform, media, options = {}) {
  const stories = {
    instagram: async () => {
      await navigate(page, 'https://www.instagram.com/create/story/');
      await page.waitForTimeout(3000);

      if (media.length > 0) {
        const fileInput = await page.locator('input[type="file"]').first();
        if (fileInput) {
          await fileInput.setInputFiles(media);
          await page.waitForTimeout(3000);

          // Add to story button
          const addBtn = await firstWorkingLocator(page, ['button:has-text("Add to story")', '[data-testid="add-to-story"]']);
          if (addBtn) {
            await addBtn.click();
            await page.waitForTimeout(2000);
            return { success: true, platform: 'instagram', type: 'story' };
          }
        }
      }

      return { success: false, message: 'Could not create story' };
    },

    facebook: async () => {
      await navigate(page, 'https://www.facebook.com/stories/create');
      await page.waitForTimeout(3000);

      if (media.length > 0) {
        const fileInput = await page.locator('input[type="file"]').first();
        if (fileInput) {
          await fileInput.setInputFiles(media);
          await page.waitForTimeout(3000);
          return { success: true, platform: 'facebook', type: 'story' };
        }
      }

      return { success: false, message: 'Could not create story' };
    },
  };

  const storyFn = stories[platform];
  if (!storyFn) return { success: false, message: 'Stories not supported on this platform' };

  return await storyFn();
}

export async function schedulePost(page, platform, content, scheduleTime, options = {}) {
  // For platforms that support native scheduling (LinkedIn, Facebook)
  if (platform === 'linkedin') {
    const { createLinkedInPost } = await import('./expanded-linkedin.js');
    return await createLinkedInPost(page, content, { ...options, schedule: scheduleTime });
  }

  // For others, we'd need external scheduling (buffer, etc)
  return { success: false, message: `Native scheduling not available for ${platform}. Use Buffer or similar.` };
}
