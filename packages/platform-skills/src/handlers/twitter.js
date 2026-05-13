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

// Custom function to fill DM composer with better detection
async function fillDMComposer(page, message) {
  console.log('[Twitter] Attempting to fill DM composer with message');
  
  // Wait a moment for the composer to be ready
  await minimalDelay(500);
  
  // Try multiple selector patterns for DM composer text input
  const composerSelectors = [
    'div[data-testid="dmComposerTextInput"]',
    'div[contenteditable="true"][data-testid*="dm"]',
    'div[role="textbox"][data-testid*="dm"]',
    'div[contenteditable="true"]', // Fallback to any editable div
    'div[role="textbox"]', // Fallback to any textbox
    'textarea', // Fallback to textarea
  ];
  
  for (const selector of composerSelectors) {
    try {
      console.log(`[Twitter] Trying DM composer selector: ${selector}`);
      
      // Try to find the element
      const element = await page.locator(selector).first();
      
      if (await element.count() > 0) {
        const isVisible = await element.isVisible().catch(() => false);
        if (isVisible) {
          console.log(`[Twitter] Found DM composer with selector: ${selector}`);
          
          // Try different methods to fill the text
          try {
            // Method 1: Click and type
            await element.click();
            await minimalDelay(200);
            await element.fill('');
            await element.type(message, { delay: 30 });
            console.log('[Twitter] Successfully filled DM composer using click and type');
            return { ok: true };
          } catch (typeError) {
            console.log(`[Twitter] Click and type failed: ${typeError.message}`);
            
            // Method 2: Focus and type
            try {
              await element.focus();
              await minimalDelay(200);
              await element.evaluate(el => el.innerText = '');
              await element.type(message, { delay: 30 });
              console.log('[Twitter] Successfully filled DM composer using focus and type');
              return { ok: true };
            } catch (focusError) {
              console.log(`[Twitter] Focus and type failed: ${focusError.message}`);
              
              // Method 3: Direct innerText setting
              try {
                await element.evaluate((el, msg) => {
                  el.innerText = msg;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                }, message);
                console.log('[Twitter] Successfully filled DM composer using direct innerText');
                return { ok: true };
              } catch (evalError) {
                console.log(`[Twitter] Direct innerText failed: ${evalError.message}`);
              }
            }
          }
        } else {
          console.log(`[Twitter] Element found but not visible: ${selector}`);
        }
      } else {
        console.log(`[Twitter] Element not found with selector: ${selector}`);
      }
    } catch (e) {
      console.log(`[Twitter] Selector failed: ${selector} - ${e.message}`);
    }
  }
  
  // If all selectors fail, try the original fillEditable function as fallback
  console.log('[Twitter] All custom methods failed, trying original fillEditable');
  try {
    return await fillEditable(page, composerSelectors, message);
  } catch (e) {
    console.log(`[Twitter] Original fillEditable also failed: ${e.message}`);
  }
  
  return { ok: false };
}

