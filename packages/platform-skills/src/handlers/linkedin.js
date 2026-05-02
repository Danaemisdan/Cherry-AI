import {
  PLATFORM_URLS,
  buildPlatformTargetUrl,
  clickByText,
  fillEditable,
  firstVisibleLocator,
  generateOutreachMessage,
  minimalDelay,
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
  await waitForAppShell(page, 'linkedin');
}

async function searchInLinkedInMessaging(page, username) {
  // Strategy 1: Search in messaging for already connected people
  await navigate(page, 'https://www.linkedin.com/messaging/', 'linkedin');
  await waitForAppShell(page, 'linkedin');
  
  // Look for new message button or search
  const newMsgBtn = await firstVisibleLocator(page, [
    'button:has-text("New message")',
    'button:has-text("Compose")',
    'button[aria-label*="New message"]',
    '.msg-new-conversation-compose__trigger',
  ]);
  
  if (newMsgBtn) {
    await newMsgBtn.click().catch(() => {});
    await minimalDelay(500);
  }
  
  // Find the recipient search box
  const searchBox = await firstVisibleLocator(page, [
    'input[placeholder*="Type a name"]',
    'input[placeholder*="Search"]',
    '.msg-connections-typeahead__input',
    'input[role="combobox"]',
  ]);
  
  if (searchBox) {
    await searchBox.click({ timeout: 3000 }).catch(() => {});
    await searchBox.fill('').catch(() => {});
    await searchBox.type(username.slice(0, 20), { delay: 30 }).catch(() => {});
    await minimalDelay(800);
    
    // Look for search results
    const resultSelectors = [
      '.msg-connections-typeahead__result',
      '.msg-connections-typeahead__recipient',
      '.msg-conversation-card',
      'li[role="option"]',
      '.artdeco-typeahead__result',
    ];
    
    for (const selector of resultSelectors) {
      const result = page.locator(selector).first();
      if (await result.isVisible().catch(() => false)) {
        const text = await result.textContent().catch(() => '');
        if (text.toLowerCase().includes(username.toLowerCase())) {
          await result.click().catch(() => {});
          await minimalDelay(500);
          return true;
        }
      }
    }
    
    // Press escape to close search dropdown
    await page.keyboard.press('Escape').catch(() => {});
  }
  
  return false;
}

async function searchLinkedInConnections(page, username) {
  // Strategy 2: Search in my network/connections
  await navigate(page, 'https://www.linkedin.com/mynetwork/invite-connect/connections/', 'linkedin');
  await waitForAppShell(page, 'linkedin');
  
  const searchBox = await firstVisibleLocator(page, [
    'input[placeholder*="Search"]',
    '.mn-connections-search-input',
    'input[aria-label*="Search"]',
  ]);
  
  if (searchBox) {
    await searchBox.click().catch(() => {});
    await searchBox.fill('').catch(() => {});
    await searchBox.type(username, { delay: 30 }).catch(() => {});
    await minimalDelay(1000);
    
    // Check if any connections match
    const connectionCards = await page.locator('.mn-connection-card').all();
    for (const card of connectionCards.slice(0, 3)) {
      const name = await card.locator('.mn-connection-card__name').textContent().catch(() => '');
      if (name.toLowerCase().includes(username.toLowerCase())) {
        // Click message button on this connection
        const msgBtn = await card.locator('button:has-text("Message"), button[aria-label*="Message"]').first();
        if (await msgBtn.isVisible().catch(() => false)) {
          await msgBtn.click();
          await minimalDelay(500);
          return true;
        }
        // Otherwise click the card to go to profile
        await card.click();
        await minimalDelay(500);
        return 'profile_opened';
      }
    }
  }
  
  return false;
}

