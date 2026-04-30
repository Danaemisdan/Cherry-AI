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
import { createSocialHandler } from '../social-base.js';

// Twitter DM Helper Functions
async function navigateToTwitterProfile(page, username) {
  const url = buildPlatformTargetUrl('twitter', username);
  await navigate(page, url, 'twitter');
  await waitForAppShell(page);
}

async function checkTwitterFollowStatus(page) {
  // Use parallel checks for better accuracy
  const checks = await Promise.allSettled([
    // Following button exists
    page.locator('button[data-testid$="-unfollow"], button[aria-label*="Following"], button[aria-label="Following"]').first().isVisible().catch(() => false),
    // Follow button exists (not following yet)
    page.locator('button[data-testid$="-follow"], button[aria-label*="Follow"]').first().isVisible().catch(() => false),
    // Check for blocked/suspended account indicator
    page.locator('text="Account suspended", text="This account doesn\'t exist", text="User not found"').first().isVisible().catch(() => false),
    // Check for private account
    page.locator('text="These posts are protected", [data-testid="lock"]').first().isVisible().catch(() => false),
  ]);

  const [isFollowingResult, canFollowResult, isBlockedResult, isPrivateResult] =
    checks.map(r => r.status === 'fulfilled' ? r.value : false);

  return {
    isFollowing: isFollowingResult,
    canFollow: canFollowResult,
    isBlocked: isBlockedResult,
    isPrivate: isPrivateResult,
    isValidProfile: !isBlockedResult,
  };
}

async function openTwitterMessage(page, username) {
  // Twitter DM rules:
  // 1. You can DM anyone who follows you (mutual follow not required)
  // 2. Some users allow DMs from anyone (open DMs)
  // 3. If you can't DM, you need to follow them first and wait for followback
  // 4. Protected/private accounts may have different DM rules

  const followStatus = await checkTwitterFollowStatus(page);

  if (!followStatus.isValidProfile) {
    throw new Error(`Cannot message @${username}. Profile doesn't exist or account is suspended.`);
  }

  // Try multiple Message button selectors
  const messageSelectors = [
    'div[data-testid="sendDMFromProfile"]',
    'button[aria-label*="Message"]',
    'a[href*="/messages/"]',
    '[data-testid="DmButton"]',
    'button:has-text("Message")',
  ];

  let clicked = await tryClick(page, messageSelectors);

  if (!clicked) {
    // Try clicking by text with broader search
    clicked = await clickByText(page, ['button', 'div[role="button"]', 'a'], ['Message', 'Message @' + username]);
  }

  if (!clicked && followStatus.canFollow) {
    // Follow first, then try to message
    const followSelectors = [
      'button[data-testid$="-follow"]',
      'button[aria-label*="Follow"]',
      'button:has-text("Follow")',
    ];

    const followed = await tryClick(page, followSelectors);

    if (followed) {
      await waitForAppShell(page);
      await page.waitForTimeout(1500);

      // Try message button again after following
      clicked = await tryClick(page, messageSelectors);

      if (!clicked) {
        // Still can't message - likely they don't allow DMs from non-followers
        throw new Error(`Cannot message @${username}. They don't accept DMs from non-followers. Followed them - you'll be able to DM once they follow back.`);
      }
    }
  }

  if (!clicked) {
    throw new Error(`Could not open Twitter DM for @${username}. They may have restricted DMs or only accept from followers.`);
  }

  await waitForAppShell(page);
  await page.waitForTimeout(1000);

  // Verify composer is available with multiple selectors
  const composer = await firstVisibleLocator(page, [
    'div[data-testid="dmComposerTextInput"]',
    'div[contenteditable="true"][role="textbox"]',
    'textarea',
    '[data-testid="dmComposerTextInput"]',
  ]);

  if (!composer) {
    throw new Error(`Could not open Twitter message composer for @${username}`);
  }

  return {
    type: 'message',
    canSend: true,
    isFollowing: followStatus.isFollowing,
    isPrivate: followStatus.isPrivate,
  };
}

