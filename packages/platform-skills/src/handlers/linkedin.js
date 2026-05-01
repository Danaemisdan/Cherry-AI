import {
  PLATFORM_URLS,
  buildPlatformTargetUrl,
  clickByText,
  fillEditable,
  firstVisibleLocator,
  generateOutreachMessage,
  navigate,
  openAttachedPage,
  pageSnapshot,
  submitComposer,
  summarizeAction,
  tryClick,
  waitForAppShell,
} from '../common.js';
import { checkLoginState } from '../state-checker.js';
import { extractChatContext } from '../chat-context.js';
import { createSocialHandler } from '../social-base.js';

// LinkedIn DM Helper Functions
async function navigateToLinkedInProfile(page, username) {
  const url = buildPlatformTargetUrl('linkedin', username);
  await navigate(page, url, 'linkedin');
  await waitForAppShell(page);
}

async function checkLinkedInConnectionStatus(page) {
  // Check multiple possible states
  const checks = await Promise.allSettled([
    // Already connected - Message button
    page.locator('button:has-text("Message"), button[aria-label*="Message"], .artdeco-button--primary:has-text("Message")').first().isVisible().catch(() => false),
    // Not connected - Connect button
    page.locator('button:has-text("Connect"), button[aria-label*="Connect"], .artdeco-button--secondary:has-text("Connect")').first().isVisible().catch(() => false),
    // Pending - Pending button
    page.locator('button:has-text("Pending"), button[aria-label*="Pending"], .artdeco-button--muted:has-text("Pending")').first().isVisible().catch(() => false),
    // Follow instead of Connect
    page.locator('button:has-text("Follow"), button[aria-label*="Follow"]').first().isVisible().catch(() => false),
  ]);

  const [hasMessage, hasConnect, hasPending, hasFollow] = checks.map(r => r.status === 'fulfilled' ? r.value : false);

  return {
    isConnected: hasMessage,
    canConnect: hasConnect || hasFollow,
    isPending: hasPending,
    hasMessageButton: hasMessage,
  };
}