async function searchLinkedInHome(page, username) {
  // Strategy 3: Search on home page and find person
  await navigate(page, 'https://www.linkedin.com/feed/', 'linkedin');
  await waitForAppShell(page, 'linkedin');
  
  // Find the main search bar
  const searchBox = await firstVisibleLocator(page, [
    'input[placeholder*="Search"]',
    '.search-global-typeahead__input',
    'input[role="combobox"]',
  ]);
  
  if (searchBox) {
    await searchBox.click().catch(() => {});
    await searchBox.fill('').catch(() => {});
    await searchBox.type(username, { delay: 30 }).catch(() => {});
    await minimalDelay(1000);
    
    // Press enter to search
    await page.keyboard.press('Enter').catch(() => {});
    await minimalDelay(1500);
    
    // Wait for search results page
    await waitForAppShell(page, 'linkedin');
    
    // Look for people results
    const peopleTab = await firstVisibleLocator(page, [
      'button:has-text("People")',
      'a:has-text("People")',
      '[aria-label*="People"]',
    ]);
    
    if (peopleTab) {
      await peopleTab.click().catch(() => {});
      await minimalDelay(800);
    }
    
    // Find first person result and click
    const personResults = await page.locator('.entity-result__item, .search-result__info, a[href*="/in/"]').all();
    for (const result of personResults.slice(0, 3)) {
      const text = await result.textContent().catch(() => '');
      const href = await result.getAttribute('href').catch(() => '');
      
      if (text.toLowerCase().includes(username.toLowerCase()) || href.includes(username.toLowerCase().replace(' ', '-'))) {
        await result.click().catch(() => {});
        await minimalDelay(800);
        return true;
      }
    }
    
    // If no exact match, click first person result anyway
    const firstResult = page.locator('.entity-result__item a[href*="/in/"], .search-result__image-wrapper a').first();
    if (await firstResult.isVisible().catch(() => false)) {
      await firstResult.click().catch(() => {});
      await minimalDelay(800);
      return true;
    }
  }
  
  return false;
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
      await waitForAppShell(page, 'linkedin');
      await minimalDelay(500);

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
        await waitForAppShell(page, 'linkedin');
        await minimalDelay(300);

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
      await waitForAppShell(page, 'linkedin');
      await minimalDelay(500);

      clicked = await tryClick(page, messageSelectors);

      if (!clicked) {
        throw new Error(`Followed ${username} but cannot message. Some LinkedIn profiles only allow messaging from connections, not followers.`);
      }
    }
  }

  if (!clicked && !clicked?.type) {
    // Last resort - navigate to messaging directly
    await navigate(page, 'https://www.linkedin.com/messaging/', 'linkedin');
    await waitForAppShell(page, 'linkedin');

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
      await searchBox.type(username.slice(0, 20), { delay: 20 }).catch(() => {});
      await minimalDelay(1000);

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

  await waitForAppShell(page, 'linkedin');
  await minimalDelay(300);

  // Close any blocking overlays/connection search dropdowns
  await page.keyboard.press('Escape').catch(() => {});
  await minimalDelay(200);
  
  // Click elsewhere to dismiss any dropdowns
  await page.click('body', { position: { x: 10, y: 10 } }).catch(() => {});
  await minimalDelay(200);

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
    await waitForAppShell(page, 'linkedin');
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

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.linkedin, { platform: 'linkedin' });
      
      // Try multiple strategies to find the person - SEARCH FIRST, never use direct URL
      let foundVia = null;
      let messageType = null;
      let searchError = null;
      
      // Strategy 1: Search in messaging (for already connected people)
      console.log(`[LinkedIn] Searching for "${username}" in messaging...`);
      const foundInMessaging = await searchInLinkedInMessaging(page, username);
      if (foundInMessaging) {
        foundVia = 'messaging_search';
        messageType = { type: 'message', noteAvailable: true };
        console.log(`[LinkedIn] Found ${username} in messaging`);
      } else {
        // Strategy 2: Search in my network/connections
        console.log(`[LinkedIn] Searching connections for "${username}"...`);
        const foundInConnections = await searchLinkedInConnections(page, username);
        if (foundInConnections === true) {
          foundVia = 'connections';
          messageType = { type: 'message', noteAvailable: true };
          console.log(`[LinkedIn] Found ${username} in connections`);
        } else if (foundInConnections === 'profile_opened') {
          foundVia = 'connections_profile';
          messageType = await openLinkedInMessage(page, username);
          console.log(`[LinkedIn] Found ${username} via connections profile`);
        } else {
          // Strategy 3: Search on home page
          console.log(`[LinkedIn] Searching LinkedIn for "${username}"...`);
          const foundInSearch = await searchLinkedInHome(page, username);
          if (foundInSearch) {
            foundVia = 'home_search';
            const status = await checkLinkedInConnectionStatus(page);
            if (status.isConnected) {
              messageType = await openLinkedInMessage(page, username);
            } else if (status.canConnect) {
              messageType = await openLinkedInMessage(page, username);
            } else {
              throw new Error(`Found ${username} but cannot message or connect. They may have restricted messaging.`);
            }
            console.log(`[LinkedIn] Found ${username} via home search`);
          } else {
            throw new Error(`Could not find anyone named "${username}" in your LinkedIn network or connections. Try connecting with them first.`);
          }
        }
      }

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
              await minimalDelay(500);
              const fileInput = await page.locator('input[type="file"]').first();
              if (fileInput) {
                await fileInput.setInputFiles(attachmentPath);
              }
            }
            await minimalDelay(1200); // Wait for upload
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
          // Send regular message - LinkedIn shows popup asking "Press Enter to Send" or "Click Send"
          // First dismiss any popup by pressing Escape
          await page.keyboard.press('Escape').catch(() => {});
          await minimalDelay(200);

          // Try pressing Enter first (most reliable)
          await page.keyboard.press('Enter').catch(() => {});
          await minimalDelay(500);
          sent = true;

          // If that didn't work, try clicking Send button
          if (!sent) {
            sent = await submitComposer(page, [
              'button:has-text("Send")',
              'button[type="submit"]',
              '[aria-label*="Send"]',
            ], ['Send']);
          }
        }
      }

      return {
        status: 'completed',
        summary: summarizeAction('linkedin', step, { sent }),
        data: { page: await pageSnapshot(page), message: truncatedMessage, sent, type: messageType.type, foundVia },
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