// Base social handler for non-DM actions
const baseHandler = createSocialHandler('twitter', {
  async openMessage(page, username) {
    await openTwitterMessage(page, username);
  },
  messageComposerSelectors: ['div[data-testid="dmComposerTextInput"]', 'div[contenteditable="true"][role="textbox"]'],
  sendMessageSelectors: ['button[data-testid="dmComposerSendButton"]'],
  sendMessageLabels: ['Send'],
  followLabels: ['Follow'],
  followClickSelectors: ['button[data-testid$="-follow"]'],
  async openLatestPost(page) {
    const article = page.locator('article[data-testid="tweet"]').first();
    await article.scrollIntoViewIfNeeded().catch(() => {});
    await article.locator('button[data-testid="reply"]').click().catch(() => {});
    await waitForAppShell(page);
  },
  async likePost(page) {
    await page.locator('article[data-testid="tweet"]').first().locator('button[data-testid="like"]').click().catch(() => {});
  },
  commentSelectors: ['div[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]'],
  commentSubmitSelectors: ['button[data-testid="tweetButton"]'],
  commentSubmitLabels: ['Reply'],
  postComposerSelectors: ['div[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]'],
  publishPostSelectors: ['button[data-testid="tweetButtonInline"]', 'button[data-testid="tweetButton"]'],
  publishPostLabels: ['Post'],
});

// Enhanced handler with proper Twitter-specific DM flow
export const twitterHandler = {
  platform: 'twitter',
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;

    // Check login state for actions that require auth
    if (['send_message', 'draft_message', 'open_target', 'message_batch'].includes(action)) {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.twitter, { platform: 'twitter' });
      const state = await checkLoginState(page, 'twitter');
      if (!state.ready) {
        throw new Error(state.message || 'Please log in to Twitter/X');
      }
    }

    // Handle DM-specific actions with custom Twitter flow
    if (action === 'open_target') {
      const { username } = args;
      if (!username) {
        throw new Error('Twitter open_target requires a username');
      }

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.twitter, { platform: 'twitter' });
      await navigateToTwitterProfile(page, username);

      // Check follow status
      const followStatus = await checkTwitterFollowStatus(page);

      return {
        status: 'ready',
        summary: summarizeAction('twitter', step),
        data: { ...await pageSnapshot(page), followStatus },
      };
    }

    if (action === 'draft_message') {
      const { username, messageGoal, tone, query } = args;

      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'twitter',
        chatContext: [],
      });

      return {
        status: 'ready',
        summary: summarizeAction('twitter', step),
        data: { preview: message },
      };
    }

    if (action === 'send_message') {
      const { username, messageGoal, tone, query, requireManualReview } = args;

      // Navigate to profile
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.twitter, { platform: 'twitter' });
      await navigateToTwitterProfile(page, username);

      // Open message
      const messageStatus = await openTwitterMessage(page, username);

      // Generate message
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'twitter',
        chatContext: [],
      });

      // Fill composer
      const filled = await fillEditable(page, [
        'div[data-testid="dmComposerTextInput"]',
        'div[contenteditable="true"][role="textbox"]',
        'textarea',
      ], message);

      if (!filled.ok) {
        throw new Error(`Could not fill Twitter message composer for "${username}"`);
      }

      // Send if not manual review
      let sent = false;
      if (!requireManualReview) {
        sent = await submitComposer(page, ['button[data-testid="dmComposerSendButton"]'], ['Send']);
        if (!sent) {
          await page.keyboard.press('Enter').catch(() => {});
          sent = true;
        }
      }

      return {
        status: 'completed',
        summary: summarizeAction('twitter', step, { sent }),
        data: { page: await pageSnapshot(page), message, sent, ...messageStatus },
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
              platform: 'twitter',
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
        summary: `Processed ${usernames.length} Twitter DM targets`,
        data: results,
      };
    }

    // Delegate all other actions to base handler
    return baseHandler.execute({ step, attachedBrowser });
  },
};
