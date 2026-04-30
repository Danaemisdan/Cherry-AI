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

function normalizeChatText(value = '') {
  return String(value).trim().toLowerCase();
}

async function extractChatContext(page, limit = 10) {
  // Extract recent messages from WhatsApp Web conversation
  try {
    const messages = await page.evaluate((msgLimit) => {
      const result = [];
      // Look for message bubbles - WhatsApp uses various selectors
      const messageSelectors = [
        '[data-testid="msg-container"]',
        '.message-in',
        '.message-out',
        'div[role="row"] div[data-pre-plain-text]',
        '[data-testid="msg"]',
        '.focusable-list-item div[dir]',
      ];

      for (const selector of messageSelectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          elements.forEach((el, idx) => {
            if (result.length >= msgLimit) return;

            // Determine if outgoing (me) or incoming (them)
            const isOutgoing = el.classList.contains('message-out') ||
                              el.closest('.message-out') !== null ||
                              el.getAttribute('data-testid')?.includes('out') ||
                              el.closest('[data-testid*="out"]') !== null ||
                              el.querySelector('span[data-testid*="check"]') !== null;

            // Extract text content
            let text = '';
            const textEl = el.querySelector('.selectable-text, span[dir="ltr"], div[dir="ltr"]');
            if (textEl) {
              text = textEl.textContent || '';
            } else {
              text = el.textContent || '';
            }

            // Clean up the text
            text = text.replace(/\s+/g, ' ').trim();
            if (text && text.length > 2) {
              // Avoid duplicates
              const lastMsg = result[result.length - 1];
              if (!lastMsg || lastMsg.text !== text) {
                result.push({
                  role: isOutgoing ? 'me' : 'them',
                  text: text.slice(0, 300), // Limit length
                });
              }
            }
          });
          if (result.length > 0) break; // Found messages with this selector
        }
      }

      return result.slice(-msgLimit); // Return last N messages
    }, limit);

    return messages || [];
  } catch (error) {
    return [];
  }
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
  await page.waitForTimeout(250).catch(() => {});

  searchBox = await findWhatsAppSearchBox(page);
  if (searchBox) return searchBox;

  await page.keyboard.press(`${modifier}+f`).catch(() => {});
  await page.waitForTimeout(250).catch(() => {});

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

  if (await currentHeaderMatches(page, target)) {
    const composer = await firstVisibleLocator(page, ['div[contenteditable="true"][data-tab="10"]', 'footer div[contenteditable="true"]']);
    if (composer) {
      return;
    }
  }

  if (digits) {
    await navigate(page, buildPlatformTargetUrl('whatsapp', username), 'whatsapp');
    const composer = await firstVisibleLocator(page, ['div[contenteditable="true"][data-tab="10"]', 'footer div[contenteditable="true"]']);
    if (!composer) {
      throw new Error(`WhatsApp did not open a conversation for "${username}"`);
    }
    return;
  }

  await ensurePlatformReady(page, 'whatsapp');

  const initialSearchBox = await findWhatsAppSearchBox(page);
  const visibleChat = await clickVisibleChatCandidate(page, target, { strict: true, searchBox: initialSearchBox });
  if (visibleChat) {
    // continue
  } else {
    const searchBox = await focusWhatsAppSearch(page);

    if (!searchBox) {
      throw new Error(`Could not find the WhatsApp chat search box. Candidates: ${await summarizeSearchInputs(page)}`);
    }

    await searchBox.click({ timeout: 3000 }).catch(() => {});
    await searchBox.fill('').catch(() => {});
    await searchBox.type(target, { delay: 20 }).catch(() => {});
    await page.waitForTimeout(1200).catch(() => {});

    const clicked = await clickVisibleChatCandidate(page, target, { strict: true, searchBox });
    if (!clicked) {
      throw new Error(`Could not find a WhatsApp chat for "${username}" in this profile`);
    }
  }

  const headerVisible = await page.waitForFunction(
    ({ expected }) => {
      const normalize = (value) => String(value || '').trim().toLowerCase();
      const titles = Array.from(document.querySelectorAll('header span[title], header h1, header div[role="button"] span'))
        .map((node) => normalize(node.textContent));
      return titles.some((value) => value === expected || value.startsWith(expected));
    },
    { expected: normalizeChatText(target) },
    { timeout: 12000 },
  ).then(() => true).catch(() => false);

  if (!headerVisible) {
    throw new Error(`WhatsApp did not switch into the "${username}" conversation`);
  }

  const composerReady = await page
    .locator('div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]')
    .first()
    .waitFor({ state: 'visible', timeout: 12000 })
    .then(() => true)
    .catch(() => false);

  if (!composerReady) {
    throw new Error(`WhatsApp composer is not ready for "${username}"`);
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
      const rows = Array.from(document.querySelectorAll('span[title], [data-testid="cell-frame-title"], div[role="listitem"], div[role="gridcell"]'));
      return rows.some((node) => {
        const text = normalize(node.getAttribute?.('title') || node.getAttribute?.('aria-label') || node.textContent);
        return text === expected || text.startsWith(expected) || text.includes(expected);
      });
    },
    { expected: target },
    { timeout: 12000 },
  ).then(() => true).catch(() => false);

  if (!found) {
    throw new Error(`Could not find a WhatsApp chat for "${username}" in this profile`);
  }
}