async function openLinkedInMessage(page, username) {
  // LinkedIn has different states:
  // 1. Already connected - shows "Message" button
  // 2. Not connected - shows "Connect" button
  // 3. Pending - shows "Pending" button
  // 4. Follow only - some profiles only allow following

  // Check current connection status first
  const connectionStatus = await checkLinkedInConnectionStatus(page);

  if (connectionStatus.isPending) {
    throw new Error(`Cannot message ${username}. Connection request is still pending. You'll be able to message once they accept.`);
  }

  // Try clicking Message button first (already connected)
  const messageSelectors = [
    'button:has-text("Message")',
    'button[aria-label*="Message"]',
    '.artdeco-button--primary:has-text("Message")',
    'a[href*="/messaging/"]',
    '[data-test-id="message-button"]',
    '.msg-overlay-bubble-header',
  ];

  let clicked = await tryClick(page, messageSelectors);

  if (!clicked) {
    // Try finding by text with broader search
    clicked = await clickByText(page, ['button', 'div[role="button"]', 'a'], ['Message', 'Message ']);
  }

  // If no Message button, try Connect -> Add note flow
  if (!clicked) {
    const connectSelectors = [
      'button:has-text("Connect")',
      'button[aria-label*="Connect"]',
      '.artdeco-button--secondary:has-text("Connect")',
      '[data-test-id="connect-button"]',
    ];

    const followSelectors = [
      'button:has-text("Follow")',
      'button[aria-label*="Follow"]',
    ];

    // Try Connect first, then Follow as fallback
    let connectClicked = await tryClick(page, connectSelectors);

    if (!connectClicked) {
      connectClicked = await clickByText(page, ['button', 'div[role="button"]'], ['Connect', 'Connect ']);
    }

    if (connectClicked) {
      await waitForAppShell(page);
      await page.waitForTimeout(1000);

      // Click "Add a note" to customize the connection request
      const addNoteSelectors = [
        'button:has-text("Add a note")',
        'button:has-text("Add note")',
        'span:has-text("Add a note")',
        '[aria-label*="note"]',
      ];

      const addNoteClicked = await tryClick(page, addNoteSelectors) ||
                             await clickByText(page, ['button', 'span'], ['Add a note', 'Add note']);

      if (addNoteClicked) {
        await waitForAppShell(page);
        await page.waitForTimeout(800);

        // Verify the note textarea is available
        const noteComposer = await firstVisibleLocator(page, [
          'textarea[name="message"]',
          'textarea',
          'div[role="textbox"][contenteditable="true"]',
        ]);

        if (!noteComposer) {
          // Close dialog and try again or return simple connect
          await page.keyboard.press('Escape').catch(() => {});
          return { type: 'connection_request', noteAvailable: false, reason: 'Note composer not available' };
        }

        return { type: 'connection_request', noteAvailable: true };
      }

      // If no "Add note" button, it's a simple connect request
      return { type: 'connection_request', noteAvailable: false };
    }

    // If no Connect, try Follow (some profiles only allow following)
    const followClicked = await tryClick(page, followSelectors) ||
                          await clickByText(page, ['button'], ['Follow']);

    if (followClicked) {
      // After following, try Message button again
      await waitForAppShell(page);
      await page.waitForTimeout(1000);

      clicked = await tryClick(page, messageSelectors);

      if (!clicked) {
        throw new Error(`Followed ${username} but cannot message. Some LinkedIn profiles only allow messaging from connections, not followers.`);
      }
    }
  }

  if (!clicked && !clicked?.type) {
    // Last resort - navigate to messaging directly
    await navigate(page, 'https://www.linkedin.com/messaging/', 'linkedin');
    await waitForAppShell(page);

    // Try to search for the user in messaging
    const searchBox = await firstVisibleLocator(page, [
      'input[placeholder*="Search"]',
      'input[aria-label*="Search"]',
      '.msg-search-form__input',
      '[role="search"] input',
    ]);

    if (searchBox && username) {
      await searchBox.click({ timeout: 3000 }).catch(() => {});
      await searchBox.fill('').catch(() => {});
      await searchBox.type(username.slice(0, 20), { delay: 30 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Try multiple search result selectors
      const searchResults = [
        '.msg-search-result',
        '[data-test-id="search-result"]',
        '.msg-conversation-card',
        'li[role="option"]',
      ];

      for (const selector of searchResults) {
        const result = page.locator(selector).first();
        if (await result.isVisible().catch(() => false)) {
          await result.click().catch(() => {});
          break;
        }
      }
    }
  }

  await waitForAppShell(page);
  await page.waitForTimeout(1000);

  // Verify composer is available
  const composer = await firstVisibleLocator(page, [
    'textarea[name="message"]',
    'div[role="textbox"][contenteditable="true"]',
    'textarea',
    '.msg-form__contenteditable',
  ]);

  if (!composer && !clicked?.type) {
    throw new Error(`Could not open LinkedIn message composer for "${username}". You may need to connect with them first.`);
  }

  return { type: 'message', noteAvailable: true, wasConnected: connectionStatus.isConnected };
}

// Base social handler for non-DM actions
const baseHandler = createSocialHandler('linkedin', {
  async openMessage(page, username) {
    await openLinkedInMessage(page, username);
  },
  messageComposerSelectors: ['textarea[name="message"]', 'div[role="textbox"][contenteditable="true"]'],
  messageLengthLimit: 280,
  sendMessageLabels: ['Send', 'Invite'],
  followLabels: ['Follow', 'Connect'],
  async likePost(page) {
    await page.locator('button[aria-label*="Like"]').first().click().catch(() => {});
  },
  async openLatestPost(page) {
    await page.locator('button[aria-label*="Comment"]').first().click().catch(() => {});
  },
  commentSelectors: ['div[contenteditable="true"][role="textbox"]'],
  commentSubmitLabels: ['Post'],
  async openPostComposer(page) {
    await clickByText(page, ['button', 'div[role="button"]'], ['Start a post']).catch(() => {});
    await waitForAppShell(page);
  },
  postComposerSelectors: ['div[role="textbox"][contenteditable="true"]'],
  publishPostLabels: ['Post'],
});

// Enhanced handler with proper LinkedIn-specific DM flow
export const linkedinHandler = {
  platform: 'linkedin',
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;

    // Check login state for actions that require auth
    if (['send_message', 'draft_message', 'open_target', 'message_batch'].includes(action)) {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.linkedin, { platform: 'linkedin' });
      const state = await checkLoginState(page, 'linkedin');
      if (!state.ready) {
        throw new Error(state.message || 'Please log in to LinkedIn');
      }
    }

    // Handle DM-specific actions with custom LinkedIn flow
    if (action === 'open_target') {
      const { username } = args;
      if (!username) {
        throw new Error('LinkedIn open_target requires a username');
      }

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.linkedin, { platform: 'linkedin' });
      await navigateToLinkedInProfile(page, username);

      return {
        status: 'ready',
        summary: summarizeAction('linkedin', step),
        data: await pageSnapshot(page),
      };
    }

    if (action === 'draft_message') {
      const { username, messageGoal, tone, query } = args;

      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'linkedin',
        chatContext: [],
        profileInfo: {},
      });

      return {
        status: 'ready',
        summary: summarizeAction('linkedin', step),
        data: { preview: message },
      };
    }

    // Handle actions that should be delegated to base handler FIRST
    // These include engage_post, follow_user, compose_post, publish_post, etc.
    const baseHandlerActions = ['engage_post', 'engage_batch', 'follow_user', 'follow_batch', 'compose_post', 'publish_post', 'scrape_results'];
    if (baseHandlerActions.includes(action)) {
      return baseHandler.execute({ step, attachedBrowser });
    }

    if (action === 'send_message') {
      const { username, messageGoal, tone, query, requireManualReview, attachmentPath, attachmentType } = args;

      // Navigate to profile
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.linkedin, { platform: 'linkedin' });
      await navigateToLinkedInProfile(page, username);

      // Open message/connection dialog
      const messageType = await openLinkedInMessage(page, username);

      // Extract chat context if available
      const chatContext = await extractChatContext(page, 'linkedin', 6);

      // Generate message (shorter for LinkedIn)
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'linkedin',
        chatContext,
        profileInfo: {},
      });

      // Truncate for LinkedIn limits
      const truncatedMessage = message.slice(0, 280);

      // Fill composer based on message type
      let filled;
      if (messageType.type === 'connection_request' && messageType.noteAvailable) {
        // Fill connection note
        filled = await fillEditable(page, [
          'textarea[name="message"]',
          'textarea',
          'div[role="textbox"][contenteditable="true"]',
        ], truncatedMessage);
      } else {
        // Fill regular message
        filled = await fillEditable(page, [
          'textarea[name="message"]',
          'div[role="textbox"][contenteditable="true"]',
          'textarea',
        ], truncatedMessage);
      }

      // Handle file attachment if provided
      if (attachmentPath && messageType.type !== 'connection_request') {
        try {
          // Look for attachment button
          const attachBtn = await firstVisibleLocator(page, [
            'button[aria-label*="Attach"]',
            'button[aria-label*="attachment"]',
            'button:has-text("Attach")',
            '[data-testid="attach-file"]',
            'input[type="file"]',
          ]);

          if (attachBtn) {
            // If it's a file input, use it directly
            const isFileInput = await attachBtn.evaluate(el => el.tagName === 'INPUT').catch(() => false);
            if (isFileInput) {
              await attachBtn.setInputFiles(attachmentPath);
            } else {
              // Click button then find file input
              await attachBtn.click();
              await page.waitForTimeout(800);
              const fileInput = await page.locator('input[type="file"]').first();
              if (fileInput) {
                await fileInput.setInputFiles(attachmentPath);
              }
            }
            await page.waitForTimeout(2000); // Wait for upload
          }
        } catch (attachError) {
          console.warn('Attachment failed:', attachError.message);
        }
      }

      if (!filled.ok) {
        throw new Error(`Could not fill LinkedIn message composer for "${username}"`);
      }

      // Send if not manual review
      let sent = false;
      if (!requireManualReview) {
        if (messageType.type === 'connection_request') {
          // Send connection request
          sent = await submitComposer(page, ['button:has-text("Send")', 'button:has-text("Send invitation")'], ['Send', 'Send invitation']);
        } else {
          // Send regular message
          sent = await submitComposer(page, ['button:has-text("Send")'], ['Send']);
          if (!sent) {
            await page.keyboard.press('Enter').catch(() => {});
            sent = true;
          }
        }
      }

      return {
        status: 'completed',
        summary: summarizeAction('linkedin', step, { sent }),
        data: { page: await pageSnapshot(page), message: truncatedMessage, sent, type: messageType.type },
      };
    }

    if (action === 'message_batch') {
      const usernames = (args.usernames || []).slice(0, Math.max(1, Math.min(Number(args.maxResults) || 10, 15)));
      const results = [];

      for (const username of usernames) {
        try {
          const result = await this.execute({
            step: {
              action: 'send_message',
              platform: 'linkedin',
              args: { ...args, username },
            },
            attachedBrowser,
          });
          results.push({ username, ...result });
          // Random delay for LinkedIn
          await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        } catch (error) {
          results.push({ username, error: error.message, status: 'failed' });
        }
      }

      return {
        status: 'completed',
        summary: `Processed ${usernames.length} LinkedIn DM targets`,
        data: results,
      };
    }

    // Delegate all other actions to base handler
    return baseHandler.execute({ step, attachedBrowser });
  },
};
