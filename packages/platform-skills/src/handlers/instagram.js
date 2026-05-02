import {
  PLATFORM_URLS,
  buildPlatformTargetUrl,
  clickByText,
  fillEditable,
  firstVisibleLocator,
  generateOutreachMessage,
  navigate,
  openAttachedPage,
  openTargetPage,
  pageSnapshot,
  submitComposer,
  summarizeAction,
  tryClick,
  waitForAppShell,
  minimalDelay,
} from '../common.js';
import { checkLoginState } from '../state-checker.js';
import { extractChatContext } from '../chat-context.js';
import { createSocialHandler } from '../social-base.js';

// Instagram DM Helper Functions
async function navigateToProfile(page, username) {
  const url = buildPlatformTargetUrl('instagram', username);
  await navigate(page, url, 'instagram');
  await waitForAppShell(page, 'instagram');
}

async function checkInstagramFollowStatus(page) {
  // Use parallel checks for better performance and accuracy
  const checks = await Promise.allSettled([
    // Already following
    page.locator('button:has-text("Following"), div[role="button"]:has-text("Following"), button._acan._acao._acat').first().isVisible().catch(() => false),
    // Requested (private account follow pending)
    page.locator('button:has-text("Requested"), div[role="button"]:has-text("Requested")').first().isVisible().catch(() => false),
    // Can follow
    page.locator('button:has-text("Follow"), div[role="button"]:has-text("Follow"), button._acan._ap30').first().isVisible().catch(() => false),
    // Check for private account badge/text
    page.locator('text="This Account is Private", text="Private Account", svg[aria-label="Private Account"]').first().isVisible().catch(() => false),
    // Check if this is our own profile (no follow/message buttons)
    page.locator('text="Edit profile", text="Edit Profile"').first().isVisible().catch(() => false),
  ]);

  const [isFollowingResult, isRequestedResult, canFollowResult, isPrivateResult, isOwnProfileResult] =
    checks.map(r => r.status === 'fulfilled' ? r.value : false);

  return {
    isFollowing: isFollowingResult,
    requestPending: isRequestedResult,
    canFollow: canFollowResult,
    isPrivate: isPrivateResult,
    isOwnProfile: isOwnProfileResult,
  };
}

async function openInstagramMessageFromInbox(page, username) {
  // Primary method for private accounts: Go to inbox and search for user
  await navigate(page, 'https://www.instagram.com/direct/inbox/', 'instagram');
  await waitForAppShell(page, 'instagram');
  await minimalDelay(800);

  // Look for the "New message" or search button first
  const newMessageSelectors = [
    'button:has-text("New message")',
    'a[href="/direct/inbox/new/"]',
    'svg[aria-label="New message"]',
    'button[aria-label="New message"]',
    'div[role="button"]:has-text("New")',
  ];

  let openedSearch = await tryClick(page, newMessageSelectors);

  if (!openedSearch) {
    // Try clicking by text
    openedSearch = await clickByText(page, ['button', 'a', 'div[role="button"]'], ['New message', 'New']);
  }

  if (openedSearch) {
    await waitForAppShell(page, 'instagram');
    await minimalDelay(500);
  }

  // Look for search input (to: field)
  const searchBox = await firstVisibleLocator(page, [
    'input[placeholder*="Search"]',
    'input[aria-label*="Search"]',
    'input[placeholder*="To:"]',
    'input[name="queryBox"]',
    'input[type="text"]',
    'textarea[placeholder*="Search"]',
  ]);

  if (!searchBox) {
    return false;
  }

  // Click and type username
  await searchBox.click({ timeout: 3000 }).catch(() => {});
  await searchBox.fill('').catch(() => {});
  await searchBox.type(username, { delay: 20 }).catch(() => {});
  await minimalDelay(1000);

  // Try to find and click on the user in search results
  // Instagram shows results as clickable divs with the username
  const userResultSelectors = [
    `div[role="button"]:has-text("${username}")`,
    `div:has-text("${username}"):has(div)`,
    'div[role="dialog"] div[role="button"]',
    'div.x1n2onr6 div[role="button"]',
    'div._ab8w',
    'div._aacl._aaco',
  ];

  for (const selector of userResultSelectors) {
    const result = page.locator(selector).first();
    if (await result.isVisible().catch(() => false)) {
      await result.click().catch(() => {});

      // Wait to see if a conversation opened
      await minimalDelay(800);

      // Check if composer appeared
      const composer = await firstVisibleLocator(page, [
        'textarea',
        'div[contenteditable="true"]',
        'div[role="textbox"]',
        'input[placeholder*="Message"]',
      ]);

      if (composer) {
        return true;
      }
    }
  }

  // Try finding by text with partial match
  const results = await page.locator('div[role="button"], div[role="dialog"] div').all();
  for (const result of results) {
    const text = await result.textContent().catch(() => '');
    if (text.toLowerCase().includes(username.toLowerCase())) {
      await result.click().catch(() => {});
      await minimalDelay(800);

      const composer = await firstVisibleLocator(page, [
        'textarea',
        'div[contenteditable="true"]',
        'div[role="textbox"]',
      ]);

      if (composer) return true;
    }
  }

  return false;
}

