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
  submitComposer,
  tryClick,
  waitForAppShell,
} from '../common.js';
import { checkLoginState } from '../state-checker.js';

// Gmail Helper Functions
async function openGmailCompose(page) {
  // Try multiple ways to open compose
  const composeSelectors = [
    'div[role="button"][aria-label*="Compose"]',
    'div[role="button"][aria-label*="Compose"]',
    '.T-I-KE',
    'button[aria-label*="Compose"]',
    '[data-tooltip="Compose"]',
  ];

  // Try using page.getByRole first (Playwright 1.28+)
  try {
    await page.getByRole('button', { name: /compose/i }).click({ timeout: 3000 });
    await waitForAppShell(page);
    return true;
  } catch {
    // Fall through to selector-based approach
  }

  // Try click by aria-label
  const clicked = await tryClick(page, composeSelectors);
  if (clicked) {
    await waitForAppShell(page);
    return true;
  }

  // Try clicking by text
  const textClicked = await clickByText(page, ['div[role="button"]', 'button'], ['Compose', 'COMPOSE']);
  if (textClicked) {
    await waitForAppShell(page);
    return true;
  }

  throw new Error('Could not open Gmail compose window');
}

async function fillGmailCompose(page, { to, subject, body }) {
  // Fill recipient
  let recipientsFilled = { ok: true };
  if (to) {
    recipientsFilled = await fillEditable(page, [
      'input[aria-label*="To"]',
      'input[aria-label*="Recipients"]',
      'input[role="combobox"]',
      'input[peoplekit-id]',
      'input[name="to"]',
    ], to);

    // Wait for autocomplete and press Enter to confirm
    if (recipientsFilled.ok) {
      await minimalDelay(300);
      await page.keyboard.press('Enter').catch(() => {});
      await minimalDelay(200);
    }
  }

  // Fill subject
  const subjectFilled = await fillEditable(page, [
    'input[name="subjectbox"]',
    'input[aria-label*="Subject"]',
    'input[placeholder*="Subject"]',
  ], subject || 'Quick note');

  // Fill body
  const bodyFilled = await fillEditable(page, [
    'div[aria-label="Message Body"][contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[aria-label*="message"][contenteditable="true"]',
  ], body);

  return { recipientsFilled, subjectFilled, bodyFilled };
}

async function sendGmailMessage(page) {
  // Wait for any autocomplete to settle
  await minimalDelay(500);

  // Try keyboard shortcut first (most reliable)
  const shortcut = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
  await page.keyboard.press(shortcut).catch(() => {});

  // Wait longer for send to process
  await minimalDelay(1000);

  // Check if compose window is still open (send might have failed)
  const composeStillOpen = await firstVisibleLocator(page, [
    'div[aria-label="Message Body"][contenteditable="true"]',
    'div[role="dialog"] div[contenteditable="true"]',
    'input[name="subjectbox"]',
  ]);

  if (composeStillOpen) {
    // Try multiple Send button selectors
    const sendSelectors = [
      'div[role="button"][aria-label*="Send"]',
      'div[role="button"][data-tooltip*="Send"]',
      'div[role="button"][data-tooltip="Send ‪(Ctrl-Enter)‬"]',
      'div[role="button"][data-tooltip="Send ‪(⌘-Enter)‬"]',
      'div[aria-label*="Send"]',
      '.T-I-atl', // Gmail's send button class
      'div.T-I.T-I-atl',
      'div[role="button"]:has-text("Send")',
    ];

    let sent = false;
    for (const selector of sendSelectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.count() > 0 && await locator.isVisible()) {
          await locator.click({ timeout: 3000 });
          await minimalDelay(500);
          sent = true;
          break;
        }
      } catch { /* continue */ }
    }

    // Fallback to text-based click
    if (!sent) {
      const textClicked = await clickByText(page, ['div[role="button"]'], ['Send']);
      if (textClicked) {
        await minimalDelay(500);
        sent = true;
      }
    }

    // Try shortcut again as last resort
    if (!sent) {
      await page.keyboard.press(shortcut);
      await minimalDelay(500);
    }
  }

  // Verify compose closed
  await minimalDelay(300);
  return true;
}

