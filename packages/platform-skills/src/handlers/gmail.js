import {
  PLATFORM_URLS,
  buildPlatformSearchUrl,
  clickByText,
  fillEditable,
  firstVisibleLocator,
  generateOutreachMessage,
  minimalDelay,
  navigate,
  openAttachedPage,
  pageSnapshot,
  reviewQueue,
  summarizeAction,
  tryClick,
  waitForAppShell,
} from '../common.js';
import { checkLoginState } from '../state-checker.js';
import * as path from 'path';

// ─── Core Gmail helpers ────────────────────────────────────────────────────────

async function openGmailCompose(page) {
  console.log('[Gmail] Opening Compose...');

  // Dismiss any notification banners first (they can cover the Compose button)
  await tryClick(page, ['button[aria-label="No thanks"]', 'button:has-text("No thanks")', '.bAp .T-I']).catch(() => {});
  await minimalDelay(300);

  // 1. Try the blue Compose button by its exact aria-label / data-tooltip
  const composeSelectors = [
    'div[role="button"][aria-label="Compose"]',
    'div[role="button"][data-tooltip="Compose"]',
    'div[role="button"][aria-label*="Compose"]',
    '.T-I-KE',           // Gmail's compose button CSS class
    'div.T-I.J-J5-Ji.T-I-KE.L3',
    '[gh="cm"]',         // Gmail compose shortcut element
  ];

  const clicked = await tryClick(page, composeSelectors);
  if (clicked) {
    await minimalDelay(800);
    return true;
  }

  // 2. Playwright role-based click
  try {
    await page.getByRole('button', { name: /^compose$/i }).click({ timeout: 3000 });
    await minimalDelay(800);
    return true;
  } catch { /* continue */ }

  // 3. Text-based click
  const textClicked = await clickByText(page, ['div[role="button"]', 'button'], ['Compose', 'COMPOSE']);
  if (textClicked) {
    await minimalDelay(800);
    return true;
  }

  // 4. Keyboard shortcut 'c' (Gmail hotkey for Compose)
  await page.keyboard.press('c');
  await minimalDelay(1000);

  // Verify compose opened
  const composer = await firstVisibleLocator(page, [
    'div[aria-label="Message Body"][contenteditable="true"]',
    'div[role="dialog"] input[name="subjectbox"]',
    'input[aria-label*="To"]',
  ]);
  if (composer) return true;

  throw new Error('Could not open Gmail compose window — make sure you are logged in to Gmail');
}

async function fillGmailField(page, selectors, value) {
  if (!value) return { ok: true };
  return fillEditable(page, selectors, value);
}

async function fillGmailCompose(page, { to, cc, bcc, subject, body, signature }) {
  // ── To ──────────────────────────────────────────────────────────────────────
  if (to) {
    await fillGmailField(page, [
      'input[aria-label="To"]',
      'input[aria-label*="To"]',
      'input[aria-label*="Recipients"]',
      'input[name="to"]',
      'input[role="combobox"]',
    ], to);
    await minimalDelay(300);
    await page.keyboard.press('Tab').catch(() => {});
    await minimalDelay(200);
  }

  // ── CC ──────────────────────────────────────────────────────────────────────
  if (cc) {
    // Open CC field if collapsed
    const ccLink = await firstVisibleLocator(page, [
      'span[aria-label="Add Cc recipients"]',
      'span:has-text("Cc")',
      '[data-tooltip="Cc"]',
    ]);
    if (ccLink) await ccLink.click().catch(() => {});
    await minimalDelay(300);

    await fillGmailField(page, [
      'input[aria-label="Cc"]',
      'input[aria-label*="Cc"]',
      'input[name="cc"]',
    ], cc);
    await minimalDelay(200);
    await page.keyboard.press('Tab').catch(() => {});
  }

  // ── BCC ─────────────────────────────────────────────────────────────────────
  if (bcc) {
    const bccLink = await firstVisibleLocator(page, [
      'span[aria-label="Add Bcc recipients"]',
      'span:has-text("Bcc")',
      '[data-tooltip="Bcc"]',
    ]);
    if (bccLink) await bccLink.click().catch(() => {});
    await minimalDelay(300);

    await fillGmailField(page, [
      'input[aria-label="Bcc"]',
      'input[aria-label*="Bcc"]',
      'input[name="bcc"]',
    ], bcc);
    await minimalDelay(200);
    await page.keyboard.press('Tab').catch(() => {});
  }

  // ── Subject ─────────────────────────────────────────────────────────────────
  await fillGmailField(page, [
    'input[name="subjectbox"]',
    'input[aria-label="Subject"]',
    'input[placeholder*="Subject"]',
  ], subject || 'Quick note');

  // ── Body + Signature ────────────────────────────────────────────────────────
  const fullBody = signature ? `${body || ''}\n\n${signature}` : (body || '');
  const bodyFilled = await fillGmailField(page, [
    'div[aria-label="Message Body"][contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[aria-label*="message"][contenteditable="true"]',
    'div[aria-label*="Message"][contenteditable="true"]',
  ], fullBody);

  return { ok: bodyFilled.ok };
}

