import {
  PLATFORM_URLS,
  SEARCH_SELECTORS,
  buildPlatformSearchUrl,
  buildPlatformTargetUrl,
  clickByText,
  ensurePlatformReady,
  fillEditable,
  firstWorkingLocator,
  firstVisibleLocator,
  generateOutreachMessage,
  minimalDelay,
  navigate,
  normalizeUsername,
  openAttachedPage,
  pageSnapshot,
  reviewQueue,
  runBatchAction,
  summarizeAction,
  tryClick,
  unsupported,
} from '../common.js';
import { extractChatContext as extractSharedChatContext } from '../chat-context.js';
import { extractProfileContext, formatProfileContext } from '../profile-context.js';

function normalizeChatText(value = '') {
  return String(value).trim().toLowerCase();
}

async function extractChatContext(page, limit = 10) {
  // Use shared chat context extractor for consistency
  const context = await extractSharedChatContext(page, 'whatsapp', limit);
  return context || [];
}

async function getViewportWidth(page) {
  return page.evaluate(() => window.innerWidth || document.documentElement.clientWidth || 0).catch(() => 0);
}

async function currentHeaderMatches(page, username) {
  const target = normalizeChatText(username);
  const headerTexts = await page
    .locator('header span[title], header h1, header div[role="button"] span')
    .evaluateAll((nodes) => nodes.map((node) => (node.textContent || '').trim()))
    .catch(() => []);

  return headerTexts.some((text) => {
    const normalized = normalizeChatText(text);
    return normalized === target || normalized.startsWith(target);
  });
}

async function clickVisibleChatCandidate(page, username, { strict = false, searchBox = null } = {}) {
  const target = normalizeChatText(username);
  const candidateSelectors = [
    'span[title]',
    '[data-testid="cell-frame-title"]',
    'div[role="listitem"] span[dir="auto"]',
    'div[role="gridcell"]',
    'div[role="listitem"]',
  ];
  const candidates = [];
  const viewportWidth = await getViewportWidth(page);
  const searchBoxBounds = searchBox ? await searchBox.boundingBox().catch(() => null) : null;

  for (const selector of candidateSelectors) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 80);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      const title = normalizeChatText(await candidate.getAttribute('title').catch(() => ''));
      const aria = normalizeChatText(await candidate.getAttribute('aria-label').catch(() => ''));
      const text = normalizeChatText(await candidate.textContent().catch(() => ''));
      const haystacks = [title, aria, text].filter(Boolean);
      if (!haystacks.some((value) => value.includes(target))) {
        continue;
      }

      const row = candidate.locator('xpath=ancestor::*[@role="gridcell" or @role="listitem"][1]').first();
      const clickable = await row.count().catch(() => 0) ? row : candidate;
      const bounds = await clickable.boundingBox().catch(() => null);
      if (!bounds) continue;

      const inLeftRail = bounds.x < viewportWidth * 0.42;
      if (!inLeftRail) continue;

      if (searchBoxBounds) {
        const roughlyBelowSearch = bounds.y + bounds.height / 2 >= searchBoxBounds.y + Math.min(searchBoxBounds.height, 24);
        const roughlyAlignedWithSearch = bounds.x <= searchBoxBounds.x + 32;
        if (!roughlyBelowSearch || !roughlyAlignedWithSearch) {
          continue;
        }
      }

      const exact = haystacks.some((value) => value === target);
      const startsWith = haystacks.some((value) => value.startsWith(target));
      candidates.push({ clickable, exact, startsWith, haystacks, bounds });
    }
  }

  if (!candidates.length) return false;

  const exact = candidates.find((item) => item.exact);
  const prefix = candidates.find((item) => item.startsWith);
  const chosen = exact || prefix || (strict ? null : candidates[0]);
  if (!chosen) return false;
  await chosen.clickable.click({ timeout: 3000 }).catch(() => {});
  return true;
}