async function openInstagramMessage(page, username) {
  // Instagram DM rules:
  // 1. Public accounts: Can message directly from profile
  // 2. Private accounts you follow: Can message directly from profile
  // 3. Private accounts you DON'T follow: MUST go through inbox search
  // 4. Your own profile: Cannot message yourself

  const followStatus = await checkInstagramFollowStatus(page);

  if (followStatus.isOwnProfile) {
    throw new Error(`Cannot message yourself (@${username})`);
  }

  // For private accounts we don't follow - go straight to inbox method
  if (followStatus.isPrivate && !followStatus.isFollowing) {
    // Try inbox method first (this sends a message request to private accounts)
    const inboxOpened = await openInstagramMessageFromInbox(page, username);

    if (inboxOpened) {
      await waitForAppShell(page, 'instagram');
      await minimalDelay(500);

      // Verify composer is available
      const composer = await firstVisibleLocator(page, [
        'textarea',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'div[role="textbox"]',
      ]);

      if (composer) {
        return {
          type: 'message_request',
          canSend: true,
          isFollowing: false,
          isPrivate: true,
          method: 'inbox_search',
        };
      }
    }

    // If inbox method failed, offer to follow them
    // Note: For private accounts, you can send a message request via inbox
    // even without following - but if inbox search didn't work, suggest following
    throw new Error(
      `Cannot message @${username}. This is a private account. ` +
      `Try following them first, or search for them directly in your Instagram inbox.`
    );
  }

  // For public accounts or accounts we follow - try profile Message button first
  const messageSelectors = [
    'button:has-text("Message")',
    'div[role="button"]:has-text("Message")',
    'button[type="button"]:has-text("Message")',
    'a[href*="/direct/t/"]',
    '[aria-label="Message"]',
    'svg[aria-label="Direct"]',
    'button._acan._acao._acas',
    'button._abl-',
  ];

  let clicked = await tryClick(page, messageSelectors);

  if (!clicked) {
    clicked = await clickByText(page, ['button', 'div[role="button"]', 'a', 'span'], ['Message', 'Message ']);
  }

  // If profile method failed, try inbox method as fallback
  if (!clicked) {
    const inboxOpened = await openInstagramMessageFromInbox(page, username);
    if (inboxOpened) {
      clicked = true;
    }
  }

  if (!clicked) {
    throw new Error(`Could not open Instagram message for "${username}". Message button not found.`);
  }

  await waitForAppShell(page);
  await page.waitForTimeout(1500);

  // Verify composer is available
  const composer = await firstVisibleLocator(page, [
    'textarea',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'div._abl-',
    'div[aria-label="Message"]',
    'div[role="textbox"]',
  ]);

  if (!composer) {
    throw new Error(`Could not open Instagram message composer for "${username}".`);
  }

  return {
    type: 'message',
    canSend: true,
    isFollowing: followStatus.isFollowing,
    isPrivate: followStatus.isPrivate,
  };
}

// Base social handler for non-DM actions
const baseHandler = createSocialHandler('instagram', {
  async openMessage(page, username) {
    await openInstagramMessage(page, username);
  },
  messageComposerSelectors: [
    'textarea',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
  ],
  sendMessageSelectors: ['button:has-text("Send")'],
  sendMessageLabels: ['Send'],
  followLabels: ['Follow'],
  async openLatestPost(page) {
    await page.locator('a[href*="/p/"], a[href*="/reel/"]').first().click().catch(() => {});
    await waitForAppShell(page, 'instagram');
  },
  async likePost(page) {
    await tryClick(page, ['svg[aria-label="Like"]', 'button svg[aria-label="Like"]']);
  },
  commentSelectors: [
    'textarea[placeholder*="comment"]', 
    'textarea[placeholder*="Add a comment"]',
    'textarea',
    'div[contenteditable="true"][aria-label*="comment"]',
    'div[contenteditable="true"]',
  ],
  commentSubmitSelectors: [
    'button[type="submit"]',
    'button:has-text("Post")',
    'div[role="button"]:has-text("Post")',
    'button:has-text("Share")',
    'button:has-svg[aria-label="Post"]',
    '[data-testid="post-button"]',
    '[data-testid="submit-button"]',
  ],
  commentSubmitLabels: ['Post', 'Share'],
  async openPostComposer(page) {
    await clickByText(page, ['a', 'div[role="button"]', 'button'], ['Create']).catch(() => {});
    await waitForAppShell(page, 'instagram');
  },
  postComposerSelectors: ['textarea', 'div[contenteditable="true"][role="textbox"]'],
  async sendComment(page) {
    // Instagram-specific comment submission with multiple strategies
    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Post")',
      'div[role="button"]:has-text("Post")',
      'button:has-text("Share")',
      'svg[aria-label="Post"]',
      'svg[aria-label="Share"]',
      '[data-testid="post-button"]',
      '[data-testid="submit-button"]',
      'button._abl-',
    ];

    // Try clicking submit button
    for (const selector of submitSelectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.count() > 0 && await locator.isVisible()) {
          await locator.click({ timeout: 3000 });
          await minimalDelay(300);
          return true;
        }
      } catch { /* continue */ }
    }

    // Try pressing Enter as fallback
    try {
      await page.keyboard.press('Enter');
      await minimalDelay(300);
      return true;
    } catch { /* fail silently */ }

    return false;
  },
});