async function attachFileToGmail(page, filePath) {
  if (!filePath) return;
  const ext = path.extname(filePath).toLowerCase();
  console.log(`[Gmail] Attaching file: ${filePath} (${ext})`);

  // For HTML files: Gmail's "Attach" paperclip button → file input
  // For images/videos: same flow
  let fileInput = await page.locator('input[type="file"]').first();

  if (await fileInput.count() === 0) {
    // Click the attachment (paperclip) button to reveal the file input
    const clipClicked = await tryClick(page, [
      'div[data-tooltip*="Attach files"]',
      'div[aria-label*="Attach files"]',
      'div[command="Files"]',
      '.a1 [command="Files"]',
      '.wG.J-Z-M-I.J-J5-Ji',
    ]);
    if (!clipClicked) {
      await clickByText(page, ['div[role="button"]', 'button'], ['Attach files', 'Attach']);
    }
    await minimalDelay(500);
    fileInput = await page.locator('input[type="file"]').first();
  }

  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(filePath);
    await minimalDelay(2000); // Wait for upload progress
    console.log('[Gmail] File attached');
  } else {
    console.warn('[Gmail] Could not find file input — attachment skipped');
  }
}

async function sendGmailMessage(page) {
  await minimalDelay(600);
  const shortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
  await page.keyboard.press(shortcut).catch(() => {});
  await minimalDelay(1200);

  // If compose is still open, try clicking Send button
  const composerStillOpen = await firstVisibleLocator(page, [
    'div[aria-label="Message Body"][contenteditable="true"]',
    'input[name="subjectbox"]',
  ]);

  if (composerStillOpen) {
    const sendSelectors = [
      'div[role="button"][aria-label*="Send"]',
      'div[role="button"][data-tooltip*="Send"]',
      '.T-I-atl',
      'div.T-I.T-I-atl',
    ];
    let sent = false;
    for (const sel of sendSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.count() > 0 && await el.isVisible()) {
          await el.click({ timeout: 3000 });
          sent = true;
          break;
        }
      } catch { /* continue */ }
    }
    if (!sent) {
      await clickByText(page, ['div[role="button"]'], ['Send']);
    }
  }

  await minimalDelay(500);
  return true;
}

// ─── Context extraction ────────────────────────────────────────────────────────

async function extractInboxContext(page, { maxResults = 15, filter = 'all' } = {}) {
  let url = 'https://mail.google.com/mail/u/0/#inbox';
  if (filter === 'unread') url = 'https://mail.google.com/mail/u/0/#inbox?compose=new&view=unread';
  if (filter === 'starred') url = 'https://mail.google.com/mail/u/0/#starred';

  await navigate(page, 'https://mail.google.com/mail/u/0/#inbox', 'gmail');
  await minimalDelay(1500);

  return page.evaluate((maxCount) => {
    const results = [];
    const rows = document.querySelectorAll('tr[role="row"], .zA, [data-legacy-thread-id]');
    for (let i = 0; i < Math.min(rows.length, maxCount); i++) {
      const row = rows[i];
      const senderEl = row.querySelector('[email], .yW .yP, .bA4 span');
      const sender = senderEl?.getAttribute('email') || senderEl?.textContent?.trim() || 'Unknown';
      const subjectEl = row.querySelector('.y6, .bog span');
      const subject = subjectEl?.textContent?.trim() || '(no subject)';
      const snippetEl = row.querySelector('.y2, .Zt, .a4W');
      const snippet = snippetEl?.textContent?.trim() || '';
      const timeEl = row.querySelector('.xY .bq3, .xY .yO, time');
      const timestamp = timeEl?.textContent?.trim() || '';
      const isUnread = row.classList.contains('zE');
      const threadId = row.getAttribute('data-legacy-thread-id') || '';
      if (sender && subject) {
        results.push({ sender, subject, snippet, timestamp, isUnread, threadId });
      }
    }
    return results;
  }, maxResults);
}

