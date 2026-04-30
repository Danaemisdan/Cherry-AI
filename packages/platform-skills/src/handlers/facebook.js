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

// Facebook DM Helper Functions
async function navigateToFacebookProfile(page, username) {
  const url = buildPlatformTargetUrl('facebook', username);
  await navigate(page, url, 'facebook');
  await waitForAppShell(page);
}

async function checkFacebookFriendStatus(page) {
  // Use parallel checks for better accuracy
  const checks = await Promise.allSettled([
    // Already friends - Friends button exists
    page.locator('button:has-text("Friends"), button[aria-label*="Friends"], div[role="button"]:has-text("Friends"), [data-testid="friendship-button"]').first().isVisible().catch(() => false),
    // Can add friend
    page.locator('button:has-text("Add friend"), button:has-text("Add Friend"), button[aria-label*="Add Friend"], div[role="button"]:has-text("Add friend")').first().isVisible().catch(() => false),
    // Cancel request (request already sent)
    page.locator('button:has-text("Cancel Request"), button:has-text("Cancel request")').first().isVisible().catch(() => false),
    // Message button visible
    page.locator('button:has-text("Message"), a:has-text("Message"), div[role="button"]:has-text("Message"), [aria-label="Message"]').first().isVisible().catch(() => false),
    // Follow button (pages or public figures)
    page.locator('button:has-text("Follow"), div[role="button"]:has-text("Follow")').first().isVisible().catch(() => false),
    // Check if this is our own profile
    page.locator('text="Edit profile", [aria-label="Edit profile"]').first().isVisible().catch(() => false),
    // Check for content not available (blocked or private)
    page.locator('text="Content not available", text="This content isn\'t available right now"').first().isVisible().catch(() => false),
  ]);

  const [isFriendResult, canAddFriendResult, hasRequestPendingResult, hasMessageResult, canFollowResult, isOwnProfileResult, isBlockedResult] =
    checks.map(r => r.status === 'fulfilled' ? r.value : false);

  return {
    isFriend: isFriendResult,
    canAddFriend: canAddFriendResult,
    requestPending: hasRequestPendingResult,
    hasMessageButton: hasMessageResult,
    canFollow: canFollowResult,
    isOwnProfile: isOwnProfileResult,
    isValidProfile: !isBlockedResult,
  };
}

async function openFacebookMessage(page, username) {
  // Facebook DM rules:
  // 1. Best case: Already friends - Message button available
  // 2. Not friends but Message button visible (some pages/public figures allow this)
  // 3. Not friends, need to add friend first - will show Add Friend
  // 4. Can follow instead (pages/public figures)
  // 5. Can't message at all - no Message button and can't add friend

  const friendStatus = await checkFacebookFriendStatus(page);

  if (!friendStatus.isValidProfile) {
    throw new Error(`Cannot message ${username}. Profile not found or content unavailable.`);
  }

  if (friendStatus.isOwnProfile) {
    throw new Error(`Cannot message yourself (${username})`);
  }

  if (friendStatus.requestPending) {
    throw new Error(`Cannot message ${username}. Friend request already pending. You'll be able to message once they accept.`);
  }

  // Try multiple Message button selectors
  const messageSelectors = [
    'button:has-text("Message")',
    'a:has-text("Message")',
    'div[role="button"]:has-text("Message")',
    '[aria-label="Message"]',
    '[data-testid="message-button"]',
    'div[aria-label="Message"]',
  ];

  let clicked = await tryClick(page, messageSelectors);

  if (!clicked) {
    // Try clicking by text with broader search
    clicked = await clickByText(page, ['a', 'div[role="button"]', 'button', 'span'], ['Message', 'Messages']);
  }

  // If no Message button and we can add friend, send friend request
  if (!clicked && friendStatus.canAddFriend) {
    const addFriendSelectors = [
      'button:has-text("Add friend")',
      'button:has-text("Add Friend")',
      'div[role="button"]:has-text("Add friend")',
      '[data-testid="friend-add-button"]',
    ];

    const friendRequestSent = await tryClick(page, addFriendSelectors);

    if (friendRequestSent) {
      await waitForAppShell(page);
      await page.waitForTimeout(1500);

      // Re-check status after adding friend
      const newStatus = await checkFacebookFriendStatus(page);

      if (newStatus.isFriend) {
        // Try message button again after becoming friends (rare but possible)
        clicked = await tryClick(page, messageSelectors);
      }

      if (!clicked) {
        // Still no message button - friend request is pending
        throw new Error(`Cannot message ${username}. Friend request sent - you'll be able to message once they accept.`);
      }
    }
  }

  // If we can follow (pages/public figures), follow then try message again
  if (!clicked && friendStatus.canFollow) {
    const followSelectors = [
      'button:has-text("Follow")',
      'div[role="button"]:has-text("Follow")',
    ];

    const followed = await tryClick(page, followSelectors) ||
                     await clickByText(page, ['button', 'div[role="button"]'], ['Follow']);

    if (followed) {
      await waitForAppShell(page);
      await page.waitForTimeout(1000);

      // Try message button again after following
      clicked = await tryClick(page, messageSelectors);

      if (!clicked) {
        throw new Error(`Followed ${username} but cannot message. Some Facebook pages only allow messaging from friends.`);
      }
    }
  }

  if (!clicked) {
    throw new Error(`Could not open Facebook message for ${username}. You may need to be friends first, or they may have restricted messaging.`);
  }

  await waitForAppShell(page);
  await page.waitForTimeout(2000); // Facebook messenger takes longer to load

  // Look for composer with extensive selectors
  const composerSelectors = [
    'div[role="textbox"][contenteditable="true"]',
    'textarea',
    'div[contenteditable="true"]',
    'div[aria-label="Message"][contenteditable="true"]',
    'div[data-testid="mw_message_input"]',
    'div[data-testid="message-composer-input"]',
    '[role="main"] div[contenteditable="true"]',
  ];

  const composer = await firstVisibleLocator(page, composerSelectors);

  if (!composer) {
    // Might have opened in messenger.com in new tab
    const currentUrl = page.url();
    if (currentUrl.includes('messenger.com') || currentUrl.includes('/messages/') || currentUrl.includes('/t/')) {
      await waitForAppShell(page);
      await page.waitForTimeout(3000);

      const messengerComposer = await firstVisibleLocator(page, [
        'div[contenteditable="true"]',
        'div[role="textbox"]',
        'textarea',
        'div[data-testid="messenger-composer"]',
        '[data-testid="message-composer-input"]',
      ]);

      if (!messengerComposer) {
        throw new Error(`Messenger opened but could not find composer for ${username}`);
      }
    } else {
      throw new Error(`Could not open Facebook message composer for ${username}`);
    }
  }

  return {
    type: 'message',
    canSend: true,
    isFriend: friendStatus.isFriend,
    friendRequestSent: !friendStatus.isFriend && friendStatus.canAddFriend,
  };
}