async function openWhatsAppPrimaryMenu(page) {
  const opened = await tryClick(page, [
    'header [aria-label="Menu"]',
    'header [aria-label*="menu"]',
    'header button[title*="Menu"]',
    'header [data-testid="menu"]',
    'button[aria-label="Menu"]',
    'button[aria-label*="menu"]',
    'div[role="button"][aria-label*="menu"]',
    'span[data-icon="menu"]',
  ]);

  if (!opened) {
    throw new Error('Could not open the WhatsApp menu');
  }

  await page.waitForTimeout(500).catch(() => {});
}

async function clickWhatsAppMenuItem(page, labels = []) {
  const selectors = [
    'div[role="menuitem"]',
    'button',
    'div[role="button"]',
    'li',
    'span',
  ];
  const clicked = await clickByText(page, selectors, labels);
  if (!clicked) {
    throw new Error(`Could not find a WhatsApp menu item matching: ${labels.join(', ')}`);
  }
  await page.waitForTimeout(500).catch(() => {});
}

async function confirmDialogAction(page, labels = []) {
  const clicked = await clickByText(page, ['button', 'div[role="button"]', 'span'], labels);
  if (!clicked) {
    throw new Error(`Could not confirm WhatsApp action: ${labels.join(', ')}`);
  }
  await page.waitForTimeout(700).catch(() => {});
}

async function openStatusView(page) {
  await ensurePlatformReady(page, 'whatsapp');
  const opened = await tryClick(page, [
    'button[aria-label*="Status"]',
    'button[aria-label*="Updates"]',
    'div[role="button"][aria-label*="Status"]',
    'div[role="button"][aria-label*="Updates"]',
    'span[data-icon="status"]',
    'span[data-icon="updates"]',
    'nav [aria-label*="Status"]',
    'nav [aria-label*="Updates"]',
  ]);

  if (!opened) {
    const clickedByText = await clickByText(page, ['button', 'div[role="button"]', 'span'], ['Status', 'Updates']);
    if (!clickedByText) {
      throw new Error('Could not open the WhatsApp status view');
    }
  }

  await page.waitForTimeout(1200).catch(() => {});
  return page;
}

async function openProfileSettings(page) {
  await openWhatsAppPrimaryMenu(page);
  await clickWhatsAppMenuItem(page, ['Profile', 'Settings']);
  await page.waitForTimeout(1200).catch(() => {});
}

async function uploadIntoVisibleFileInput(page, filePath) {
  if (!filePath) {
    throw new Error('This WhatsApp action needs an attachment path');
  }

  const input = page.locator('input[type="file"]').first();
  const exists = await input.count().catch(() => 0);
  if (!exists) {
    throw new Error('Could not find a WhatsApp file input for upload');
  }

  await input.setInputFiles(filePath).catch(() => {
    throw new Error('WhatsApp rejected the selected file');
  });
  await page.waitForTimeout(1200).catch(() => {});
}

async function openStatusComposer(page) {
  await openStatusView(page);
  const opened = await tryClick(page, [
    'button[aria-label*="Add status"]',
    'button[aria-label*="My status"]',
    'div[role="button"][aria-label*="Add status"]',
    'div[role="button"][aria-label*="My status"]',
    'span[data-icon="status-v3-unread"]',
    'span[data-icon="status-v3"]',
  ]);
  if (!opened) {
    const clickedByText = await clickByText(page, ['button', 'div[role="button"]', 'span'], ['Add status', 'My status']);
    if (!clickedByText) {
      throw new Error('Could not open the WhatsApp status composer');
    }
  }
  await page.waitForTimeout(1200).catch(() => {});
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

  // Extract chat context for smarter message generation
  const chatContext = await extractChatContext(page, 8);

  const message = await generateOutreachMessage({
    username,
    goal: step.args.messageGoal,
    tone: step.args.tone,
    query: step.args.query,
    platform: 'whatsapp',
    chatContext,
  });

  const filled = await fillEditable(page, ['div[contenteditable="true"][data-tab="10"]', 'footer div[contenteditable="true"]'], message);
  if (!filled.ok) {
    throw new Error(`Could not open the WhatsApp composer for "${username}"`);
  }

  if (!step.args.requireManualReview) {
    await page.keyboard.press('Enter').catch(() => {});
  }

  return { page, message, sent: !step.args.requireManualReview };
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

      const clickedEdit = await clickByText(page, ['button', 'div[role="button"]', 'span'], ['Profile photo', 'Edit profile photo', 'Edit photo']);
      if (!clickedEdit && step.args.attachmentPath) {
        await tryClick(page, [
          'button[aria-label*="Profile photo"]',
          'div[role="button"][aria-label*="Profile photo"]',
          'span[data-icon="camera"]',
        ]);
      }

      if (step.args.attachmentPath) {
        await uploadIntoVisibleFileInput(page, step.args.attachmentPath);
      }

      return { status: 'ready', summary: summarizeAction('whatsapp', step), data: await pageSnapshot(page) };
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
      await openWhatsAppPrimaryMenu(page);
      await clickWhatsAppMenuItem(page, ['Block']);
      await confirmDialogAction(page, ['Block']);
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