async function findWhatsAppSearchBox(page) {
  const viewportWidth = await getViewportWidth(page);
  const preferred = [
    ...SEARCH_SELECTORS.whatsapp,
    'div[contenteditable="true"][aria-label*="Search"]',
    'div[contenteditable="true"][aria-label*="chat"]',
    'div[role="textbox"][aria-label*="Search"]',
    'div[role="textbox"][title*="Search"]',
    'input[placeholder*="Search"]',
    'input[aria-label*="Search"]',
  ];

  for (const selector of preferred) {
    const locator = page.locator(selector);
    const count = Math.min(await locator.count().catch(() => 0), 20);
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      const insideFooter = await candidate.locator('xpath=ancestor::footer[1]').count().catch(() => 0);
      if (insideFooter) continue;
      const visible = await candidate.isVisible().catch(() => false);
      if (!visible) continue;
      const bounds = await candidate.boundingBox().catch(() => null);
      if (!bounds || bounds.x >= viewportWidth * 0.42) continue;
      return candidate;
    }
  }

  const editables = page.locator('div[contenteditable="true"], div[role="textbox"], input[type="text"], input[type="search"]');
  const count = Math.min(await editables.count().catch(() => 0), 30);
  for (let index = 0; index < count; index += 1) {
    const candidate = editables.nth(index);
    const insideFooter = await candidate.locator('xpath=ancestor::footer[1]').count().catch(() => 0);
    if (insideFooter) continue;
    const visible = await candidate.isVisible().catch(() => false);
    if (!visible) continue;
    const bounds = await candidate.boundingBox().catch(() => null);
    if (!bounds || bounds.x >= viewportWidth * 0.42) continue;
    return candidate;
  }

  return null;
}