// Twitter DM Helper Functions
async function navigateToTwitterProfile(page, username) {
  // Use direct URL navigation only - no search logic

  // Primary navigation method - direct URL for reliability
  console.log(`[Twitter] Navigating directly to profile: @${username}`);
  const url = buildPlatformTargetUrl('twitter', username);
  await navigate(page, url, 'twitter');
  await minimalDelay(500);
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
    'input[aria-label*="Search"]',
    'div[role="textbox"][contenteditable="true"]', // Fallback to editable div
  ]);

  if (!searchInput) {
    console.log('[Twitter] DM search box not found in messages panel, trying alternative approach');
    // Try to find any input in the left sidebar
    const allInputs = await page.locator('input, div[role="textbox"]').all();
    for (const input of allInputs) {
      try {
        const placeholder = await input.getAttribute('placeholder').catch(() => '');
        const ariaLabel = await input.getAttribute('aria-label').catch(() => '');
        if (placeholder.toLowerCase().includes('search') || ariaLabel.toLowerCase().includes('search')) {
          console.log(`[Twitter] Found search input via attribute check`);
          await input.click();
          await minimalDelay(400);
          await input.fill('');
          await input.type(username, { delay: 60 });
          await minimalDelay(2500);
          break;
        }
      } catch (e) {
        continue;
      }
    }
  } else {
    await searchInput.click();
    await minimalDelay(400);
    await searchInput.fill('');
    await searchInput.type(username, { delay: 60 });
    await minimalDelay(2500);
  }

  // Click the first matching result in the left rail
  const result = await firstVisibleLocator(page, [
    `div[data-testid="conversation"]:has-text("@${username}")`,
    `div[data-testid="conversation"]:has-text("${username}")`,
    'div[data-testid="conversation"]',
    `div[role="option"]:has-text("${username}")`,
    `div[role="option"]:has-text("@${username}")`,
    'div[role="option"]',
    'a[href*="/messages/"]', // Fallback to message links
  ]);

  if (!result) {
    console.log(`[Twitter] No DM conversation found for @${username}, trying text search`);
    // Try clicking by text content
    const textClicked = await clickByText(page, ['div', 'a', 'button'], [`@${username}`, username]);
    if (!textClicked) {
      console.log(`[Twitter] No DM conversation found for @${username}`);
      return false;
    }
  } else {
    await result.click();
  }
  
  await minimalDelay(1500);

  // Verify the DM composer opened (not a tweet composer)
  const composer = await firstVisibleLocator(page, [
    'div[data-testid="dmComposerTextInput"]',
    'div[contenteditable="true"][data-testid*="dm"]',
    'div[role="textbox"][data-testid*="dm"]',
    'div[contenteditable="true"]', // Fallback to any editable div
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
    'div[aria-label="New message"]',
    'button:has-text("New message")',
  ]);

  if (!newMsgClicked) {
    // Try clicking by visible text, but be careful to avoid the global tweet compose button
    const btns = await page.locator('button, a[role="button"], div[role="button"]').all();
    let clicked = false;
    for (const btn of btns) {
      try {
        const label = await btn.getAttribute('aria-label').catch(() => '');
        const text  = await btn.innerText().catch(() => '');
        if (/^new message$/i.test(label) || /^new message$/i.test(text.trim())) {
          await btn.click();
          clicked = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }
    if (!clicked) {
      console.log('[Twitter] New message button not found, trying direct navigation');
      // Try direct navigation to compose page
      await navigate(page, 'https://x.com/messages/compose', 'twitter');
      await minimalDelay(1500);
    }
  }

  await minimalDelay(1200);

  // In the compose-recipient modal, find the people search input
  const searchBox = await firstVisibleLocator(page, [
    'input[placeholder="Search people"]',
    'input[aria-label="Search people"]',
    'input[data-testid="dmComposerRecipientInput"]',
    'input[placeholder*="Search"]',
    'input[aria-label*="Search"]',
    'div[role="textbox"][contenteditable="true"]', // Fallback to editable div
  ]);

  if (!searchBox) {
    console.log('[Twitter] Recipient search box not found in new DM modal, trying alternative');
    // Try to find any input that might be for search
    const allInputs = await page.locator('input, div[role="textbox"]').all();
    let searchFound = false;
    for (const input of allInputs) {
      try {
        const placeholder = await input.getAttribute('placeholder').catch(() => '');
        const ariaLabel = await input.getAttribute('aria-label').catch(() => '');
        if (placeholder.toLowerCase().includes('search') || ariaLabel.toLowerCase().includes('search')) {
          console.log(`[Twitter] Found recipient search input via attribute check`);
          await input.click();
          await input.fill('');
          await input.type(username, { delay: 50 });
          await minimalDelay(2000);
          searchFound = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }
    if (!searchFound) {
      console.log('[Twitter] Recipient search box not found in new DM modal');
      return false;
    }
  } else {
    await searchBox.click();
    await searchBox.fill('');
    await searchBox.type(username, { delay: 50 });
    await minimalDelay(2000);
  }

  // Click the matching user in the typeahead dropdown
  const userResult = await firstVisibleLocator(page, [
    `div[data-testid="TypeaheadUser"]:has-text("@${username}")`,
    `div[data-testid="TypeaheadUser"]:has-text("${username}")`,
    'div[data-testid="TypeaheadUser"]',
    `div[role="option"]:has-text("@${username}")`,
    `div[role="option"]:has-text("${username}")`,
    'div[role="option"]',
  ]);

  if (userResult) {
    await userResult.click();
    await minimalDelay(1000);
  } else {
    // Try Enter as fallback
    console.log('[Twitter] User result not found, trying Enter key');
    await page.keyboard.press('Enter');
    await minimalDelay(1000);
  }

  // Click "Next" to open the conversation
  const nextClicked = await tryClick(page, [
    'button[data-testid="nextButton"]',
    'button:has-text("Next")',
    'div[role="button"]:has-text("Next")',
  ]);
  if (!nextClicked) {
    console.log('[Twitter] Next button not found, trying text search');
    await clickByText(page, ['button', 'div[role="button"]'], ['Next']);
  }
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

// Custom like implementation with better button detection
async function likeTwitterPost(page, username) {
  console.log(`[Twitter] Attempting to like post${username ? ' for @' + username : ''}`);
  
  // Wait a moment for the page to fully load
  await minimalDelay(1000);
  
  // Focus on the main timeline/content area to avoid clicking home feed buttons
  const timelineSelectors = [
    'div[data-testid="primaryColumn"]',           // Main timeline column
    'main[role="main"]',                          // Main content area
    'div[aria-label="Timeline: Your Home Timeline"]', // Home timeline (avoid this)
    'h2:has-text("Posts")',                       // Posts section on profile
  ];
  
  // If we're on a profile, focus on the profile timeline
  let targetArea = null;
  if (username) {
    console.log(`[Twitter] Looking for profile timeline for @${username}`);
    // Try to find the profile's posts section
    const profileTimelineSelectors = [
      'div[data-testid="primaryColumn"]', // Main content area on profile
      'section[role="region"]',           // Main content region
      'div[aria-label*="Timeline"]',      // Timeline areas
    ];
    
    for (const selector of profileTimelineSelectors) {
      try {
        const area = await page.locator(selector).first();
        if (await area.count() > 0) {
          console.log(`[Twitter] Found profile timeline area: ${selector}`);
          targetArea = area;
          break;
        }
      } catch (e) {
        console.log(`[Twitter] Profile timeline selector failed: ${selector} - ${e.message}`);
      }
    }
  }
  
  // Try multiple selector patterns for like buttons, scoped to the target area
  const likeSelectors = [
    'button[data-testid="like"]',                    // Standard like button
    'button[data-testid="like"][role="button"]',     // With role attribute
    'button[aria-label*="Like"]',                    // Contains "Like" in aria-label
    'button[aria-label^="Like"]',                    // Starts with "Like"
    'div[role="button"][data-testid="like"]',        // Div with role and data-testid
    'article[data-testid="tweet"] button[data-testid="like"]', // Like button within tweet
    'div[data-testid="tweet"] button[data-testid="like"]',     // Like button within tweet div
    '[data-testid="like"]',                          // Any element with like data-testid
  ];
  
  for (const selector of likeSelectors) {
    try {
      console.log(`[Twitter] Trying selector: ${selector}`);
      
      // If we have a target area, scope the search to it
      let element;
      if (targetArea) {
        element = targetArea.locator(selector).first();
      } else {
        element = await page.locator(selector).first();
      }
      
      // Check if element exists and is visible
      if (await element.count() > 0) {
        const isVisible = await element.isVisible().catch(() => false);
        if (isVisible) {
          console.log(`[Twitter] Found like button with selector: ${selector}`);
          await element.click();
          await minimalDelay(500);
          console.log(`[Twitter] Successfully clicked like button`);
          return true;
        } else {
          console.log(`[Twitter] Element found but not visible: ${selector}`);
        }
      } else {
        console.log(`[Twitter] Element not found with selector: ${selector}`);
      }
    } catch (e) {
      console.log(`[Twitter] Selector failed: ${selector} - ${e.message}`);
    }
  }
  
  // If all selectors fail, try text-based approach
  console.log('[Twitter] Trying text-based like button search');
  try {
    const clicked = await clickByText(page, ['button', 'div[role="button"]'], ['Like', 'Like ']);
    if (clicked) {
      console.log(`[Twitter] Successfully clicked like button using text search`);
      await minimalDelay(500);
      return true;
    }
  } catch (e) {
    console.log(`[Twitter] Text-based click failed: ${e.message}`);
  }
  
  throw new Error(`Could not find or click like button${username ? ' for @' + username : ''}`);
}

// Custom follow implementation with better button detection
async function followTwitterUser(page, username) {
  console.log(`[Twitter] Attempting to follow @${username}`);
  
  // Wait a moment for the page to fully load
  await minimalDelay(1000);
  
  // Try multiple selector patterns based on actual HTML structure
  const followSelectors = [
    'button[data-testid$="-follow"]',           // Dynamic ID ending with -follow
    'button[data-testid$="-follow"][role="button"]', // With role attribute
    'button[aria-label^="Follow @"]',           // Pattern: "Follow @username"
    'button[aria-label*="Follow"]',             // Contains "Follow"
    'button[aria-label="Follow"]',               // Exact "Follow"
    'button:has-text("Follow")',                // Text-based
    'button:has-text("Follow ")',               // "Follow " with space
  ];
  
  for (const selector of followSelectors) {
    try {
      console.log(`[Twitter] Trying selector: ${selector}`);
      const element = await page.locator(selector).first();
      
      // Check if element exists and is visible
      if (await element.count() > 0) {
        const isVisible = await element.isVisible().catch(() => false);
        if (isVisible) {
          console.log(`[Twitter] Found follow button with selector: ${selector}`);
          await element.click();
          await minimalDelay(500);
          console.log(`[Twitter] Successfully clicked follow button for @${username}`);
          return true;
        } else {
          console.log(`[Twitter] Element found but not visible: ${selector}`);
        }
      }
    } catch (e) {
      console.log(`[Twitter] Selector failed: ${selector} - ${e.message}`);
    }
  }
  
  // If all selectors fail, try text-based approach
  console.log('[Twitter] Trying text-based follow button search');
  try {
    const clicked = await clickByText(page, ['button', 'div[role="button"]'], ['Follow', 'Follow ', 'Follow @']);
    if (clicked) {
      console.log(`[Twitter] Successfully clicked follow button using text search for @${username}`);
      await minimalDelay(500);
      return true;
    }
  } catch (e) {
    console.log(`[Twitter] Text-based click failed: ${e.message}`);
  }
  
  throw new Error(`Could not find or click follow button for @${username}`);
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
  messageComposerSelectors: ['div[data-testid="dmComposerTextInput"]', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"][data-testid*="dm"]', 'div[role="textbox"][data-testid*="dm"]'],
  sendMessageSelectors: ['button[data-testid="dmComposerSendButton"]'],
  sendMessageLabels: ['Send'],
  followLabels: ['Follow', 'Follow ', 'Follow @'],
  followSelectors: ['button', 'div[role="button"]'],
  followClickSelectors: [
    'button[data-testid$="-follow"]',
    'button[data-testid$="-follow"][role="button"]',
    'button[aria-label^="Follow @"]',
    'button[aria-label*="Follow"]',
    'button[aria-label="Follow"]',
    'button:has-text("Follow")',
    'button:has-text("Follow ")',
    'div[data-testid$="-follow"]',
    'div[data-testid="follow"]',
    'div[role="button"][aria-label*="Follow"]',
    'div[role="button"][aria-label="Follow"]',
    'span:has-text("Follow")'
  ],
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

    // Primary navigation method - direct URL for reliability
    await navigate(page, 'https://x.com/compose/tweet', 'twitter');
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
      
      // Normalize username - remove @ if present
      const normalizedUsername = username.startsWith('@') ? username.slice(1) : username;

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.twitter, { platform: 'twitter' });

      // Route to the correct DM flow based on operation
      let chatOpened = false;
      let messageStatus;

      if (operation === 'auto_dm_contact') {
        // Existing contact → search in left DM rail
        console.log(`[Twitter] auto_dm_contact: using left-rail DM search for @${normalizedUsername}`);
        chatOpened = await openTwitterDMContact(page, normalizedUsername);
        if (!chatOpened) {
          // Fallback: try profile-based DM approach
          console.log(`[Twitter] DM search failed, trying profile Message button fallback...`);
          try {
            await navigateToTwitterProfile(page, normalizedUsername);
            messageStatus = await openTwitterMessage(page, normalizedUsername);
            chatOpened = true;
          } catch (profileError) {
            throw new Error(`Could not find @${normalizedUsername} in your Twitter DMs and could not open DM from profile. They may not accept DMs from non-followers.`);
          }
        }
        messageStatus = { type: 'message', canSend: true, method: chatOpened && messageStatus?.method || 'dm_search' };

      } else if (operation === 'auto_dm_new' || operation === 'auto_dm') {
        // New person → New message button → recipient search modal
        console.log(`[Twitter] auto_dm_new: using New message button for @${normalizedUsername}`);
        chatOpened = await openTwitterDMNew(page, normalizedUsername);
        if (!chatOpened) {
          // Fallback: navigate to profile and click Message button
          console.log(`[Twitter] New message modal failed, trying profile Message button...`);
          try {
            await navigateToTwitterProfile(page, normalizedUsername);
            messageStatus = await openTwitterMessage(page, normalizedUsername);
            chatOpened = true;
          } catch (profileError) {
            throw new Error(`Could not open Twitter DM for @${normalizedUsername}. They may have restricted DMs.`);
          }
        } else {
          messageStatus = { type: 'message', canSend: true, method: 'new_message_modal' };
        }

      } else {
        // Generic: try inbox search first, then profile fallback
        chatOpened = await openTwitterDMNew(page, normalizedUsername);
        if (!chatOpened) {
          try {
            await navigateToTwitterProfile(page, normalizedUsername);
            messageStatus = await openTwitterMessage(page, normalizedUsername);
            chatOpened = true;
          } catch (profileError) {
            throw new Error(`Could not message @${normalizedUsername} on Twitter. They may have restricted DMs.`);
          }
        } else {
          messageStatus = { type: 'message', canSend: true, method: 'inbox_search' };
        }
      }

      // Extract chat context
      const chatContext = await extractChatContext(page, 'twitter', 6);

      // Extract profile context
      console.log(`[Twitter] Extracting profile context for ${normalizedUsername}...`);
      const rawProfileInfo = await extractProfileContext(page, 'twitter', normalizedUsername);
      const profileInfo = formatProfileContext(rawProfileInfo, 'twitter');

      // Generate message
      const message = await generateOutreachMessage({
        username: normalizedUsername,
        goal: messageGoal,
        tone,
        query,
        platform: 'twitter',
        chatContext,
        profileInfo,
      });

      // Debug: Check what elements are present on the page
      console.log('[Twitter] Debugging: Checking for editable elements...');
      console.log('[Twitter] Waiting for DM composer to load...');
      await minimalDelay(1500); // Wait for composer to load
      
      try {
        const editables = await page.locator('div[contenteditable="true"], textarea, input').all();
        console.log(`[Twitter] Found ${editables.length} editable elements`);
        for (let i = 0; i < Math.min(editables.length, 5); i++) {
          try {
            const attr = await editables[i].getAttribute('data-testid').catch(() => 'no data-testid');
            const visible = await editables[i].isVisible().catch(() => false);
            console.log(`[Twitter] Editable ${i}: data-testid="${attr}", visible=${visible}`);
          } catch (e) {
            console.log(`[Twitter] Editable ${i}: could not get attributes`);
          }
        }
      } catch (e) {
        console.log(`[Twitter] Could not debug editable elements: ${e.message}`);
      }

      // Fill the DM composer — use custom function with better detection
      const filled = await fillDMComposer(page, message);

      if (!filled.ok) {
        throw new Error(`Could not fill Twitter DM composer for "@${normalizedUsername}"`);
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
    if (action === 'follow_user') {
      const { username } = args;
      if (!username) {
        throw new Error('Twitter follow_user requires a username');
      }

      // Normalize username - remove @ if present
      const normalizedUsername = username.startsWith('@') ? username.slice(1) : username;

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.twitter, { platform: 'twitter' });
      await navigateToTwitterProfile(page, normalizedUsername);
      const success = await followTwitterUser(page, normalizedUsername);
      
      return {
        status: 'ready',
        summary: summarizeAction('twitter', step),
        data: { followed: success },
      };
    }

    if (action === 'like_post') {
      const { username, postUrl } = args;
      
      // Normalize username - remove @ if present
      const normalizedUsername = username ? (username.startsWith('@') ? username.slice(1) : username) : null;
      
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.twitter, { platform: 'twitter' });
      
      // If username is provided, navigate to their profile first
      if (normalizedUsername) {
        console.log(`[Twitter] Navigating to @${normalizedUsername} profile to like their post`);
        await navigateToTwitterProfile(page, normalizedUsername);
        await minimalDelay(1000);
      } else if (postUrl) {
        // If only postUrl is provided, navigate to it
        await navigate(page, postUrl, 'twitter');
        await minimalDelay(1000);
      }
      
      const success = await likeTwitterPost(page, normalizedUsername);
      
      return {
        status: 'ready',
        summary: summarizeAction('twitter', step),
        data: { liked: success },
      };
    }

    const baseHandlerActions = ['engage_post', 'engage_batch', 'follow_batch', 'compose_post', 'publish_post', 'scrape_results', 'comment_post'];
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