// Base social handler for non-DM actions
const baseHandler = createSocialHandler('facebook', {
  async openMessage(page, username) {
    await openFacebookMessage(page, username);
  },
  messageComposerSelectors: ['div[role="textbox"][contenteditable="true"]', 'textarea'],
  async sendMessage(page) {
    await page.keyboard.press('Enter').catch(() => {});
  },
  followLabels: ['Follow', 'Add friend'],
  async likePost(page) {
    await clickByText(page, ['div[role="button"]', 'button'], ['Like']).catch(() => {});
  },
  commentSelectors: ['div[role="textbox"][contenteditable="true"]'],
  async sendComment(page) {
    await page.keyboard.press('Enter').catch(() => {});
  },
  async openPostComposer(page) {
    await clickByText(page, ['div[role="button"]', 'button'], [`What's on your mind`, 'Create post']).catch(() => {});
    await waitForAppShell(page);
  },
  postComposerSelectors: ['div[role="textbox"][contenteditable="true"]'],
  publishPostLabels: ['Post'],
});

// Enhanced handler with proper Facebook-specific DM flow
export const facebookHandler = {
  platform: 'facebook',
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;

    // Check login state for actions that require auth
    if (['send_message', 'draft_message', 'open_target', 'message_batch'].includes(action)) {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.facebook, { platform: 'facebook' });
      const state = await checkLoginState(page, 'facebook');
      if (!state.ready) {
        throw new Error(state.message || 'Please log in to Facebook');
      }
    }

    // Handle DM-specific actions with custom Facebook flow
    if (action === 'open_target') {
      const { username } = args;
      if (!username) {
        throw new Error('Facebook open_target requires a username');
      }

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.facebook, { platform: 'facebook' });
      await navigateToFacebookProfile(page, username);

      // Check friend status
      const friendStatus = await checkFacebookFriendStatus(page);

      return {
        status: 'ready',
        summary: summarizeAction('facebook', step),
        data: { ...await pageSnapshot(page), friendStatus },
      };
    }

    if (action === 'draft_message') {
      const { username, messageGoal, tone, query } = args;

      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'facebook',
        chatContext: [],
        profileInfo: {},
      });

      return {
        status: 'ready',
        summary: summarizeAction('facebook', step),
        data: { preview: message },
      };
    }

    if (action === 'send_message') {
      const { username, messageGoal, tone, query, requireManualReview } = args;

      // Navigate to profile
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.facebook, { platform: 'facebook' });
      await navigateToFacebookProfile(page, username);

      // Open message
      const messageStatus = await openFacebookMessage(page, username);

      // Extract chat context
      const chatContext = await extractChatContext(page, 'facebook', 6);

      // Generate message with context
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'facebook',
        chatContext,
        profileInfo: {},
      });

      // Fill composer - Facebook uses contenteditable divs
      const filled = await fillEditable(page, [
        'div[role="textbox"][contenteditable="true"]',
        'div[contenteditable="true"]',
        'textarea',
        'div[aria-label="Message"][contenteditable="true"]',
      ], message);

      if (!filled.ok) {
        throw new Error(`Could not fill Facebook message composer for "${username}"`);
      }

      // Send if not manual review
      let sent = false;
      if (!requireManualReview) {
        // Facebook messages send with Enter or click send button
        sent = await submitComposer(page, ['div[aria-label="Send"]', 'button:has-text("Send")'], ['Send']);
        if (!sent) {
          await page.keyboard.press('Enter').catch(() => {});
          sent = true;
        }
      }

      return {
        status: 'completed',
        summary: summarizeAction('facebook', step, { sent }),
        data: { page: await pageSnapshot(page), message, sent, ...messageStatus },
      };
    }

    if (action === 'message_batch') {
      const usernames = (args.usernames || []).slice(0, Math.max(1, Math.min(Number(args.maxResults) || 10, 10))); // Lower limit for Facebook
      const results = [];

      for (const username of usernames) {
        try {
          const result = await this.execute({
            step: {
              action: 'send_message',
              platform: 'facebook',
              args: { ...args, username },
            },
            attachedBrowser,
          });
          results.push({ username, ...result });
          // Longer random delay for Facebook (more restrictive)
          await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        } catch (error) {
          results.push({ username, error: error.message, status: 'failed' });
        }
      }

      return {
        status: 'completed',
        summary: `Processed ${usernames.length} Facebook DM targets`,
        data: results,
      };
    }

    // Delegate all other actions to base handler
    return baseHandler.execute({ step, attachedBrowser });
  },
};