async function focusWhatsAppSearch(page) {
  let searchBox = await findWhatsAppSearchBox(page);
  if (searchBox) return searchBox;

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+k`).catch(() => {});
  await minimalDelay(200);

  searchBox = await findWhatsAppSearchBox(page);
  if (searchBox) return searchBox;

  await page.keyboard.press(`${modifier}+f`).catch(() => {});
  await minimalDelay(200);

  searchBox = await findWhatsAppSearchBox(page);
  if (searchBox) return searchBox;

  const searchTrigger = await firstWorkingLocator(page, [
    'button[aria-label*="Search"]',
    'div[role="button"][aria-label*="Search"]',
    'span[data-icon="search"]',
    '[title*="Search"]',
    '[aria-label*="Search or start a new chat"]',
  ]);

  if (searchTrigger) {
    await searchTrigger.click({ timeout: 3000 }).catch(() => {});
  }

  return findWhatsAppSearchBox(page);
}

async function summarizeSearchInputs(page) {
  const snapshot = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('div[contenteditable="true"], div[role="textbox"], input[type="text"], input[type="search"]'))
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName,
        role: element.getAttribute('role'),
        aria: element.getAttribute('aria-label'),
        placeholder: element.getAttribute('placeholder'),
        title: element.getAttribute('title'),
        dataTab: element.getAttribute('data-tab'),
        inFooter: Boolean(element.closest('footer')),
      }));
  }).catch(() => []);
  return JSON.stringify(snapshot);
}

async function openWhatsAppConversation(page, username) {
  const target = normalizeUsername(username);
  const digits = target.replace(/\D/g, '');

  // FAST PATH: Direct URL for phone numbers
  if (digits) {
    await navigate(page, buildPlatformTargetUrl('whatsapp', username), 'whatsapp');
    await minimalDelay(500);
    const composer = await firstVisibleLocator(page, ['div[contenteditable="true"][data-tab="10"]', 'footer div[contenteditable="true"]']);
    if (composer) return;
  }

  // Search path for existing chats
  await ensurePlatformReady(page, 'whatsapp');

  const searchBox = await focusWhatsAppSearch(page);
  if (!searchBox) {
    throw new Error('WhatsApp search not found');
  }

  await searchBox.click({ timeout: 2000 }).catch(() => {});
  await searchBox.fill('').catch(() => {});
  await searchBox.type(target, { delay: 10 }).catch(() => {});
  await minimalDelay(400);

  const clicked = await clickVisibleChatCandidate(page, target, { strict: false, searchBox });
  if (!clicked) {
    throw new Error(`Could not find WhatsApp chat for "${username}"`);
  }

  // Quick wait for composer (max 3s)
  const composerReady = await page
    .locator('div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]')
    .first()
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);

  if (!composerReady) {
    throw new Error(`WhatsApp composer for "${username}" not ready`);
  }
}

async function getLeftRail(page) {
  const candidates = [
    'div[aria-label*="Chat list"]',
    'div[data-testid="chat-list"]',
    'div[role="grid"]',
  ];
  return firstVisibleLocator(page, candidates);
}

async function waitForSearchResults(page, username) {
  const target = normalizeChatText(username);
  const found = await page.waitForFunction(
    ({ expected }) => {
      const normalize = (value) => String(value || '').trim().toLowerCase();
      const rows = Array.from(document.querySelectorAll('span[title], [data-testid="cell-frame-title"], div[role="listitem"]'));
      return rows.some((node) => {
        const text = normalize(node.getAttribute?.('title') || node.textContent);
        return text.includes(expected);
      });
    },
    { expected: target },
    { timeout: 5000 },
  ).then(() => true).catch(() => false);

  if (!found) {
    throw new Error(`WhatsApp chat for "${username}" not found`);
  }
}

async function openWhatsAppPrimaryMenu(page) {
  const menuSelectors = [
    'header [aria-label="Menu"]',
    'button[aria-label="Menu"]',
    'span[data-icon="menu"]',
    'header button',
  ];

  for (const selector of menuSelectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.count() > 0) {
        await locator.click({ timeout: 2000 });
        await minimalDelay(300);
        // Check if menu opened
        const menuItem = await page.locator('div[role="menuitem"]').first();
        if (await menuItem.count() > 0) return true;
      }
    } catch { /* try next */ }
  }
  throw new Error('Could not open WhatsApp menu');
}

async function clickWhatsAppMenuItem(page, labels = []) {
  const selectors = ['div[role="menuitem"]', '[role="menu"] div', 'button'];

  for (const selector of selectors) {
    for (const label of labels) {
      try {
        let locator = page.locator(`${selector}:has-text("${label}")`).first();
        if (await locator.count() > 0 && await locator.isVisible()) {
          await locator.click({ timeout: 2000 });
          await minimalDelay(200);
          return true;
        }
      } catch { /* continue */ }
    }
  }

  const clicked = await clickByText(page, selectors, labels);
  if (!clicked) {
    throw new Error(`Menu item not found: ${labels.join(', ')}`);
  }
}

async function confirmDialogAction(page, labels = []) {
  const selectors = ['[role="dialog"] button', 'button'];

  for (const selector of selectors) {
    for (const label of labels) {
      try {
        const locator = page.locator(`${selector}:has-text("${label}")`).first();
        if (await locator.count() > 0 && await locator.isVisible()) {
          await locator.click({ timeout: 2000 });
          await minimalDelay(300);
          return true;
        }
      } catch { /* continue */ }
    }
  }

  const clicked = await clickByText(page, ['button'], labels);
  if (!clicked) {
    throw new Error(`Could not confirm: ${labels.join(', ')}`);
  }
}

async function openStatusView(page) {
  await ensurePlatformReady(page, 'whatsapp');
  const opened = await tryClick(page, [
    'button[aria-label*="Status"]',
    'button[aria-label*="Updates"]',
    'span[data-icon="status"]',
  ]);

  if (!opened) {
    const clickedByText = await clickByText(page, ['button'], ['Status', 'Updates']);
    if (!clickedByText) {
      throw new Error('Could not open WhatsApp status');
    }
  }

  await minimalDelay(400);
  return page;
}

async function openProfileSettings(page) {
  await openWhatsAppPrimaryMenu(page);
  await clickWhatsAppMenuItem(page, ['Profile', 'Settings']);
  await minimalDelay(400);
}

async function uploadIntoVisibleFileInput(page, filePath) {
  if (!filePath) {
    throw new Error('WhatsApp action needs attachment path');
  }

  const input = page.locator('input[type="file"]').first();
  const exists = await input.count().catch(() => 0);
  if (!exists) {
    throw new Error('No file input found');
  }

  await input.setInputFiles(filePath).catch(() => {
    throw new Error('WhatsApp rejected file');
  });
  await minimalDelay(500);
}

async function openStatusComposer(page) {
  await openStatusView(page);
  const opened = await tryClick(page, [
    'button[aria-label*="Add status"]',
    'button[aria-label*="My status"]',
    'span[data-icon="status-v3"]',
  ]);
  if (!opened) {
    const clickedByText = await clickByText(page, ['button'], ['Add status', 'My status']);
    if (!clickedByText) {
      throw new Error('Could not open status composer');
    }
  }
  await minimalDelay(400);
}

async function openTarget(attachedBrowser, username) {
  const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.whatsapp, { platform: 'whatsapp' });
  if (normalizeUsername(username)) {
    await openWhatsAppConversation(page, username);
  }
  return page;
}

async function sendMessage(attachedBrowser, step, usernameOverride) {
  const username = usernameOverride || step.args.username;
  const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.whatsapp, { platform: 'whatsapp' });
  if (!(await currentHeaderMatches(page, username))) {
    await openWhatsAppConversation(page, username);
  }

  // Extract chat context
  const chatContext = await extractChatContext(page, 10);

  // Generate message
  const message = await generateOutreachMessage({
    username,
    goal: step.args.messageGoal,
    tone: step.args.tone,
    query: step.args.query,
    platform: 'whatsapp',
    chatContext,
    profileInfo: {},
  });

  // Type message quickly
  const filled = await fillEditable(page, ['div[contenteditable="true"][data-tab="10"]', 'footer div[contenteditable="true"]'], message);
  if (!filled.ok) {
    throw new Error(`Could not type message for "${username}"`);
  }

  await minimalDelay(200);

  // Send
  let sent = false;
  if (!step.args.requireManualReview) {
    await page.keyboard.press('Enter').catch(() => {});
    await minimalDelay(200);
    sent = true;
  }

  return { page, message, sent };
}

export const whatsappHandler = {
  platform: 'whatsapp',
  async execute({ step, attachedBrowser }) {
    if (step.action === 'open_workspace') {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.whatsapp, { platform: 'whatsapp' });
      return { status: 'ready', summary: summarizeAction('whatsapp', step), data: await pageSnapshot(page) };
    }

    if (step.action === 'search') {
      const page = await openAttachedPage(attachedBrowser, buildPlatformSearchUrl('whatsapp', step.args.query || step.args.prompt), { platform: 'whatsapp' });
      return { status: 'ready', summary: summarizeAction('whatsapp', step), data: await pageSnapshot(page) };
    }

    if (step.action === 'open_target') {
      const page = await openTarget(attachedBrowser, step.args.username);
      return { status: 'ready', summary: summarizeAction('whatsapp', step), data: await pageSnapshot(page) };
    }

    if (step.action === 'open_status') {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.whatsapp, { platform: 'whatsapp' });
      await openStatusView(page);
      return { status: 'ready', summary: summarizeAction('whatsapp', step), data: await pageSnapshot(page) };
    }

    if (step.action === 'post_status') {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.whatsapp, { platform: 'whatsapp' });
      await openStatusComposer(page);
      if (step.args.attachmentPath) {
        await uploadIntoVisibleFileInput(page, step.args.attachmentPath);
      }
      return {
        status: 'ready',
        summary: summarizeAction('whatsapp', step),
        data: await pageSnapshot(page),
      };
    }

    if (step.action === 'change_profile_photo') {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.whatsapp, { platform: 'whatsapp' });
      await openProfileSettings(page);

      // Try multiple selectors for profile photo edit
      let clickedEdit = false;
      const photoSelectors = [
        'button[aria-label*="Profile photo"]',
        'div[role="button"][aria-label*="Profile photo"]',
        'span[data-icon="camera"]',
        '[data-testid*="profile-photo"]',
        '[data-testid*="camera"]',
        'div:has(> img):has(> span[data-icon="camera"])',
      ];

      // Try text-based click first
      clickedEdit = await clickByText(page, ['button', 'div[role="button"]', 'span'], ['Profile photo', 'Edit profile photo', 'Edit photo', 'Change photo']);

      // If that fails, try selectors
      if (!clickedEdit) {
        for (const selector of photoSelectors) {
          try {
            const locator = page.locator(selector).first();
            if (await locator.count() > 0 && await locator.isVisible()) {
              await locator.click({ timeout: 2000 });
              clickedEdit = true;
              await minimalDelay(500);
              break;
            }
          } catch { /* continue */ }
        }
      }

      // Handle file upload if attachment provided
      if (step.args.attachmentPath) {
        await minimalDelay(600);

        // Look for file input or upload button
        const fileSelectors = [
          'input[type="file"]',
          'input[accept*="image"]',
          '[data-testid="file-picker"]',
          'button:has-text("Upload")',
          'button:has-text("Choose")',
        ];

        let uploaded = false;
        for (const selector of fileSelectors) {
          try {
            const locator = page.locator(selector).first();
            if (await locator.count() > 0) {
              const isFileInput = await locator.evaluate(el => el.tagName === 'INPUT').catch(() => false);
              if (isFileInput) {
                await locator.setInputFiles(step.args.attachmentPath);
                uploaded = true;
              } else {
                await locator.click();
                await minimalDelay(300);
                // Try to find file input after click
                const fileInput = await page.locator('input[type="file"]').first();
                if (await fileInput.count() > 0) {
                  await fileInput.setInputFiles(step.args.attachmentPath);
                  uploaded = true;
                }
              }
              break;
            }
          } catch { /* continue */ }
        }

        if (!uploaded) {
          // Fallback to existing upload function
          await uploadIntoVisibleFileInput(page, step.args.attachmentPath);
        }

        // Wait for upload and confirm
        await minimalDelay(1200);

        // Try to confirm/save
        await confirmDialogAction(page, ['Save', 'OK', 'Done', 'Upload']);
      }

      return { status: 'completed', summary: summarizeAction('whatsapp', step), data: await pageSnapshot(page) };
    }

    if (step.action === 'draft_message') {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.whatsapp, { platform: 'whatsapp' });
      if (step.args.username && !(await currentHeaderMatches(page, step.args.username))) {
        await openWhatsAppConversation(page, step.args.username);
      }
      const chatContext = await extractChatContext(page, 8);
      return {
        status: 'ready',
        summary: summarizeAction('whatsapp', step),
        data: {
          preview: await generateOutreachMessage({
            username: step.args.username,
            goal: step.args.messageGoal,
            tone: step.args.tone,
            query: step.args.query,
            platform: 'whatsapp',
            chatContext,
          }),
        },
      };
    }

    if (step.action === 'send_message') {
      const result = await sendMessage(attachedBrowser, step);
      return { status: 'completed', summary: summarizeAction('whatsapp', step, result), data: { page: await pageSnapshot(result.page), message: result.message, sent: result.sent } };
    }

    if (step.action === 'message_batch') {
      const outputs = await runBatchAction(step, async (username) => sendMessage(attachedBrowser, step, username));
      return { status: 'completed', summary: summarizeAction('whatsapp', step, { sent: !step.args.requireManualReview }), data: outputs.map((item) => ({ url: item.page.url(), message: item.message, sent: item.sent })) };
    }

    // NEW: Message a new contact by phone number (not in existing chats)
    if (step.action === 'message_new_contact' || step.action === 'send_to_new_number') {
      const { phoneNumber, messageGoal, tone, query, requireManualReview, attachmentPath } = step.args;
      
      if (!phoneNumber) {
        throw new Error('message_new_contact requires a phoneNumber');
      }
      
      // Normalize phone number (remove spaces, add + if missing)
      let normalizedNumber = phoneNumber.replace(/\s/g, '');
      if (!normalizedNumber.startsWith('+') && !normalizedNumber.startsWith('00')) {
        // If no country code prefix, assume it might need one or use as-is
        console.log(`[WhatsApp] Phone number: ${normalizedNumber}`);
      }
      
      console.log(`[WhatsApp] Opening chat with new number: ${normalizedNumber}`);
      
      // Navigate directly to wa.me link (this opens chat even if not in contacts)
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.whatsapp, { platform: 'whatsapp' });
      const waUrl = `https://wa.me/${normalizedNumber.replace(/\+/g, '')}`;
      
      await navigate(page, waUrl, 'whatsapp');
      await minimalDelay(2000);
      
      // Check if "Continue to Chat" button appears (first time) or direct chat opens
      const continueBtn = await firstVisibleLocator(page, [
        'a:has-text("Continue to Chat")',
        'button:has-text("Continue")',
        'a[href*="web.whatsapp.com"]'
      ]);
      
      if (continueBtn) {
        await continueBtn.click();
        await minimalDelay(2000);
      }
      
      // Now we should be in WhatsApp Web with the chat open
      await ensurePlatformReady(page, 'whatsapp');
      await minimalDelay(1000);
      
      // Verify chat is open
      const composer = await findComposer(page);
      if (!composer) {
        throw new Error(`Could not open chat with ${normalizedNumber}. The number may not be valid.`);
      }
      
      console.log(`[WhatsApp] Chat opened with ${normalizedNumber}`);
      
      // Generate message
      const chatContext = await extractChatContext(page, 6);
      const message = await generateOutreachMessage({
        username: normalizedNumber,
        goal: messageGoal,
        tone,
        query,
        platform: 'whatsapp',
        chatContext,
      });
      
      // Send message
      let sent = false;
      if (!requireManualReview) {
        await fillEditable(page, ['div[contenteditable="true"][data-tab="10"]', 'footer div[contenteditable="true"]'], message);
        await minimalDelay(300);
        await page.keyboard.press('Enter');
        await minimalDelay(500);
        sent = true;
        
        // Handle attachment
        if (attachmentPath) {
          await minimalDelay(1000);
          await uploadIntoVisibleFileInput(page, attachmentPath);
          await minimalDelay(1000);
          await page.keyboard.press('Enter');
        }
      }
      
      return {
        status: 'completed',
        summary: summarizeAction('whatsapp', step, { sent }),
        data: { 
          phoneNumber: normalizedNumber,
          message,
          sent,
          page: await pageSnapshot(page)
        }
      };
    }

    if (step.action === 'review_queue' || step.action === 'continue_outreach') {
      const { page } = await reviewQueue(attachedBrowser, 'whatsapp');
      return { status: 'ready', summary: summarizeAction('whatsapp', step), data: await pageSnapshot(page) };
    }

    if (step.action === 'delete_chat') {
      const page = await openTarget(attachedBrowser, step.args.username);
      await openWhatsAppPrimaryMenu(page);
      await clickWhatsAppMenuItem(page, ['Delete chat']);
      await confirmDialogAction(page, ['Delete chat']);
      return { status: 'completed', summary: summarizeAction('whatsapp', step), data: await pageSnapshot(page) };
    }

    if (step.action === 'block_user') {
      const page = await openTarget(attachedBrowser, step.args.username);

      // Wait for conversation to be fully loaded
      await minimalDelay(600);

      // Try to open contact info menu (different from primary menu)
      let openedMenu = false;
      const contactMenuSelectors = [
        'header button[title*="info"]',
        'header [aria-label*="info"]',
        'header [data-testid*="contact"]',
        'header [data-testid="conversation-info-header"]',
        'header button',
      ];

      for (const selector of contactMenuSelectors) {
        try {
          const locator = page.locator(selector).first();
          if (await locator.count() > 0) {
            await locator.click({ timeout: 2000 });
            await minimalDelay(500);
            openedMenu = true;
            break;
          }
        } catch { /* continue */ }
      }

      // Try primary menu as fallback
      if (!openedMenu) {
        await openWhatsAppPrimaryMenu(page);
      }

      // Click Block option
      await clickWhatsAppMenuItem(page, ['Block', 'Block contact']);

      // Confirm the block action
      await confirmDialogAction(page, ['Block', 'Block contact', 'Yes']);

      return { status: 'completed', summary: summarizeAction('whatsapp', step), data: await pageSnapshot(page) };
    }

    if (step.action === 'report_user') {
      const page = await openTarget(attachedBrowser, step.args.username);
      await openWhatsAppPrimaryMenu(page);
      await clickWhatsAppMenuItem(page, ['Report']);
      await confirmDialogAction(page, ['Report', 'Report contact']);
      return { status: 'completed', summary: summarizeAction('whatsapp', step), data: await pageSnapshot(page) };
    }

    if (step.action === 'scrape_results') {
      unsupported('whatsapp', step.action);
    }

    unsupported('whatsapp', step.action);
  },
};
