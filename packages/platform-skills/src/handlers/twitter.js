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
  minimalDelay,
} from '../common.js';
import { checkLoginState } from '../state-checker.js';
import { extractChatContext } from '../chat-context.js';
import { extractProfileContext, formatProfileContext } from '../profile-context.js';
import { createSocialHandler } from '../social-base.js';

// Twitter DM Helper Functions
async function navigateToTwitterProfile(page, username) {
  // Strategy: Try human-like search navigation first
  try {
    const searchInput = await firstVisibleLocator(page, [
      'input[data-testid="SearchBox_Search_Input"]',
      'input[aria-label="Search query"]',
      'input[placeholder*="Search"]'
    ]);
    if (searchInput) {
      await searchInput.click();
      await searchInput.fill('');
      await searchInput.type(username, { delay: 50 });
      await page.keyboard.press('Enter');
      await minimalDelay(2000);
      
      const peopleTab = await firstVisibleLocator(page, [
        'a[role="tab"]:has-text("People")',
        'span:has-text("People")'
      ]);
      if (peopleTab) {
        await peopleTab.click();
        await minimalDelay(1500);
      }
      
      const userCell = await firstVisibleLocator(page, [
        `div[data-testid="UserCell"]:has-text("@${username}")`,
        'div[data-testid="UserCell"]'
      ]);
      if (userCell) {
        await userCell.click();
        await waitForAppShell(page, 'twitter');
        await minimalDelay(1000);
        return;
      }
    }
  } catch (e) {
    console.log('[Twitter] UI search failed, falling back to URL navigation', e.message);
  }

  // Fallback to URL
  const url = buildPlatformTargetUrl('twitter', username);
  await navigate(page, url, 'twitter');
  await waitForAppShell(page, 'twitter');
  await minimalDelay(1000);
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

// Method A: DM an existing contact — uses the Search box in the left DM rail
async function openTwitterDMContact(page, username) {
  console.log(`[Twitter] DM Contact: navigating to messages and searching left rail...`);
  await navigate(page, 'https://x.com/messages', 'twitter');
  await waitForAppShell(page, 'twitter');
  await minimalDelay(2000);

  // Click the Search button/input in the left DM rail (NOT the global search or compose button)
  const searchInput = await firstVisibleLocator(page, [
    'input[placeholder="Search Direct Messages"]',
    'input[aria-label="Search Direct Messages"]',
    'input[data-testid="dmSearchInput"]',
    'input[placeholder*="Search"]',
  ]);

  if (!searchInput) {
    console.log('[Twitter] DM search box not found in messages panel');
    return false;
  }

  await searchInput.click();
  await minimalDelay(400);
  await searchInput.fill('');
  await searchInput.type(username, { delay: 60 });
  await minimalDelay(2500);

  // Click the first matching result in the left rail
  const result = await firstVisibleLocator(page, [
    `div[data-testid="conversation"]:has-text("@${username}")`,
    `div[data-testid="conversation"]:has-text("${username}")`,
    'div[data-testid="conversation"]',
    `div[role="option"]:has-text("${username}")`,
    'div[role="option"]',
  ]);

  if (!result) {
    console.log(`[Twitter] No DM conversation found for @${username}`);
    return false;
  }

  await result.click();
  await minimalDelay(1500);

  // Verify the DM composer opened (not a tweet composer)
  const composer = await firstVisibleLocator(page, [
    'div[data-testid="dmComposerTextInput"]',
    'div[contenteditable="true"][data-testid*="dm"]',
  ]);
  return !!composer;
}

// Method B: DM a new person — clicks the New message (pencil) button, searches, confirms
async function openTwitterDMNew(page, username) {
  console.log(`[Twitter] DM New: opening new message composer...`);
  await navigate(page, 'https://x.com/messages', 'twitter');
  await waitForAppShell(page, 'twitter');
  await minimalDelay(2000);

  // Click the "New message" pencil/compose button — NOT the global compose tweet button
  const newMsgClicked = await tryClick(page, [
    'button[aria-label="New message"]',
    'button[data-testid="newDmButton"]',
    'a[href="/messages/compose"]',
  ]);

  if (!newMsgClicked) {
    // Try clicking by visible text, but be careful to avoid the global tweet compose button
    const btns = await page.locator('button, a[role="button"]').all();
    let clicked = false;
    for (const btn of btns) {
      const label = await btn.getAttribute('aria-label').catch(() => '');
      const text  = await btn.innerText().catch(() => '');
      if (/^new message$/i.test(label) || /^new message$/i.test(text.trim())) {
        await btn.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      console.log('[Twitter] New message button not found');
      return false;
    }
  }

  await minimalDelay(1200);

  // In the compose-recipient modal, find the people search input
  const searchBox = await firstVisibleLocator(page, [
    'input[placeholder="Search people"]',
    'input[aria-label="Search people"]',
    'input[data-testid="dmComposerRecipientInput"]',
    'input[placeholder*="Search"]',
  ]);

  if (!searchBox) {
    console.log('[Twitter] Recipient search box not found in new DM modal');
    return false;
  }

  await searchBox.click();
  await searchBox.fill('');
  await searchBox.type(username, { delay: 50 });
  await minimalDelay(2000);

  // Click the matching user in the typeahead dropdown
  const userResult = await firstVisibleLocator(page, [
    `div[data-testid="TypeaheadUser"]:has-text("@${username}")`,
    `div[data-testid="TypeaheadUser"]:has-text("${username}")`,
    'div[data-testid="TypeaheadUser"]',
    'div[role="option"]',
  ]);

  if (userResult) {
    await userResult.click();
    await minimalDelay(1000);
  } else {
    // Try Enter as fallback
    await page.keyboard.press('Enter');
    await minimalDelay(1000);
  }

  // Click "Next" to open the conversation
  const nextClicked = await tryClick(page, [
    'button[data-testid="nextButton"]',
    'button:has-text("Next")',
  ]);
  if (!nextClicked) await clickByText(page, ['button'], ['Next']);
  await minimalDelay(1000);

  // Confirm DM composer appeared (NOT the tweet composer)
  const composer = await firstVisibleLocator(page, [
    'div[data-testid="dmComposerTextInput"]',
    'div[contenteditable="true"][data-testid*="dm"]',
  ]);
  return !!composer;
}

// Legacy wrapper — always uses New message flow
async function openTwitterMessageFromInbox(page, username) {
  return openTwitterDMNew(page, username);
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
      await waitForAppShell(page, 'twitter');
      await minimalDelay(800);

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

  await waitForAppShell(page, 'twitter');
  await minimalDelay(500);

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
    await waitForAppShell(page, 'twitter');
  },
  async likePost(page) {
    await page.locator('article[data-testid="tweet"]').first().locator('button[data-testid="like"]').click().catch(() => {});
  },
  commentSelectors: ['div[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]', 'div[aria-label="Post text"]'],
  commentSubmitSelectors: ['button[data-testid="tweetButtonInline"]', 'button[data-testid="tweetButton"]', 'button[aria-label="Reply"]'],
  commentSubmitLabels: ['Reply'],
  async openPostComposer(page) {
    // Try clicking human-like compose buttons first
    const composeButtons = [
      'a[data-testid="SideNav_NewTweet_Button"]',
      'a[aria-label="Post"]',
      'a[aria-label="Compose post"]',
      'div[data-testid="tweetTextarea_0"]',
      'div[aria-label="Post text"]'
    ];
    
    let clicked = await tryClick(page, composeButtons);
    
    if (clicked) {
      await minimalDelay(1000);
      return;
    }

    // Fallback to URL
    await navigate(page, 'https://twitter.com/compose/tweet', 'twitter');
    await waitForAppShell(page, 'twitter');
    await minimalDelay(1000);
  },
  postComposerSelectors: ['div[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]', 'div[aria-label="Post text"]'],
  publishPostSelectors: ['button[data-testid="tweetButtonInline"]', 'button[data-testid="tweetButton"]', 'button[aria-label="Post"]'],
  publishPostLabels: ['Post', 'Tweet'],
  async attachMedia(page, filePath) {
    // Twitter/X-specific media upload
    try {
      // Look for file input or media button
      const fileInput = await page.locator('input[type="file"]').first();
      if (await fileInput.count() > 0) {
        await fileInput.setInputFiles(filePath);
        await minimalDelay(3000);
        return true;
      }
      
      // Try clicking media button first
      const mediaBtn = await page.locator('button[aria-label="Add photos or video"], button[data-testid="photo"], svg[aria-label="Media"]').first();
      if (await mediaBtn.count() > 0) {
        await mediaBtn.click();
        await minimalDelay(1000);
        const input = await page.locator('input[type="file"]').first();
        if (await input.count() > 0) {
          await input.setInputFiles(filePath);
          await minimalDelay(3000);
          return true;
        }
      }
    } catch (e) {
      console.warn('[Twitter] Media upload failed:', e.message);
    }
    return false;
  },
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
        profileInfo: {},
      });

      return {
        status: 'ready',
        summary: summarizeAction('twitter', step),
        data: { preview: message },
      };
    }

    if (action === 'send_message') {
      const { username, messageGoal, tone, query, requireManualReview, operation } = args;

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.twitter, { platform: 'twitter' });

      // Route to the correct DM flow based on operation
      let chatOpened = false;
      let messageStatus;

      if (operation === 'auto_dm_contact') {
        // Existing contact → search in left DM rail
        console.log(`[Twitter] auto_dm_contact: using left-rail DM search for @${username}`);
        chatOpened = await openTwitterDMContact(page, username);
        if (!chatOpened) {
          throw new Error(`Could not find @${username} in your Twitter DMs. Make sure they are an existing contact.`);
        }
        messageStatus = { type: 'message', canSend: true, method: 'dm_search' };

      } else if (operation === 'auto_dm_new' || operation === 'auto_dm') {
        // New person → New message button → recipient search modal
        console.log(`[Twitter] auto_dm_new: using New message button for @${username}`);
        chatOpened = await openTwitterDMNew(page, username);
        if (!chatOpened) {
          // Fallback: navigate to profile and click Message button
          console.log(`[Twitter] New message modal failed, trying profile Message button...`);
          try {
            await navigateToTwitterProfile(page, username);
            messageStatus = await openTwitterMessage(page, username);
            chatOpened = true;
          } catch (profileError) {
            throw new Error(`Could not open Twitter DM for @${username}. They may have restricted DMs.`);
          }
        } else {
          messageStatus = { type: 'message', canSend: true, method: 'new_message_modal' };
        }

      } else {
        // Generic: try inbox search first, then profile fallback
        chatOpened = await openTwitterDMNew(page, username);
        if (!chatOpened) {
          try {
            await navigateToTwitterProfile(page, username);
            messageStatus = await openTwitterMessage(page, username);
            chatOpened = true;
          } catch (profileError) {
            throw new Error(`Could not message @${username} on Twitter. They may have restricted DMs.`);
          }
        } else {
          messageStatus = { type: 'message', canSend: true, method: 'inbox_search' };
        }
      }

      // Extract chat context
      const chatContext = await extractChatContext(page, 'twitter', 6);

      // Extract profile context
      console.log(`[Twitter] Extracting profile context for ${username}...`);
      const rawProfileInfo = await extractProfileContext(page, 'twitter', username);
      const profileInfo = formatProfileContext(rawProfileInfo, 'twitter');

      // Generate message
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'twitter',
        chatContext,
        profileInfo,
      });

      // Fill the DM composer — use ONLY the DM text input, never the tweet composer
      const filled = await fillEditable(page, [
        'div[data-testid="dmComposerTextInput"]',
        'div[contenteditable="true"][data-testid*="dm"]',
      ], message);

      if (!filled.ok) {
        throw new Error(`Could not fill Twitter DM composer for "@${username}"`);
      }

      // Send using ONLY the DM send button — never tweetButton / Post
      let sent = false;
      if (!requireManualReview) {
        // dmComposerSendButton is the ↑ arrow in the DM input
        const sendBtn = page.locator('button[data-testid="dmComposerSendButton"]').first();
        if (await sendBtn.isVisible().catch(() => false)) {
          await sendBtn.click();
          sent = true;
        } else {
          // Enter key sends in DM composer without risking tweet submission
          await page.keyboard.press('Enter');
          sent = true;
        }
        await minimalDelay(1500);
      }

      return {
        status: 'completed',
        summary: summarizeAction('twitter', step, { sent }),
        data: { page: await pageSnapshot(page), message, sent, ...messageStatus },
      };
    }



    // Handle actions that should be delegated to base handler
    const baseHandlerActions = ['engage_post', 'engage_batch', 'follow_user', 'follow_batch', 'compose_post', 'publish_post', 'scrape_results', 'like_post', 'comment_post'];
    if (baseHandlerActions.includes(action)) {
      return baseHandler.execute({ step, attachedBrowser });
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