async function getProfileContextFromEmail(page, emailAddress) {
  console.log(`[Gmail] Getting profile context for ${emailAddress}...`);

  // Search Gmail for all emails from this person
  const searchUrl = `https://mail.google.com/mail/u/0/#search/from:${encodeURIComponent(emailAddress)}`;
  await navigate(page, searchUrl, 'gmail');
  await minimalDelay(2000);

  const threads = await page.evaluate(() => {
    const rows = document.querySelectorAll('tr[role="row"], .zA');
    const results = [];
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const row = rows[i];
      const subjectEl = row.querySelector('.y6, .bog span');
      const snippetEl = row.querySelector('.y2, .Zt, .a4W');
      const timeEl = row.querySelector('.xY .bq3, .xY .yO');
      results.push({
        subject: subjectEl?.textContent?.trim() || '',
        snippet: snippetEl?.textContent?.trim() || '',
        date: timeEl?.textContent?.trim() || '',
      });
    }
    return results;
  });

  // Try to open the first email to extract full context
  let fullEmailBody = '';
  let senderName = emailAddress;
  try {
    const firstRow = await firstVisibleLocator(page, ['tr[role="row"]', '.zA']);
    if (firstRow) {
      await firstRow.click();
      await minimalDelay(1500);

      const emailData = await page.evaluate(() => {
        const fromEl = document.querySelector('.gD, .iw .gD');
        const bodyEl = document.querySelector('.a3s.aiL, .ii.gt .a3s');
        const nameEl = document.querySelector('.go span[name]');
        return {
          name: nameEl?.getAttribute('name') || fromEl?.textContent?.trim() || '',
          email: fromEl?.getAttribute('email') || '',
          body: (bodyEl?.innerText || '').slice(0, 800),
        };
      });

      senderName = emailData.name || emailData.email || emailAddress;
      fullEmailBody = emailData.body;
    }
  } catch (e) {
    console.warn('[Gmail] Could not open email for profile context:', e.message);
  }

  return {
    emailAddress,
    displayName: senderName,
    threadCount: threads.length,
    recentSubjects: threads.map(t => t.subject).filter(Boolean),
    latestSnippet: threads[0]?.snippet || '',
    latestEmailBody: fullEmailBody,
    searchUrl,
  };
}

async function searchGmail(page, query) {
  console.log(`[Gmail] Searching for: "${query}"`);
  const searchUrl = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
  await navigate(page, searchUrl, 'gmail');
  await minimalDelay(2000);

  return page.evaluate(() => {
    const rows = document.querySelectorAll('tr[role="row"], .zA');
    const results = [];
    rows.forEach(row => {
      const senderEl = row.querySelector('[email], .yW .yP');
      const subjectEl = row.querySelector('.y6, .bog span');
      const snippetEl = row.querySelector('.y2, .Zt');
      const timeEl = row.querySelector('.xY .bq3');
      if (subjectEl?.textContent?.trim()) {
        results.push({
          sender: senderEl?.getAttribute('email') || senderEl?.textContent?.trim() || '',
          subject: subjectEl?.textContent?.trim() || '',
          snippet: snippetEl?.textContent?.trim() || '',
          date: timeEl?.textContent?.trim() || '',
          threadId: row.getAttribute('data-legacy-thread-id') || '',
        });
      }
    });
    return results.slice(0, 25);
  });
}

// ─── Main handler ──────────────────────────────────────────────────────────────