// Enhanced handler with proper Instagram-specific DM flow
export const instagramHandler = {
  platform: 'instagram',
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;

    // Check login state for actions that require auth
    if (['send_message', 'draft_message', 'open_target', 'message_batch'].includes(action)) {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.instagram, { platform: 'instagram' });
      const state = await checkLoginState(page, 'instagram');
      if (!state.ready) {
        throw new Error(state.message || 'Please log in to Instagram');
      }
    }

    // Handle DM-specific actions with custom Instagram flow
    if (action === 'open_target') {
      const { username } = args;
      if (!username) {
        throw new Error('Instagram open_target requires a username');
      }

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.instagram, { platform: 'instagram' });
      await navigateToProfile(page, username);

      return {
        status: 'ready',
        summary: summarizeAction('instagram', step),
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
        platform: 'instagram',
        chatContext: [],
        profileInfo: {},
      });

      return {
        status: 'ready',
        summary: summarizeAction('instagram', step),
        data: { preview: message },
      };
    }

    if (action === 'send_message') {
      const { username, messageGoal, tone, query, requireManualReview, attachmentPath, attachmentType } = args;

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.instagram, { platform: 'instagram' });
      
      // Strategy: Try DM inbox search FIRST (works for all account types)
      // Only use direct profile URL as fallback
      let openedViaInbox = await openInstagramMessageFromInbox(page, username);
      let messageStatus;
      
      if (!openedViaInbox) {
        // Fallback: Navigate to profile and try message button
        console.log(`[Instagram] Inbox search failed for ${username}, trying profile...`);
        try {
          await navigateToProfile(page, username);
          messageStatus = await openInstagramMessage(page, username);
        } catch (profileError) {
          throw new Error(`Could not message ${username} on Instagram. Try searching for them directly in your Instagram inbox first.`);
        }
      } else {
        messageStatus = { type: 'message', canSend: true, method: 'inbox_search' };
      }

      // Extract chat context from the conversation
      const chatContext = await extractChatContext(page, 'instagram', 8);

      // Generate message with context awareness
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'instagram',
        chatContext,
        profileInfo: {},
      });

      // Fill composer
      const filled = await fillEditable(page, [
        'textarea',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
      ], message);

      if (!filled.ok) {
        throw new Error(`Could not fill Instagram message composer for "${username}"`);
      }

      // Handle file attachment if provided
      if (attachmentPath) {
        try {
          // Look for attachment button (gallery/camera icon)
          const attachBtn = await firstVisibleLocator(page, [
            'button[aria-label*="Add"]', // Add photo/video
            'button[aria-label*="Gallery"]', // Gallery
            'button[aria-label*="Attachment"]', // Attachment
            'svg[aria-label*="Gallery"]',
            'svg[aria-label*="Add"]',
            '[data-testid="add-attachment"]',
            'input[type="file"]',
          ]);

          if (attachBtn) {
            const isFileInput = await attachBtn.evaluate(el => el.tagName === 'INPUT').catch(() => false);
            if (isFileInput) {
              await attachBtn.setInputFiles(attachmentPath);
            } else {
              // Click the attachment button then find file input
              await attachBtn.click();
              await minimalDelay(500);
              const fileInput = await page.locator('input[type="file"]').first();
              if (fileInput) {
                await fileInput.setInputFiles(attachmentPath);
              }
            }
            await minimalDelay(1500); // Wait for upload
          }
        } catch (attachError) {
          console.warn('Instagram attachment failed:', attachError.message);
        }
      }

      // Send if not manual review
      let sent = false;
      if (!requireManualReview) {
        sent = await submitComposer(page, ['button:has-text("Send")'], ['Send']);
        if (!sent) {
          // Try pressing Enter as fallback
          await page.keyboard.press('Enter').catch(() => {});
          sent = true;
        }
      }

      return {
        status: 'completed',
        summary: summarizeAction('instagram', step, { sent }),
        data: { page: await pageSnapshot(page), message, sent },
      };
    }

    if (action === 'message_batch') {
      const usernames = (args.usernames || []).slice(0, Math.max(1, Math.min(Number(args.maxResults) || 10, 20)));
      const results = [];

      for (const username of usernames) {
        try {
          const result = await this.execute({
            step: {
              action: 'send_message',
              platform: 'instagram',
              args: { ...args, username },
            },
            attachedBrowser,
          });
          results.push({ username, ...result });
          // Random delay between messages
          await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));
        } catch (error) {
          results.push({ username, error: error.message, status: 'failed' });
        }
      }

      return {
        status: 'completed',
        summary: `Processed ${usernames.length} Instagram DM targets`,
        data: results,
      };
    }

    // Delegate all other actions to base handler
    return baseHandler.execute({ step, attachedBrowser });
  },
};
