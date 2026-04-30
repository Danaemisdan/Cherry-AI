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
} from '../common.js';
import { checkLoginState } from '../state-checker.js';
import { createSocialHandler } from '../social-base.js';

// Instagram DM Helper Functions
async function navigateToProfile(page, username) {
  const url = buildPlatformTargetUrl('instagram', username);
  await navigate(page, url, 'instagram');
  await waitForAppShell(page);
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

async function openInstagramMessage(page, username) {
  // Instagram DM rules:
  // 1. Public accounts: Message button available directly
  // 2. Private accounts you follow: Message button available
  // 3. Private accounts you don't follow: Must request to follow first, then message once accepted
  // 4. Your own profile: Cannot message yourself

  const followStatus = await checkInstagramFollowStatus(page);

  if (followStatus.isOwnProfile) {
    throw new Error(`Cannot message yourself (@${username})`);
  }

  // Try multiple selectors for the Message button
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

  // First try clicking Message button on profile
  let clicked = await tryClick(page, messageSelectors);

  if (!clicked) {
    // Try finding by text content with broader selectors
    clicked = await clickByText(page, ['button', 'div[role="button"]', 'a', 'span'], ['Message', 'Message ']);
  }

  if (!clicked && followStatus.requestPending) {
    // Already sent follow request, still can't message
    throw new Error(`Cannot message @${username}. Follow request already pending. You'll be able to message once they accept.`);
  }

  if (!clicked && followStatus.canFollow && followStatus.isPrivate) {
    // Private account - need to follow first
    const followSelectors = [
      'button:has-text("Follow")',
      'div[role="button"]:has-text("Follow")',
      'button._acan._ap30',
    ];

    const followed = await tryClick(page, followSelectors);

    if (followed) {
      await waitForAppShell(page);
      await page.waitForTimeout(1500);

      // Re-check status after following
      const newStatus = await checkInstagramFollowStatus(page);

      if (newStatus.requestPending) {
        // Follow request sent - can't message until accepted
        throw new Error(`Cannot message @${username}. Private account - follow request sent. You'll be able to message once they accept.`);
      }

      if (newStatus.isFollowing) {
        // Try Message button again after following
        clicked = await tryClick(page, messageSelectors);
      }
    }
  }

  if (!clicked && followStatus.isPrivate && !followStatus.isFollowing) {
    throw new Error(`Cannot message @${username}. This is a private account and you need to follow them first.`);
  }

  if (!clicked) {
    // Last resort - navigate to direct inbox and search for user
    await navigate(page, 'https://www.instagram.com/direct/inbox/', 'instagram');
    await waitForAppShell(page);

    // Look for search in inbox with multiple selectors
    const searchBox = await firstVisibleLocator(page, [
      'input[placeholder*="Search"]',
      'input[aria-label*="Search"]',
      'input[name="queryBox"]',
      'div[role="textbox"]',
      'input[type="text"]',
    ]);

    if (searchBox && username) {
      await searchBox.click({ timeout: 3000 }).catch(() => {});
      await searchBox.fill('').catch(() => {});
      await searchBox.type(username.slice(0, 20), { delay: 50 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Try multiple search result selectors
      const searchResultSelectors = [
        'div[role="button"]',
        'a[href*="/direct/t/"]',
        'div._ab8w',
        'div._aacl',
      ];

      for (const selector of searchResultSelectors) {
        const results = page.locator(selector).filter({ hasText: new RegExp(username, 'i') }).first();
        if (await results.isVisible().catch(() => false)) {
          await results.click().catch(() => {});
          clicked = true;
          break;
        }
      }
    }
  }

  await waitForAppShell(page);
  await page.waitForTimeout(1500);

  // Verify message composer is available with multiple selectors
  const composer = await firstVisibleLocator(page, [
    'textarea',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'div._abl-',
    'div[aria-label="Message"]',
  ]);

  if (!composer) {
    throw new Error(`Could not open Instagram message composer for "${username}". They may have restricted messaging.`);
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
    await waitForAppShell(page);
  },
  async likePost(page) {
    await tryClick(page, ['svg[aria-label="Like"]', 'button svg[aria-label="Like"]']);
  },
  commentSelectors: ['textarea[placeholder*="comment"]', 'textarea'],
  commentSubmitLabels: ['Post'],
  async openPostComposer(page) {
    await clickByText(page, ['a', 'div[role="button"]', 'button'], ['Create']).catch(() => {});
    await waitForAppShell(page);
  },
  postComposerSelectors: ['textarea', 'div[contenteditable="true"][role="textbox"]'],
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
      });

      return {
        status: 'ready',
        summary: summarizeAction('instagram', step),
        data: { preview: message },
      };
    }

    if (action === 'send_message') {
      const { username, messageGoal, tone, query, requireManualReview } = args;

      // Navigate to profile and open message
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.instagram, { platform: 'instagram' });
      await navigateToProfile(page, username);
      await openInstagramMessage(page, username);

      // Generate message
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'instagram',
        chatContext: [],
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