export const gmailHandler = {
  platform: 'gmail',
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;

    // Auth check for write actions
    if (['send_message', 'draft_message', 'open_target', 'message_batch'].includes(action)) {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      const state = await checkLoginState(page, 'gmail');
      if (!state.ready) {
        throw new Error(state.message || 'Please log in to Gmail in the Cherry browser profile');
      }
    }

    // ── Open workspace ──────────────────────────────────────────────────────
    if (action === 'open_workspace') {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      return { status: 'ready', summary: summarizeAction('gmail', step), data: await pageSnapshot(page) };
    }

    // ── Search emails ────────────────────────────────────────────────────────
    if (action === 'search') {
      const { query } = args;
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      await waitForAppShell(page, 'gmail');
      const results = await searchGmail(page, query || args.prompt || '');
      return {
        status: 'completed',
        summary: `Found ${results.length} Gmail threads for "${query}"`,
        data: { results, query },
      };
    }

    // ── Get inbox context ────────────────────────────────────────────────────
    if (action === 'get_context' || action === 'read_emails') {
      const { maxResults = 15, filter = 'all' } = args;
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      await waitForAppShell(page, 'gmail');
      const emails = await extractInboxContext(page, { maxResults, filter });
      return {
        status: 'completed',
        summary: `Extracted ${emails.length} emails from Gmail inbox`,
        data: { emails, count: emails.length, filter },
      };
    }

    // ── Get profile context from email address ───────────────────────────────
    if (action === 'get_profile_context') {
      const { username } = args;
      if (!username) throw new Error('get_profile_context requires an email address');
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      await waitForAppShell(page, 'gmail');
      const profile = await getProfileContextFromEmail(page, username);
      return {
        status: 'completed',
        summary: `Got profile context for ${username} from Gmail history`,
        data: profile,
      };
    }

    // ── Open target (open compose to a specific email) ────────────────────────
    if (action === 'open_target') {
      const { username } = args;
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      await waitForAppShell(page, 'gmail');
      await openGmailCompose(page);
      if (username) {
        await fillGmailCompose(page, { to: username, subject: '', body: '' });
      }
      return { status: 'ready', summary: summarizeAction('gmail', step), data: await pageSnapshot(page) };
    }

    // ── Draft message ─────────────────────────────────────────────────────────
    if (action === 'draft_message') {
      const { username, messageGoal, tone, query, emailSubject, emailSignature } = args;
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'gmail',
        chatContext: [],
        profileInfo: {},
      });
      const subject = emailSubject || messageGoal || query || 'Quick note';
      return {
        status: 'ready',
        summary: summarizeAction('gmail', step),
        data: { preview: message, subject },
      };
    }

    // ── Send message (Auto-Email) ──────────────────────────────────────────────
    if (action === 'send_message') {
      const {
        username,
        messageGoal,
        tone,
        query,
        requireManualReview,
        emailSubject,
        emailCc,
        emailBcc,
        emailSignature,
        attachmentPath,
      } = args;

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      await waitForAppShell(page, 'gmail');

      // Get profile context from email history to personalise the message
      let profileContext = {};
      try {
        profileContext = await getProfileContextFromEmail(page, username);
        console.log(`[Gmail] Profile: ${profileContext.displayName}, ${profileContext.threadCount} past threads`);
      } catch (e) {
        console.warn('[Gmail] Could not extract profile context:', e.message);
      }

      // Generate message
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'gmail',
        chatContext: profileContext.latestEmailBody
          ? [{ role: 'them', text: profileContext.latestEmailBody }]
          : [],
        profileInfo: { displayName: profileContext.displayName },
      });

      // Compose subject — use explicit subject from args if set, else derive from goal
      const subject = emailSubject
        || (profileContext.recentSubjects?.[0] ? `Re: ${profileContext.recentSubjects[0]}` : null)
        || messageGoal
        || query
        || 'Quick note';

      // Open compose window
      await openGmailCompose(page);

      // Fill all compose fields
      const { ok } = await fillGmailCompose(page, {
        to: username,
        cc: emailCc,
        bcc: emailBcc,
        subject,
        body: message,
        signature: emailSignature,
      });

      if (!ok) {
        throw new Error(`Could not prepare Gmail draft for "${username}"`);
      }

      // Attach file if provided (HTML, image, video, document)
      if (attachmentPath) {
        await attachFileToGmail(page, attachmentPath);
      }

      await minimalDelay(400);

      // Send
      let sent = false;
      if (!requireManualReview) {
        sent = await sendGmailMessage(page);
      }

      return {
        status: 'completed',
        summary: summarizeAction('gmail', step, { sent }),
        data: {
          page: await pageSnapshot(page),
          message,
          subject,
          to: username,
          cc: emailCc,
          bcc: emailBcc,
          hasAttachment: !!attachmentPath,
          sent,
        },
      };
    }

    // ── Batch send ────────────────────────────────────────────────────────────
    if (action === 'message_batch') {
      const usernames = (args.usernames || []).slice(0, Math.max(1, Math.min(Number(args.maxResults) || 10, 15)));
      const results = [];
      for (const username of usernames) {
        try {
          const result = await this.execute({
            step: { action: 'send_message', platform: 'gmail', args: { ...args, username } },
            attachedBrowser,
          });
          results.push({ username, ...result });
          await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));
        } catch (error) {
          results.push({ username, error: error.message, status: 'failed' });
        }
      }
      return {
        status: 'completed',
        summary: `Sent ${results.filter(r => r.status === 'completed').length}/${usernames.length} Gmail emails`,
        data: results,
      };
    }

    // ── Reply to email ────────────────────────────────────────────────────────
    if (action === 'reply_to_email') {
      const { threadId, sender, messageGoal, tone, query, requireManualReview, emailSignature } = args;
      if (!threadId && !sender) throw new Error('reply_to_email requires threadId or sender');

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      await waitForAppShell(page, 'gmail');

      if (threadId) {
        await navigate(page, `https://mail.google.com/mail/u/0/#all/${threadId}`, 'gmail');
      } else {
        await navigate(page, `https://mail.google.com/mail/u/0/#search/from:${encodeURIComponent(sender)}`, 'gmail');
        await minimalDelay(1000);
        const firstRow = await firstVisibleLocator(page, ['tr[role="row"]', '.zA']);
        if (firstRow) { await firstRow.click(); await minimalDelay(800); }
      }

      await minimalDelay(1500);

      const emailContent = await page.evaluate(() => {
        const subject = document.querySelector('h2[data-legacy-thread-id], .ha h2')?.textContent?.trim() || '';
        const body = document.querySelector('.a3s.aiL, .ii.gt .a3s')?.innerText?.slice(0, 800) || '';
        const fromEl = document.querySelector('.gD, .iw .gD');
        return {
          subject,
          body,
          originalSender: fromEl?.getAttribute('email') || fromEl?.textContent?.trim() || sender,
        };
      });

      const replyClicked = await tryClick(page, [
        'div[role="button"][aria-label="Reply"]',
        'div[role="button"][data-tooltip="Reply"]',
        'div[aria-label="Reply"]',
      ]);
      if (!replyClicked) await clickByText(page, ['div[role="button"]'], ['Reply']);
      await minimalDelay(800);

      const replyMessage = await generateOutreachMessage({
        username: emailContent.originalSender || sender,
        goal: messageGoal || 'reply to email',
        tone,
        query,
        platform: 'gmail',
        chatContext: [{ role: 'them', text: emailContent.body }],
        profileInfo: {},
      });

      const fullReply = emailSignature ? `${replyMessage}\n\n${emailSignature}` : replyMessage;
      const bodyFilled = await fillEditable(page, [
        'div[aria-label="Message Body"][contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
      ], fullReply);

      if (!bodyFilled.ok) throw new Error('Could not fill reply body');

      let sent = false;
      if (!requireManualReview) {
        const shortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
        await page.keyboard.press(shortcut).catch(() => {});
        await minimalDelay(800);
        sent = true;
      }

      return {
        status: 'completed',
        summary: `Replied to email from ${emailContent.originalSender || sender}`,
        data: { replyTo: emailContent.originalSender || sender, subject: emailContent.subject, replyMessage: fullReply, sent },
      };
    }

    // ── Review queue ──────────────────────────────────────────────────────────
    if (action === 'review_queue' || action === 'continue_outreach') {
      const { page } = await reviewQueue(attachedBrowser, 'gmail');
      return { status: 'ready', summary: summarizeAction('gmail', step), data: await pageSnapshot(page) };
    }

    throw new Error(`gmail does not support the "${action}" action in Cherry yet`);
  },
};