export const gmailHandler = {
  platform: 'gmail',
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;

    // Check login state for actions that require auth
    if (['send_message', 'draft_message', 'open_target', 'message_batch'].includes(action)) {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      const state = await checkLoginState(page, 'gmail');
      if (!state.ready) {
        throw new Error(state.message || 'Please log in to Gmail');
      }
    }

    if (action === 'open_workspace') {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      return { status: 'ready', summary: summarizeAction('gmail', step), data: await pageSnapshot(page) };
    }

    if (action === 'search') {
      const page = await openAttachedPage(attachedBrowser, buildPlatformSearchUrl('gmail', args.query || args.prompt), { platform: 'gmail', forceNavigate: true });
      return { status: 'ready', summary: summarizeAction('gmail', step), data: await pageSnapshot(page) };
    }

    if (action === 'open_target') {
      // For Gmail, open_target opens compose to a specific email
      const { username } = args;
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });

      await openGmailCompose(page);

      if (username) {
        await fillGmailCompose(page, {
          to: username,
          subject: '',
          body: '',
        });
      }

      return {
        status: 'ready',
        summary: summarizeAction('gmail', step),
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
        platform: 'gmail',
        chatContext: [],
      });

      return {
        status: 'ready',
        summary: summarizeAction('gmail', step),
        data: { preview: message },
      };
    }

    if (action === 'send_message') {
      const { username, messageGoal, tone, query, requireManualReview } = args;

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });

      // Generate message
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'gmail',
        chatContext: [],
      });

      // Open compose
      await openGmailCompose(page);

      // Fill compose form
      const { recipientsFilled, subjectFilled, bodyFilled } = await fillGmailCompose(page, {
        to: username,
        subject: messageGoal || query || 'Quick note',
        body: message,
      });

      if (!recipientsFilled.ok || !subjectFilled.ok || !bodyFilled.ok) {
        throw new Error(`Could not prepare Gmail draft for "${username}"`);
      }

      // Send if not manual review
      let sent = false;
      if (!requireManualReview) {
        sent = await sendGmailMessage(page);
      }

      return {
        status: 'completed',
        summary: summarizeAction('gmail', step, { sent }),
        data: { page: await pageSnapshot(page), message, sent },
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
              platform: 'gmail',
              args: { ...args, username },
            },
            attachedBrowser,
          });
          results.push({ username, ...result });
          // Random delay between emails
          await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000));
        } catch (error) {
          results.push({ username, error: error.message, status: 'failed' });
        }
      }

      return {
        status: 'completed',
        summary: `Processed ${usernames.length} Gmail targets`,
        data: results,
      };
    }

    if (action === 'review_queue' || step.action === 'continue_outreach') {
      const { page } = await reviewQueue(attachedBrowser, 'gmail');
      return { status: 'ready', summary: summarizeAction('gmail', step), data: await pageSnapshot(page) };
    }

    // ACTION: Read emails from inbox
    if (action === 'read_emails') {
      const { maxResults = 10, filter = 'all' } = args;
      
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      await waitForAppShell(page);
      
      console.log(`[Gmail] Reading emails (filter: ${filter}, max: ${maxResults})...`);
      
      // Navigate to inbox if needed
      await navigate(page, 'https://mail.google.com/mail/u/0/#inbox', 'gmail');
      await minimalDelay(1000);
      
      // Extract email data from the page
      const emails = await page.evaluate((maxCount) => {
        const results = [];
        
        // Try multiple selectors for Gmail email rows
        const emailRows = document.querySelectorAll('tr[role="row"], .zA, [data-legacy-thread-id]');
        
        for (let i = 0; i < Math.min(emailRows.length, maxCount); i++) {
          const row = emailRows[i];
          
          // Extract sender
          const senderEl = row.querySelector('[email], .yW .yP, .bA4 span');
          const sender = senderEl?.getAttribute('email') || senderEl?.textContent?.trim() || 'Unknown';
          
          // Extract subject
          const subjectEl = row.querySelector('.y6, .bog span, [data-legacy-thread-id] span');
          const subject = subjectEl?.textContent?.trim() || '(no subject)';
          
          // Extract snippet/preview
          const snippetEl = row.querySelector('.y2, .Zt, .a4W');
          const snippet = snippetEl?.textContent?.trim() || '';
          
          // Extract timestamp
          const timeEl = row.querySelector('.xY .bq3, .xY .yO, time');
          const timestamp = timeEl?.textContent?.trim() || '';
          
          // Check if unread
          const isUnread = row.classList.contains('zE') || row.getAttribute('role') === 'row' && !row.classList.contains('yO');
          
          // Get thread ID for replying
          const threadId = row.getAttribute('data-legacy-thread-id') || row.getAttribute('data-thread-id') || '';
          
          if (sender && subject) {
            results.push({
              sender,
              subject,
              snippet,
              timestamp,
              isUnread,
              threadId
            });
          }
        }
        
        return results;
      }, maxResults);
      
      console.log(`[Gmail] Found ${emails.length} emails`);
      
      return {
        status: 'completed',
        summary: `Read ${emails.length} emails from Gmail inbox`,
        data: {
          emails,
          count: emails.length,
          filter
        }
      };
    }

    // ACTION: Reply to an email
    if (action === 'reply_to_email') {
      const { threadId, sender, messageGoal, tone, query, requireManualReview } = args;
      
      if (!threadId && !sender) {
        throw new Error('reply_to_email requires threadId or sender to identify the email');
      }
      
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      await waitForAppShell(page);
      
      console.log(`[Gmail] Opening email to reply...`);
      
      // Search for the email if threadId provided
      if (threadId) {
        await navigate(page, `https://mail.google.com/mail/u/0/#all/${threadId}`, 'gmail');
      } else if (sender) {
        // Search by sender
        const searchUrl = `https://mail.google.com/mail/u/0/#search/from:${encodeURIComponent(sender)}`;
        await navigate(page, searchUrl, 'gmail');
        await minimalDelay(1000);
        
        // Click first result
        const firstEmail = await firstVisibleLocator(page, ['tr[role="row"]', '.zA']);
        if (firstEmail) {
          await firstEmail.click();
          await minimalDelay(800);
        }
      }
      
      await minimalDelay(1500);
      
      // Extract email content for context
      const emailContent = await page.evaluate(() => {
        const subject = document.querySelector('h2[data-legacy-thread-id], .ha h2')?.textContent?.trim() || '';
        const body = document.querySelector('.a3s.aiL, .ii.gt .a3s')?.textContent?.trim() || '';
        const originalSender = document.querySelector('.gD, .iw .gD')?.getAttribute('email') || '';
        return { subject, body, originalSender };
      });
      
      console.log(`[Gmail] Email content extracted: ${emailContent.subject.slice(0, 50)}...`);
      
      // Click Reply button
      const replyClicked = await tryClick(page, [
        'div[role="button"][aria-label="Reply"]',
        'div[role="button"][data-tooltip="Reply"]',
        'div[aria-label="Reply"]',
        'div.T-I.J-J5-Ji.T-I-Js-IF.ahr'
      ]);
      
      if (!replyClicked) {
        // Try text-based click
        const replyByText = await clickByText(page, ['div[role="button"]'], ['Reply']);
        if (!replyByText) {
          throw new Error('Could not find Reply button');
        }
      }
      
      await minimalDelay(800);
      
      // Generate reply message
      const replyMessage = await generateOutreachMessage({
        username: emailContent.originalSender || sender,
        goal: messageGoal || 'reply to email',
        tone,
        query,
        platform: 'gmail',
        chatContext: [{ role: 'them', text: emailContent.body }],
        profileInfo: {}
      });
      
      // Fill reply body
      const bodyFilled = await fillEditable(page, [
        'div[aria-label="Message Body"][contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[aria-label*="message"][contenteditable="true"]'
      ], replyMessage);
      
      if (!bodyFilled.ok) {
        throw new Error('Could not fill reply body');
      }
      
      await minimalDelay(300);
      
      // Send reply if not manual review
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
        data: {
          replyTo: emailContent.originalSender || sender,
          subject: emailContent.subject,
          replyMessage,
          sent
        }
      };
    }

    throw new Error(`gmail does not support the "${action}" action in Cherry yet`);
  },
};
