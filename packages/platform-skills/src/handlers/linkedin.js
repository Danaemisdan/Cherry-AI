import process from 'node:process';
import {
  PLATFORM_URLS,
  buildPlatformTargetUrl,
  generateOutreachMessage,
  minimalDelay,
  navigate,
  openAttachedPage,
  pageSnapshot,
  summarizeAction,
  waitForAppShell,
} from '../common.js';
import { checkLoginState } from '../state-checker.js';
import { extractChatContext } from '../chat-context.js';
import { extractPageContent, findElementsByText, parseProfileFromContent } from '../page-extractor.js';
import { createSocialHandler } from '../social-base.js';


/** Clicks "Send without a note" on the artdeco invitation modal (popup), not the More overflow menu. */
async function clickSendWithoutNote(page) {
  await minimalDelay(200);
  try {
    await page.getByRole('button', { name: /send without a note/i }).first().click({ timeout: 12000 });
    await minimalDelay(1200);
    return true;
  } catch {
    /* fall through */
  }
  const clicked = await page.evaluate(() => {
    function vis(el) {
      if (!el?.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') === 0) return false;
      return true;
    }
    const scope =
      [...document.querySelectorAll('.artdeco-modal, [role="dialog"]')].find((m) => {
        const t = (m.innerText || '').replace(/\s+/g, ' ');
        return /send without a note/i.test(t) && /invitation|connect/i.test(t) && vis(m);
      }) || document.body;
    const buttons = [...scope.querySelectorAll('button')];
    const target = buttons.find((btn) => {
      if (!vis(btn)) return false;
      const al = (btn.getAttribute('aria-label') || '').trim();
      if (/^send without a note$/i.test(al)) return true;
      return /send without a note/i.test(`${al} ${btn.textContent || ''}`);
    });
    if (target) {
      target.click();
      return true;
    }
    return false;
  });
  if (clicked) await minimalDelay(1200);
  return clicked;
}

async function tryClickPrimaryProfileConnect(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    const candidates = [...main.querySelectorAll('button, a, div[role="button"]')];
    for (const el of candidates) {
      if (el.offsetParent === null) continue;
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t !== 'Connect') continue;
      const deny = /pending|following|message|follow|withdraw/i.test(
        `${el.getAttribute('aria-label') || ''} ${t}`,
      );
      if (deny) continue;
      el.click();
      return true;
    }
    return false;
  });
}

async function clickMoreOnProfile(page) {
  const clicked = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body;
    const buttons = [...main.querySelectorAll('button')];
    const scored = buttons
      .map((el, order) => {
        if (el.offsetParent === null) return null;
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t !== 'More') return null;
        const r = el.getBoundingClientRect();
        return { el, order, top: r.top };
      })
      .filter(Boolean)
      .sort((a, b) => a.top - b.top);
    if (!scored.length) return false;
    scored[0].el.click();
    return true;
  });
  if (!clicked) {
    const fallback = await findElementsByText(page, 'More', { tagNames: ['button'], fuzzy: false });
    if (fallback.length === 0) return false;
    await page.evaluate((index) => {
      document.querySelectorAll('button')[index]?.click();
    }, fallback[0].index);
  }
  return true;
}

async function clickConnectInOverflowMenu(page) {
  await minimalDelay(450);
  return page.evaluate(() => {
    const menu =
      document.querySelector('[role="menu"]') ||
      document.querySelector('.artdeco-dropdown__content--is-open') ||
      document.querySelector('.artdeco-dropdown__content-inner');
    if (!menu) return { ok: false, reason: 'no_menu' };
    const candidates = [...menu.querySelectorAll('[role="menuitem"], a, button, div[role="button"]')];
    const connects = candidates.filter((el) => {
      if (el.offsetParent === null) return false;
      const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return raw === 'Connect';
    });
    if (!connects.length) return { ok: false, reason: 'no_connect' };

    const pickNonInvite = () =>
      connects.find((el) => {
        const href = el.getAttribute('href') || '';
        return !href.includes('custom-invite') && !href.includes('/preload/');
      });
    const pickButton = () => connects.find((el) => (el.tagName || '').toLowerCase() === 'button');
    const target = pickNonInvite() || pickButton() || connects[0];
    const href = target.getAttribute('href') || '';
    const inviteAnchor = /custom-invite|\/preload\//i.test(href);
    // Same as user click — many profiles only expose Connect as an <a> to custom-invite; that still opens the artdeco invite modal on a lot of builds.
    target.click();
    return { ok: true, inviteAnchor };
  });
}

async function openLinkedInConnectModalFromMoreMenu(page, username) {
  await navigate(page, `https://www.linkedin.com/in/${username}/`, 'linkedin');
  await waitForAppShell(page, 'linkedin');
  await minimalDelay(1400);

  if (await tryClickPrimaryProfileConnect(page)) {
    await minimalDelay(800);
    return { inviteAnchor: false };
  }

  if (!(await clickMoreOnProfile(page))) {
    throw new Error('Could not find More button on profile');
  }
  await minimalDelay(900);

  const menuResult = await clickConnectInOverflowMenu(page);
  if (!menuResult.ok) {
    const detail =
      menuResult.reason === 'no_menu'
        ? 'Could not find the More dropdown menu after clicking More.'
        : 'Could not find Connect in the More menu.';
    throw new Error(detail);
  }
  await minimalDelay(menuResult.inviteAnchor ? 1600 : 700);
  return { inviteAnchor: Boolean(menuResult.inviteAnchor) };
}

async function waitForLinkedInInviteModal(page, timeoutMs = 35000) {
  const t0 = Date.now();
  const roleBudget = Math.min(22000, Math.max(6000, Math.floor(timeoutMs / 2)));

  try {
    await page
      .getByRole('button', { name: /send without a note/i })
      .first()
      .waitFor({ state: 'visible', timeout: roleBudget });
    return;
  } catch {
    /* continue */
  }

  const afterRole = Date.now() - t0;
  const locBudget = Math.min(12000, Math.max(2000, timeoutMs - afterRole));
  try {
    await page.locator('button[aria-label="Send without a note"]').first().waitFor({ state: 'visible', timeout: locBudget });
    return;
  } catch {
    /* continue */
  }

  while (Date.now() - t0 < timeoutMs) {
    const ready = await page.evaluate(() => {
      function vis(el) {
        if (!el?.getBoundingClientRect) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        const st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') === 0) return false;
        return true;
      }
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const body = norm(document.body?.innerText || '').slice(0, 150000);
      if (/add a note to your invitation/i.test(body) && /send without a note/i.test(body)) return true;

      const bars = [...document.querySelectorAll('.artdeco-modal__actionbar')];
      for (const bar of bars) {
        if (!vis(bar)) continue;
        const has = [...bar.querySelectorAll('button')].some((b) =>
          /send without a note/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '')),
        );
        if (has) return true;
      }

      for (const m of document.querySelectorAll('.artdeco-modal, [role="dialog"]')) {
        const t = norm(m.innerText || '');
        if (!/send without a note/i.test(t)) continue;
        if (!/invitation|connect/i.test(t)) continue;
        if (vis(m)) return true;
      }

      return [...document.querySelectorAll('button')].some((b) => {
        if (!vis(b)) return false;
        const label = ((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || '')).replace(/\s+/g, ' ');
        return /send without a note/i.test(label);
      });
    });
    if (ready) return;
    await minimalDelay(400);
  }

  throw new Error(
    'LinkedIn invite modal did not appear (expected visible "Send without a note"). If you see the modal in Chrome, try bringing that tab to the foreground or dismiss overlays.',
  );
}

async function completeLinkedInInviteWithNote(page, truncatedNote) {
  // Step 1: First modal — "Add a note" (secondary) next to "Send without a note". Text may live in .artdeco-button__text.
  const inviteShell = page
    .locator('.artdeco-modal, [role="dialog"]')
    .filter({ hasText: /send without a note|add a note to your invitation/i })
    .first();

  let addClicked = false;
  try {
    await inviteShell.getByRole('button', { name: /add a note/i }).first().click({ timeout: 12000 });
    addClicked = true;
  } catch {
    /* fall through */
  }
  if (!addClicked) {
    try {
      await page.locator('button[aria-label="Add a note"]').first().click({ timeout: 10000 });
      addClicked = true;
    } catch {
      /* fall through */
    }
  }
  if (!addClicked) {
    addClicked = await page.evaluate(() => {
      function vis(el) {
        if (!el?.getBoundingClientRect) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        const st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') === 0) return false;
        return true;
      }
      const modals = [...document.querySelectorAll('.artdeco-modal, [role="dialog"]')];
      const invite = modals.find((m) => {
        const t = (m.innerText || '').replace(/\s+/g, ' ');
        return /send without a note/i.test(t) && vis(m);
      });
      const scope = invite || document.body;
      const buttons = [...scope.querySelectorAll('button')];
      const target = buttons.find((b) => {
        if (!vis(b)) return false;
        const raw = ((b.getAttribute('aria-label') || '') + ' ' + (b.innerText || b.textContent || ''))
          .replace(/\s+/g, ' ')
          .trim();
        if (/send without a note/i.test(raw)) return false;
        return /add a note/i.test(raw);
      });
      if (target) {
        target.click();
        return true;
      }
      return false;
    });
  }

  if (!addClicked) {
    throw new Error('Could not find "Add a note" on the invitation dialog');
  }
  await minimalDelay(800);

  // Step 2: Composer — textarea and/or contenteditable (LinkedIn varies)
  const composerSelectors = [
    '.artdeco-modal textarea',
    '[role="dialog"] textarea',
    '.artdeco-modal div[contenteditable="true"]',
    'textarea[placeholder*="know each other" i]',
    'textarea[placeholder*="Ex:" i]',
  ];
  let filled = false;
  for (const sel of composerSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.count().catch(() => 0)) {
      try {
        await loc.waitFor({ state: 'visible', timeout: 15000 });
        await loc.click({ timeout: 3000 }).catch(() => {});
        const tag = await loc.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
        if (tag === 'textarea') {
          await loc.fill(truncatedNote, { timeout: 10000 });
        } else {
          await loc.fill(truncatedNote).catch(async () => {
            await page.keyboard.type(truncatedNote, { delay: 5 });
          });
        }
        filled = true;
        break;
      } catch {
        /* try next selector */
      }
    }
  }
  if (!filled) {
    const modalTa = page.locator('.artdeco-modal textarea, [role="dialog"] textarea').last();
    await modalTa.waitFor({ state: 'visible', timeout: 15000 });
    await modalTa.click();
    await modalTa.fill(truncatedNote);
  }

  await minimalDelay(500);

  // Step 3: Send — LinkedIn uses aria-label="Send invitation" (role name), inner text "Send"
  const noteComposerShell = page
    .locator('.artdeco-modal, [role="dialog"]')
    .filter({ hasText: /\/\s*300|personal note|add a note to your invitation/i })
    .first();

  const deadline = Date.now() + 35000;
  let sent = false;

  while (Date.now() < deadline && !sent) {
    try {
      const byAria = page.locator('button[aria-label="Send invitation"]').first();
      if (await byAria.count()) {
        const ariaDis = await byAria.getAttribute('aria-disabled').catch(() => null);
        const dis = await byAria.getAttribute('disabled').catch(() => null);
        if (ariaDis !== 'true' && !dis) {
          await byAria.click({ timeout: 5000 });
          sent = true;
          break;
        }
      }
    } catch {
      /* continue */
    }

    try {
      await page.getByRole('button', { name: 'Send invitation' }).first().click({ timeout: 4000 });
      sent = true;
      break;
    } catch {
      /* continue */
    }

    try {
      await noteComposerShell
        .getByRole('button', { name: /send invitation/i })
        .first()
        .click({ timeout: 4000 });
      sent = true;
      break;
    } catch {
      /* continue */
    }

    try {
      const primarySend = noteComposerShell
        .locator('button.artdeco-button--primary')
        .filter({ hasText: /^\s*send\s*$/i })
        .first();
      if (await primarySend.count()) {
        const ariaDis = await primarySend.getAttribute('aria-disabled').catch(() => null);
        if (ariaDis !== 'true') {
          await primarySend.click({ timeout: 4000 });
          sent = true;
          break;
        }
      }
    } catch {
      /* continue */
    }

    await minimalDelay(350);
  }

  if (!sent) {
    sent = await page.evaluate(() => {
      function vis(el) {
        if (!el?.getBoundingClientRect) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        const st = window.getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') === 0) return false;
        return true;
      }
      const scope =
        [...document.querySelectorAll('.artdeco-modal, [role="dialog"]')].find((m) =>
          /\/\s*300|personal note|add a note to your invitation/i.test(m.innerText || ''),
        ) || document.body;
      const buttons = [...scope.querySelectorAll('button')].filter(vis);
      const send = buttons.find((b) => {
        if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
        const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
        const al = (b.getAttribute('aria-label') || '').trim();
        if (/send without a note/i.test(`${al} ${t}`)) return false;
        return /send invitation/i.test(al) || /^send$/i.test(t);
      });
      if (send) {
        send.click();
        return true;
      }
      return false;
    });
  }

  if (!sent) throw new Error('Could not find or activate Send after adding a connection note');
  await minimalDelay(1200);
}

/**
 * LinkedIn handler — messaging uses /messaging/ inside openLinkedInChat.
 * Profile actions (follow, connect) use /in/{username}/. More → Connect opens a dropdown first,
 * then LinkedIn shows the invite as an artdeco-modal popup (not the dropdown).
 */

const LINKEDIN_MESSAGE_COMPOSER_SELECTORS = [
  '.msg-form__contenteditable[contenteditable="true"]',
  '.msg-form__message-texteditor [contenteditable="true"]',
  '.msg-form div[role="textbox"][contenteditable="true"]',
  '.msg-form div[aria-label*="Write a message" i][contenteditable="true"]',
  '.msg-form div[aria-label*="Type a message" i][contenteditable="true"]',
  '.msg-form textarea',
  '[role="dialog"] div[aria-label*="Write a message" i][contenteditable="true"]',
  '[role="dialog"] div[aria-label*="Type a message" i][contenteditable="true"]',
  '[role="dialog"] textarea[placeholder*="Write a message" i]',
  '[role="dialog"] textarea[aria-label*="Write a message" i]',
  '.msg-overlay-conversation-bubble .msg-form [contenteditable="true"]',
  '.msg-overlay-conversation-bubble [aria-label*="Write a message" i]',
  '.msg-overlay-conversation-bubble [aria-label*="Type a message" i]',
  '[aria-label*="Write a message" i][contenteditable="true"]',
  '[aria-label*="Type a message" i][contenteditable="true"]',
];

function normalizeLinkedInTarget(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withoutAt = raw.replace(/^@+/, '');
  const match = withoutAt.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return decodeURIComponent(match?.[1] || withoutAt).replace(/[/?#].*$/, '').trim();
}

async function clickFirstVisible(page, selectors = []) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;

    await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
    try {
      await locator.click({ timeout: 4000 });
      return true;
    } catch {
      /* try next selector */
    }
  }
  return false;
}

async function findLinkedInMessageComposer(page) {
  for (const selector of LINKEDIN_MESSAGE_COMPOSER_SELECTORS) {
    const locator = page.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    const isMessageBody = await locator.evaluate((el) => {
      const text = [
        el.getAttribute('aria-label'),
        el.getAttribute('placeholder'),
        el.getAttribute('data-placeholder'),
        el.className,
      ].filter(Boolean).join(' ').toLowerCase();

      if (/search|recipient|type a name|subject|comment|post|headline|title/.test(text)) return false;
      return /write a message|type a message|message/.test(text) || Boolean(el.closest('.msg-form, [role="dialog"], [class*="msg-overlay"]'));
    }).catch(() => true);
    if (isMessageBody) return locator;
  }

  const fallbackIndex = await page.evaluate(() => {
    function visible(el) {
      if (!el?.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 12) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
    }

    const candidates = [...document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')];
    let bestIndex = -1;
    let bestScore = 0;

    candidates.forEach((el, index) => {
      if (!visible(el)) return;
      const text = [
        el.getAttribute('aria-label'),
        el.getAttribute('placeholder'),
        el.getAttribute('data-placeholder'),
        el.className,
        el.closest('.msg-form')?.className,
        el.closest('[class*="msg-overlay"]')?.className,
        el.closest('[role="dialog"]')?.innerText?.slice(0, 160),
      ].filter(Boolean).join(' ').toLowerCase();

      if (/search|recipient|type a name|multiple names|subject|comment|post|headline|title/.test(text)) return;

      let score = 0;
      if (el.closest('.msg-form')) score += 20;
      if (el.closest('[class*="msg-overlay"]')) score += 10;
      if (el.closest('[role="dialog"]')) score += 10;
      if (/write a message|type a message|message/.test(text)) score += 12;
      if (/new message|inmail|premium/.test(text)) score += 5;
      if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') score += 5;
      if (el.tagName === 'TEXTAREA') score += 4;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    return bestScore >= 12 ? bestIndex : -1;
  }).catch(() => -1);

  if (fallbackIndex >= 0) {
    return page.locator('textarea, [contenteditable="true"], [role="textbox"]').nth(fallbackIndex);
  }

  return null;
}

async function fillLinkedInInMailSubjectIfPresent(page, messageGoal) {
  const subject = String(messageGoal || 'Quick chat?').trim().slice(0, 80) || 'Quick chat?';
  const subjectSelectors = [
    '[role="dialog"] input[placeholder*="Subject" i]',
    '[role="dialog"] input[aria-label*="Subject" i]',
    'input[placeholder*="Subject" i]',
    'input[aria-label*="Subject" i]',
  ];

  for (const selector of subjectSelectors) {
    const input = page.locator(selector).first();
    if (!(await input.count().catch(() => 0))) continue;
    if (!(await input.isVisible().catch(() => false))) continue;

    const currentValue = await input.inputValue().catch(() => '');
    if (currentValue.trim()) return true;

    await input.click({ timeout: 2500 }).catch(() => {});
    await input.fill(subject, { timeout: 5000 }).catch(async () => {
      await page.keyboard.insertText(subject).catch(() => {});
    });
    await minimalDelay(200);
    return true;
  }

  return false;
}

async function waitForLinkedInMessageComposer(page, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const composer = await findLinkedInMessageComposer(page);
    if (composer) return composer;
    await minimalDelay(350);
  }
  return null;
}

async function fillLinkedInMessageComposer(page, message, options = {}) {
  await fillLinkedInInMailSubjectIfPresent(page, options.messageGoal);
  const composer = await waitForLinkedInMessageComposer(page, 15000);
  if (!composer) {
    throw new Error('Message composer not found');
  }

  await composer.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
  await composer.click({ timeout: 5000 }).catch(() => {});
  await minimalDelay(120);

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+a`).catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});

  try {
    await composer.fill(message, { timeout: 8000 });
  } catch {
    await page.keyboard.insertText(message).catch(async () => {
      await page.keyboard.type(message, { delay: 8 });
    });
  }

  const hasText = await composer.evaluate((el, expected) => {
    const current = (el.value || el.innerText || el.textContent || '').trim();
    if (current) return true;

    if ('value' in el) {
      el.value = expected;
    } else {
      el.focus();
      el.textContent = expected;
    }

    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: expected }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return Boolean((el.value || el.innerText || el.textContent || '').trim());
  }, message).catch(() => false);

  if (!hasText) {
    await composer.click({ timeout: 3000 }).catch(() => {});
    await page.keyboard.insertText(message).catch(() => page.keyboard.type(message, { delay: 8 }));
  }

  return composer;
}

async function sendLinkedInComposer(page) {
  let clicked = false;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !clicked) {
    clicked = await page.evaluate(() => {
      function visible(el) {
        if (!el?.getBoundingClientRect) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
      }

      function enabled(el) {
        return !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[aria-disabled="true"]');
      }

      const forms = [...document.querySelectorAll('form.msg-form, .msg-form')]
        .filter(visible)
        .filter((form) => {
          const body = [...form.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')].find((el) => {
            if (!visible(el)) return false;
            const meta = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('data-placeholder') || ''}`.toLowerCase();
            if (/search|recipient|type a name|subject/.test(meta)) return false;
            return (el.value || el.innerText || el.textContent || '').trim().length > 0;
          });
          return Boolean(body);
        });

      for (const form of forms.reverse()) {
        const exactTargets = [
          'footer .msg-form__right-actions > div:nth-child(1) > button.msg-form__send-button[type="submit"]',
          'footer .msg-form__right-actions > div:nth-child(1) button.msg-form__send-button[type="submit"]',
          'footer button.msg-form__send-button[type="submit"]',
          'footer button.msg-form__send-btn[type="submit"]',
          'button.msg-form__send-button[type="submit"]',
          'button.msg-form__send-btn[type="submit"]',
        ];

        for (const selector of exactTargets) {
          const button = form.querySelector(selector);
          if (!button || !visible(button) || !enabled(button)) continue;
          const label = `${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''} ${button.innerText || button.textContent || ''}`;
          const hasSendIcon = Boolean(button.querySelector('svg[data-test-icon="send-privately-small"], use[href="#send-privately-small"], svg[data-test-icon*="send" i], use[href*="send" i]'));
          if (!/\bsend\b/i.test(label) && !hasSendIcon && !button.classList.contains('msg-form__send-button') && !button.classList.contains('msg-form__send-btn')) continue;

          button.focus?.();
          const ownerForm = button.closest('form');
          if (ownerForm?.requestSubmit) {
            ownerForm.requestSubmit(button);
          } else {
            button.click();
          }
          return true;
        }
      }

      return false;
    }).catch(() => false);

    if (!clicked) {
      await minimalDelay(300);
    }
  }

  if (!clicked) {
    const footerSend = page.locator('form.msg-form footer .msg-form__right-actions > div:nth-child(1) button.msg-form__send-button[type="submit"], .msg-form footer .msg-form__right-actions > div:nth-child(1) button.msg-form__send-button[type="submit"]').last();
    if ((await footerSend.count().catch(() => 0)) && (await footerSend.isVisible().catch(() => false))) {
      await footerSend.click({ timeout: 5000, force: true });
      clicked = true;
    }
  }

  if (!clicked) {
    throw new Error('LinkedIn send button was not enabled or not found');
  }

  await minimalDelay(700);
  await confirmLinkedInSendWithoutEditing(page);
  return true;
}

async function likeLinkedInCurrentPost(page) {
  const result = await page.evaluate(() => {
    const POST_SCOPE_SELECTOR = [
      '.feed-shared-update-v2',
      '.feed-detail-main-content',
      '.feed-shared-update-detail-viewer',
      '.profile-creator-shared-feed-update__container',
      'article',
      '[data-urn*="activity"]',
    ].join(', ');

    function visible(el) {
      if (!el?.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
    }

    function enabled(el) {
      return !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[aria-disabled="true"]');
    }

    function labelOf(el) {
      return `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.innerText || el.textContent || ''}`
        .replace(/\s+/g, ' ')
        .trim();
    }

    function findVisibleCommentEditor() {
      return [...document.querySelectorAll(
        [
          '.comments-comment-box__form-container [contenteditable="true"]',
          '.comments-comment-box [contenteditable="true"]',
          '.ql-editor[contenteditable="true"]',
          '[role="textbox"][contenteditable="true"]',
          'textarea',
        ].join(', '),
      )].find((editor) => visible(editor));
    }

    function candidateScopes() {
      const scopes = [];
      const editor = findVisibleCommentEditor();
      const editorScope = editor?.closest(POST_SCOPE_SELECTOR);
      if (editorScope && visible(editorScope)) scopes.push(editorScope);

      for (const scope of document.querySelectorAll(POST_SCOPE_SELECTOR)) {
        if (!visible(scope) || scopes.includes(scope)) continue;
        const rect = scope.getBoundingClientRect();
        if (rect.top < 70) continue;
        scopes.push(scope);
      }

      const main = document.querySelector('main') || document.body;
      if (main && !scopes.includes(main)) scopes.push(main);
      return scopes;
    }

    function buttonScore(button, scope) {
      const label = labelOf(button);
      const className = String(button.className || '');
      const rect = button.getBoundingClientRect();
      let score = 1000;

      if (!/\blike(?:d)?\b|\bunlike\b/i.test(label)) return null;
      if (/\b(comment|reply|send|share|repost|copy|report|follow|more|reaction|reactions)\b/i.test(label)) return null;
      if (/^\s*(?:\.{3}|…)\s*$/.test(label)) return null;
      if (button.closest('.comments-comment-item, .comments-comments-list, .comments-comment-entity')) return null;

      if (/^like$/i.test(label)) score -= 450;
      if (/\breact\s+like\b/i.test(label)) score -= 430;
      if (/\blike\b/i.test(label)) score -= 300;
      if (/social-actions|react-button|reactions-react-button/i.test(className)) score -= 160;
      if (button.closest('.feed-shared-social-action-bar, .update-components-social-actions, .social-actions')) score -= 260;
      if (button.closest('.feed-shared-social-counts, .social-details-social-counts, .comments-comment-social-bar')) score += 600;

      const scopeRect = scope.getBoundingClientRect();
      score += Math.max(0, rect.top - scopeRect.top) / 8;
      score += Math.max(0, rect.left - scopeRect.left) / 1000;

      return score;
    }

    for (const scope of candidateScopes()) {
      const buttons = [...scope.querySelectorAll('button, div[role="button"]')]
        .filter((button) => visible(button) && enabled(button))
        .map((button) => ({ button, label: labelOf(button), score: buttonScore(button, scope) }))
        .filter((item) => item.score !== null)
        .sort((a, b) => a.score - b.score);

      const target = buttons[0];
      if (!target) continue;

      if (/\bunlike\b|\bliked\b/i.test(target.label) || target.button.getAttribute('aria-pressed') === 'true') {
        return { ok: true, alreadyLiked: true, label: target.label };
      }

      target.button.scrollIntoView?.({ block: 'center', inline: 'center' });
      target.button.click();
      return { ok: true, clicked: true, label: target.label };
    }

    return { ok: false };
  }).catch(() => ({ ok: false }));

  if (!result.ok) {
    const fallback = page
      .locator(
        [
          '.feed-shared-social-action-bar button[aria-label*="Like" i]',
          '.update-components-social-actions button[aria-label*="Like" i]',
          'button.react-button__trigger[aria-label*="Like" i]',
          'button[aria-label*="React Like" i]',
        ].join(', '),
      )
      .first();
    if ((await fallback.count().catch(() => 0)) && (await fallback.isVisible().catch(() => false))) {
      await fallback.click({ timeout: 5000, force: true });
      await minimalDelay(700);
      return true;
    }
    throw new Error('LinkedIn like button was not found');
  }

  await minimalDelay(700);
  return true;
}

function linkedinProfileHandleFromUrl(url = '') {
  const match = String(url || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

async function openLinkedInCommentComposerForCurrentPost(page) {
  const hasComposer = await page.evaluate(() => {
    function visible(el) {
      if (!el?.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
    }

    return [...document.querySelectorAll(
      [
        '.comments-comment-box__form-container [contenteditable="true"]',
        '.comments-comment-box [contenteditable="true"]',
        '.comments-comment-texteditor [contenteditable="true"]',
        '[aria-label*="Add a comment" i][contenteditable="true"]',
        '[data-placeholder*="Add a comment" i][contenteditable="true"]',
        '.ql-editor[contenteditable="true"]',
      ].join(', '),
    )].some((el) => visible(el));
  }).catch(() => false);
  if (hasComposer) return true;

  let clicked = await page.evaluate(() => {
    function visible(el) {
      if (!el?.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
    }

    function enabled(el) {
      return !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[aria-disabled="true"]');
    }

    function labelOf(el) {
      return `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.innerText || el.textContent || ''}`
        .replace(/\s+/g, ' ')
        .trim();
    }

    const postScopes = [
      ...document.querySelectorAll(
        [
          '.feed-shared-update-v2',
          '.feed-detail-main-content',
          '.feed-shared-update-detail-viewer',
          '.profile-creator-shared-feed-update__container',
          '.profile-creator-shared-content-view__footer',
          '.feed-shared-social-action-bar',
          '.update-components-social-actions',
          'article',
          '[data-urn*="activity"]',
        ].join(', '),
      ),
    ].filter(visible);

    const main = document.querySelector('main') || document.body;
    const scopes = postScopes.length ? postScopes : [main];
    const candidates = [];

    for (const scope of scopes) {
      for (const button of scope.querySelectorAll('button, div[role="button"]')) {
        if (!visible(button) || !enabled(button)) continue;
        const label = labelOf(button);
        const normalized = label.toLowerCase();
        if (!/^comment$/.test(normalized) && !/\bcomment\s+on\b/i.test(label)) continue;
        if (/\b(comments|reply|copy|report|follow|like|repost|share|more|videos|images|posts)\b/i.test(label)) continue;
        const inActivityFilter =
          button.closest('.profile-creator-shared-content-tabs, .artdeco-pill-choice-group') ||
          [...button.closest('section, div')?.querySelectorAll('button, a, div[role="button"]') || []]
            .some((peer) => /^(posts|comments|videos|images|more)$/i.test(labelOf(peer)));
        if (inActivityFilter) continue;

        const rect = button.getBoundingClientRect();
        if (rect.top < 90) continue;
        candidates.push({
          button,
          score: rect.top + (button.closest('.feed-shared-social-action-bar, .update-components-social-actions, .social-actions') ? -200 : 0),
        });
      }
    }

    candidates.sort((a, b) => a.score - b.score);
    const target = candidates[0]?.button;
    if (!target) return false;
    target.scrollIntoView?.({ block: 'center', inline: 'center' });
    target.click();
    return true;
  }).catch(() => false);

  if (!clicked) {
    const commentButtons = [
      page.locator('.feed-shared-social-action-bar button, .update-components-social-actions button').filter({ hasText: /^Comment$/ }).first(),
      page.locator('button[aria-label^="Comment" i], div[role="button"][aria-label^="Comment" i]').first(),
      page.getByRole('button', { name: /^Comment$/ }).first(),
    ];

    for (const button of commentButtons) {
      if (!(await button.count().catch(() => 0))) continue;
      if (!(await button.isVisible().catch(() => false))) continue;
      await button.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
      await button.click({ timeout: 5000, force: true }).catch(() => {});
      await minimalDelay(900);
      clicked = true;
      break;
    }
  }

  if (clicked) {
    await minimalDelay(900);
  }

  if (!clicked) return false;

  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      function visible(el) {
        if (!el?.getBoundingClientRect) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
      }

      return [...document.querySelectorAll(
        [
          '.comments-comment-box__form-container [contenteditable="true"]',
          '.comments-comment-box [contenteditable="true"]',
          '.comments-comment-texteditor [contenteditable="true"]',
          '[aria-label*="Add a comment" i][contenteditable="true"]',
          '[data-placeholder*="Add a comment" i][contenteditable="true"]',
          '.ql-editor[contenteditable="true"]',
        ].join(', '),
      )].some((el) => visible(el));
    }).catch(() => false);
    if (ready) return true;
    await minimalDelay(250);
  }

  return false;
}

async function openLatestLinkedInPost(page) {
  const handle = linkedinProfileHandleFromUrl(page.url());
  if (handle) {
    await navigate(page, `https://www.linkedin.com/in/${handle}/recent-activity/posts/`, 'linkedin');
    await waitForAppShell(page, 'linkedin');
    await minimalDelay(1400);
    const postsFilterClicked = await page.evaluate(() => {
      function visible(el) {
        if (!el?.getBoundingClientRect) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
      }

      const main = document.querySelector('main') || document.body;
      const controls = [...main.querySelectorAll('a, button, div[role="button"]')].filter(visible);
      const posts = controls.find((el) => {
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        return /^posts$/i.test(text);
      });

      if (!posts) return false;
      const selected =
        posts.getAttribute('aria-selected') === 'true' ||
        posts.getAttribute('aria-current') === 'page' ||
        /selected|active/i.test(String(posts.className || ''));
      if (!selected) posts.click();
      return true;
    }).catch(() => false);
    if (postsFilterClicked) await minimalDelay(900);
  } else {
    await page.mouse.wheel(0, 500).catch(() => {});
    await minimalDelay(500);
  }

  const opened = await page.evaluate((profileHandle) => {
    function visible(el) {
      if (!el?.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
    }

    function textOf(el) {
      return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    const main = document.querySelector('main') || document.body;
    const activityHeader = [...main.querySelectorAll('h1, h2, h3, .text-heading-large, .text-heading-xlarge')]
      .find((el) => /activity/i.test(textOf(el)));
    const headerBottom = activityHeader?.getBoundingClientRect().bottom || 150;

    const linkCandidates = [...main.querySelectorAll('a[href]')]
      .filter(visible)
      .map((link, order) => {
        const href = new URL(link.href || link.getAttribute('href') || '', location.href);
        const hrefText = href.href;
        const rect = link.getBoundingClientRect();
        const text = textOf(link);
        let score = rect.top + rect.left / 1000 + order / 100000;

        if (rect.top < headerBottom + 10) score += 800;
        if (/^(posts|comments|videos|images|more)$/i.test(text)) score += 1000;
        if (/\/feed\/update\//i.test(hrefText)) score -= 500;
        if (/urn:li:activity/i.test(hrefText)) score -= 450;
        if (/\/posts\//i.test(hrefText)) score -= 420;
        if (/\/pulse\//i.test(hrefText)) score -= 360;
        if (/\/activity\//i.test(hrefText)) score -= 260;
        if (/miniProfile|overlay|comment|reaction|likes|followers|recent-activity|search|messaging|notifications/i.test(hrefText)) score += 800;
        if (profileHandle && new RegExp(`/in/${profileHandle}/?$`, 'i').test(href.pathname)) score += 1000;

        const looksLikePost =
          /\/feed\/update\/|urn:li:activity|\/posts\/|\/pulse\/|\/activity\//i.test(hrefText) &&
          !/miniProfile|overlay|comment|reaction|likes|followers|recent-activity/i.test(hrefText);

        return { link, href: hrefText, score, looksLikePost };
      })
      .filter((item) => item.looksLikePost && item.score < 800)
      .sort((a, b) => a.score - b.score);

    if (linkCandidates[0]?.link) {
      linkCandidates[0].link.scrollIntoView?.({ block: 'center', inline: 'center' });
      linkCandidates[0].link.click();
      return { ok: true, href: linkCandidates[0].href };
    }

    const cardCandidates = [
      ...main.querySelectorAll(
        [
          '.profile-creator-shared-feed-update__container',
          '.feed-shared-update-v2',
          'article',
          '[data-urn*="activity"]',
          'li',
          '.artdeco-card',
        ].join(', '),
      ),
    ]
      .filter(visible)
      .map((card, order) => {
        const rect = card.getBoundingClientRect();
        const text = textOf(card);
        let score = rect.top + rect.left / 1000 + order / 100000;
        if (rect.top < headerBottom + 10) score += 800;
        if (/^(posts|comments|videos|images|more)$/i.test(text)) score += 1000;
        if (/\b(follow|message|connect|people you may know|followers)\b/i.test(text)) score += 500;
        if (/\b(?:now|today|\d+\s*(?:m|h|d|w|mo))\b/i.test(text)) score -= 150;
        if (card.querySelector('img, video, a[href*="/feed/update/"], a[href*="/posts/"], a[href*="/pulse/"], a[href*="urn:li:activity"]')) score -= 120;
        return { card, score };
      })
      .filter((item) => item.score < 800)
      .sort((a, b) => a.score - b.score);

    if (cardCandidates[0]?.card) {
      const card = cardCandidates[0].card;
      const link = [...card.querySelectorAll('a[href]')].find((el) => visible(el) && !/miniProfile|followers|recent-activity/i.test(el.href || ''));
      const target = link || card;
      target.scrollIntoView?.({ block: 'center', inline: 'center' });
      target.click();
      return { ok: true, card: true };
    }

    return { ok: false };
  }, handle).catch(() => ({ ok: false }));

  if (opened.ok && !opened.inline) {
    await waitForAppShell(page, 'linkedin');
    await minimalDelay(1300);
  }

  await openLinkedInCommentComposerForCurrentPost(page).catch(() => false);
}

async function sendLinkedInComment(page) {
  let clicked = false;
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline && !clicked) {
    clicked = await page.evaluate(() => {
      function visible(el) {
        if (!el?.getBoundingClientRect) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
      }

      function enabled(el) {
        return !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.closest('[aria-disabled="true"]');
      }

      function textOf(el) {
        return `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.innerText || el.textContent || ''}`
          .replace(/\s+/g, ' ')
          .trim();
      }

      function isSubmitCandidate(button) {
        const label = textOf(button);
        const className = String(button.className || '');
        const isSubmitClass = /comments-comment-box__submit-button|comments-comment-texteditor__submit-button/i.test(className);
        const isPrimarySubmit = /artdeco-button--primary/i.test(className) && /\b(comment|post|send|reply)\b/i.test(label);
        const isTextSubmit = /^(comment|post|send|reply)$/i.test(label) || /\b(post comment|comment|send|reply)\b/i.test(label);
        if (!isSubmitClass && !isPrimarySubmit && !isTextSubmit) return false;
        if (/\b(more|copy link|report|follow|like|repost|share|emoji|image)\b|^\s*(?:\.{3}|…)\s*$/i.test(label)) return false;
        return true;
      }

      function hasCommentText(editor) {
        const text = (editor.value || editor.innerText || editor.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) return false;

        const meta = `${editor.getAttribute('aria-label') || ''} ${editor.getAttribute('placeholder') || ''} ${editor.getAttribute('data-placeholder') || ''}`.toLowerCase();
        return !/search|message|recipient|type a name|subject/.test(meta);
      }

      const editors = [...document.querySelectorAll(
        [
          '.comments-comment-box__form-container [contenteditable="true"]',
          '.comments-comment-box [contenteditable="true"]',
          '.comments-comment-box textarea',
          'form.comments-comment-box__form [contenteditable="true"]',
          'form.comments-comment-box__form textarea',
          '.ql-editor[contenteditable="true"]',
          '[role="textbox"][contenteditable="true"]',
          'textarea',
        ].join(', '),
      )].filter((editor) => visible(editor) && hasCommentText(editor));

      for (const editor of editors.reverse()) {
        const editorRect = editor.getBoundingClientRect();
        const scopes = [
          editor.closest('form.comments-comment-box__form'),
          editor.closest('form'),
          editor.closest('.comments-comment-box'),
          editor.closest('.comments-comment-box__form-container')?.parentElement,
          editor.closest('.comments-comment-texteditor')?.parentElement,
          editor.closest('.feed-shared-update-v2'),
          editor.closest('article'),
        ].filter(Boolean);

        for (const scope of scopes) {
          if (!visible(scope)) continue;

          const selectors = [
            'button.comments-comment-box__submit-button[type="submit"]',
            'button.comments-comment-box__submit-button',
            'button.comments-comment-texteditor__submit-button',
            'button[type="submit"].artdeco-button--primary',
            'button[type="submit"]',
            'button.artdeco-button--primary',
          ];

          const buttons = selectors.flatMap((selector) => [...scope.querySelectorAll(selector)]);
          for (const button of buttons) {
            if (!visible(button) || !enabled(button)) continue;
            if (!isSubmitCandidate(button)) continue;

            button.focus?.();
            const ownerForm = button.closest('form');
            if (ownerForm?.requestSubmit) {
              ownerForm.requestSubmit(button);
            } else {
              button.click();
            }
            return true;
          }
        }

        const nearbyButtons = [...document.querySelectorAll('button, div[role="button"]')]
          .filter((button) => visible(button) && enabled(button) && isSubmitCandidate(button))
          .map((button) => {
            const rect = button.getBoundingClientRect();
            const dx = Math.max(0, rect.left - editorRect.right, editorRect.left - rect.right);
            const dy = Math.max(0, rect.top - editorRect.bottom, editorRect.top - rect.bottom);
            const sameVerticalBand = rect.top >= editorRect.top - 40 && rect.top <= editorRect.bottom + 140;
            const score = dx + dy * 2 + (sameVerticalBand ? 0 : 400);
            return { button, score };
          })
          .filter(({ score }) => score < 700)
          .sort((a, b) => a.score - b.score);

        if (nearbyButtons[0]) {
          const button = nearbyButtons[0].button;
          button.focus?.();
          const ownerForm = button.closest('form');
          if (ownerForm?.requestSubmit) {
            ownerForm.requestSubmit(button);
          } else {
            button.click();
          }
          return true;
        }
      }

      return false;
    }).catch(() => false);

    if (!clicked) {
      await minimalDelay(300);
    }
  }

  if (!clicked) {
    const scopedSubmit = page
      .locator(
        [
          '.comments-comment-box button.comments-comment-box__submit-button[type="submit"]',
          '.comments-comment-box button.comments-comment-box__submit-button',
          '.comments-comment-texteditor button.comments-comment-texteditor__submit-button',
          'form.comments-comment-box__form button[type="submit"]',
          'button.artdeco-button--primary:has-text("Comment")',
        ].join(', '),
      )
      .last();
    if ((await scopedSubmit.count().catch(() => 0)) && (await scopedSubmit.isVisible().catch(() => false))) {
      await scopedSubmit.click({ timeout: 5000, force: true });
      clicked = true;
    }
  }

  if (!clicked) {
    throw new Error('LinkedIn comment submit button was not enabled or not found');
  }

  await minimalDelay(900);
  return true;
}

async function confirmLinkedInSendWithoutEditing(page) {
  const clicked = await page.evaluate(() => {
    function visible(el) {
      if (!el?.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
    }

    const dialog = [...document.querySelectorAll('[role="dialog"], .artdeco-modal')]
      .find((el) => visible(el) && /send without editing/i.test(el.innerText || el.textContent || ''));
    if (!dialog) return false;

    const send = [...dialog.querySelectorAll('button')].find((button) => {
      if (!visible(button) || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
      const text = `${button.getAttribute('aria-label') || ''} ${button.innerText || button.textContent || ''}`.replace(/\s+/g, ' ').trim();
      return /^send$/i.test(text) || /\bsend\b/i.test(text) && !/cancel|close/i.test(text);
    });

    if (!send) return false;
    send.click();
    return true;
  }).catch(() => false);

  if (clicked) await minimalDelay(700);
  return clicked;
}

async function clickLinkedInMessageButtonFromProfile(page, expectedName = '', expectedSlug = '') {
  return page.evaluate(({ expectedName: name, expectedSlug: slug }) => {
    function visible(el) {
      if (!el?.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
    }

    const normalize = (value) => String(value || '').toLowerCase().replace(/^@+/, '').replace(/\s+/g, ' ').trim();
    const compact = (value) => normalize(value).replace(/[^a-z0-9]/g, '');
    const main = document.querySelector('main') || document.body;
    const h1 = main.querySelector('h1');
    const h1Rect = h1?.getBoundingClientRect();
    const profileText = normalize(name || h1?.innerText || '');
    const profileCompact = compact(profileText || slug);

    function isMessageControl(el) {
      if (!visible(el)) return false;
      const label = `${el.getAttribute('aria-label') || ''} ${el.innerText || el.textContent || ''}`.replace(/\s+/g, ' ').trim();
      const href = el.getAttribute('href') || '';
      if (!(/\bmessage\b/i.test(label) || /\/messaging\/compose/i.test(href))) return false;
      if (/messaging settings|message requests/i.test(label)) return false;
      if (el.closest('aside, [class*="right-rail"], [aria-label*="People also viewed"]')) return false;
      return true;
    }

    // Prefer the action row/card that owns the current profile heading. The button
    // can be left or right of Follow/Connect depending on the profile state.
    const h1Card = h1?.closest('section, .artdeco-card, [data-view-name], main > div');
    if (h1Card && visible(h1Card)) {
      const cardText = compact(h1Card.innerText || '');
      if (!profileCompact || cardText.includes(profileCompact)) {
        const scopedControls = [...h1Card.querySelectorAll('a, button, div[role="button"]')];
        const scopedTarget = scopedControls.find(isMessageControl);
        if (scopedTarget) {
          scopedTarget.click();
          return true;
        }
      }
    }

    const candidates = [...main.querySelectorAll('button, a, div[role="button"]')];
    let best = null;
    let bestScore = -Infinity;

    for (const el of candidates) {
      if (!isMessageControl(el)) continue;
      const href = el.getAttribute('href') || '';

      const rect = el.getBoundingClientRect();
      const toolbar = el.closest('[role="toolbar"]');
      const toolbarText = normalize(toolbar?.innerText || '');
      const ancestorText = normalize(el.closest('section, .artdeco-card, [data-view-name], main > div')?.innerText || '');

      let score = 0;
      if (/\/messaging\/compose/i.test(href)) score += 25;
      if (toolbar) score += 30;
      if (profileCompact && compact(toolbarText).includes(profileCompact)) score += 80;
      if (profileCompact && compact(ancestorText).includes(profileCompact)) score += 45;

      if (h1Rect) {
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        if (centerY >= h1Rect.top - 20 && centerY <= h1Rect.bottom + 280) score += 35;
        if (centerX >= h1Rect.left - 80 && centerX <= h1Rect.right + 320) score += 35;
        if (centerX > h1Rect.right + 520) score -= 120;
        score -= Math.abs(centerY - h1Rect.bottom) / 30;
      }

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (!best || bestScore < 25) return false;
    best.click();
    return true;
  }, { expectedName, expectedSlug }).catch(() => false);
}

async function selectLinkedInMessagingResult(page, q) {
  const picked = await page.evaluate((name) => {
    function visible(el) {
      if (!el?.getBoundingClientRect) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') !== 0;
    }

    const normalize = (value) => String(value || '').toLowerCase().replace(/^@+/, '').replace(/\s+/g, ' ').trim();
    const compact = (value) => normalize(value).replace(/[^a-z0-9]/g, '');
    const target = normalize(name);
    const compactTarget = compact(name);
    const targetWords = target.split(/[\s._-]+/).filter(Boolean);
    const selectors = [
      '[data-test-search-result]',
      '.msg-entity-lockup',
      '.msg-conversation-card',
      '.msg-conversation-listitem',
      '.msg-thread-list__thread',
      '.msg-connections-typeahead__result',
      '.msg-compose__suggested-entity',
      '.msg-recipient-suggestions__entity',
      '[class*="typeahead"] li',
      'li.artdeco-list__item',
      'div[role="option"]',
      'button[data-test-app-aware-link]',
      'a[href*="/in/"]',
    ];

    let best = null;
    let bestScore = 0;

    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el)) continue;
        const text = normalize(el.innerText || el.textContent || '');
        const href = normalize(el.getAttribute('href') || el.querySelector('a[href*="/in/"]')?.getAttribute('href') || '');
        const haystack = `${text} ${href}`;
        const compactHaystack = compact(haystack);
        if (!haystack) continue;

        let score = 0;
        if (haystack.includes(target)) score += 30;
        if (compactTarget && compactHaystack.includes(compactTarget)) score += 34;
        for (const word of targetWords) {
          if (word.length > 1 && haystack.includes(word)) score += 6;
        }
        if (el.matches('.msg-conversation-card, .msg-conversation-listitem, .msg-thread-list__thread')) score += 5;
        if (/suggested|typeahead|option|artdeco-list__item/.test(el.className || '') || el.matches('div[role="option"], li.artdeco-list__item')) score += 4;
        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
    }

    if (!best || bestScore < 6) return false;
    const clickable = best.closest('li, div[role="option"], .msg-conversation-card, .msg-conversation-listitem, .msg-thread-list__thread') ||
      best.querySelector('button, div[role="button"], a') ||
      best;
    clickable.click();
    return true;
  }, q);

  if (!picked) return false;
  await minimalDelay(1500);
  return Boolean(await waitForLinkedInMessageComposer(page, 10000));
}

async function openLinkedInConversationFromMessaging(page, searchName, { compose = true } = {}) {
  const q = normalizeLinkedInTarget(searchName);
  await navigate(page, 'https://www.linkedin.com/messaging/', 'linkedin');
  await waitForAppShell(page, 'linkedin');
  await minimalDelay(900);

  if (compose) {
    await clickFirstVisible(page, [
      'button.msg-new-conversation-compose__trigger',
      'button[aria-label*="Compose" i]',
      'button[aria-label*="New message" i]',
      'button:has-text("Compose")',
      'button:has-text("New message")',
      '.msg-new-conversation-compose__trigger',
    ]);
    await minimalDelay(700);
  }

  const searchSelectors = compose ? [
    '.msg-connections-typeahead__search-field input',
    '.msg-compose-form__recipient-typeahead input',
    '.msg-new-conversation-compose__form input',
    'input[placeholder*="Type a name" i]',
    'input[aria-label*="recipient" i]',
    'input[aria-label*="To:" i]',
    '.msg-overlay-bubble-header__search-container input',
    '.msg-overlay-list-bubble-header-v2__search-typeahead input',
    '.msg-search-form input',
    'input[placeholder*="Search" i]',
    'input[aria-label*="Search" i]',
  ] : [
    '.msg-search-form input',
    '.msg-overlay-list-bubble-header-v2__search-typeahead input',
    '.msg-overlay-bubble-header__search-container input',
    'input[placeholder*="Search messages" i]',
    'input[placeholder*="Search" i]',
    'input[aria-label*="Search messages" i]',
    'input[aria-label*="Search" i]',
  ];

  let searchBox = null;
  for (const selector of searchSelectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count().catch(() => 0))) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    searchBox = locator;
    break;
  }

  if (!searchBox) {
    console.log('[LinkedIn] No messaging search box found.');
    return false;
  }

  await searchBox.click({ timeout: 5000 }).catch(() => {});
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+a`).catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await searchBox.fill(q).catch(async () => {
    await page.keyboard.insertText(q).catch(() => page.keyboard.type(q, { delay: 20 }));
  });
  await minimalDelay(compose ? 2200 : 1600);

  if (!(await selectLinkedInMessagingResult(page, q))) {
    console.log(`[LinkedIn] Could not select "${q}" in messaging search.`);
    return false;
  }

  const composer = await waitForLinkedInMessageComposer(page, 12000);
  if (!composer) return false;

  console.log(`[LinkedIn] Chat opened via ${compose ? 'new message compose' : 'messaging search'}`);
  return { success: true, selectedMatch: q, openedVia: compose ? 'compose' : 'messaging' };
}

// Open LinkedIn messaging composer: try profile page "Message" button FIRST (works for all relationship levels),
// then fall back to the messaging search for existing 1st-degree contacts.
async function openLinkedInChat(page, searchName, options = {}) {
  const q = normalizeLinkedInTarget(searchName);
  if (!q) return false;
  const mode = options.mode || 'auto';
  console.log(`[LinkedIn] Opening chat with "${q}"...`);

  // Strategy 1: Navigate to profile page and click the "Message" button.
  // This works for 1st-degree connections (opens inline composer) and for
  // 2nd-degree / Premium InMail (opens overlay/flyout composer).
  const profileUrl = `https://www.linkedin.com/in/${q}/`;
  await navigate(page, profileUrl, 'linkedin');
  await waitForAppShell(page, 'linkedin');
  await minimalDelay(1500);
  const profileName = await page
    .locator('main h1, h1.text-heading-xlarge, h1.inline')
    .first()
    .innerText({ timeout: 4000 })
    .then((text) => text.replace(/\s+/g, ' ').trim())
    .catch(() => '');

  const messageClicked = await clickLinkedInMessageButtonFromProfile(page, profileName, q);

  if (messageClicked) {
    // The Message button is an <a> link that navigates to /messaging/compose/...
    // via LinkedIn's SPA routing. Wait for navigation to complete.
    console.log('[LinkedIn] Message button clicked, waiting for compose page to load...');
    await minimalDelay(4000);

    // After SPA navigation, wait for the messaging app shell to load
    await waitForAppShell(page, 'linkedin').catch(() => {});
    await minimalDelay(2000);

    // Some connected profiles open a "New message" recipient picker first.
    // Select the profile from suggestions before waiting for the message body.
    const selectedRecipient =
      (profileName && await selectLinkedInMessagingResult(page, profileName)) ||
      await selectLinkedInMessagingResult(page, q);
    if (selectedRecipient) {
      console.log('[LinkedIn] Selected recipient from profile Message picker');
      return { success: true, selectedMatch: profileName || q, openedVia: 'profile-picker' };
    }

    if (await waitForLinkedInMessageComposer(page, 9000)) {
      console.log('[LinkedIn] Chat opened via profile page Message button');
      return { success: true, selectedMatch: q, openedVia: 'profile' };
    }

    // Check via page text as well
    const currentContent = await extractPageContent(page);
    if (
      currentContent.fullText.includes('Press Enter to Send') ||
      /write a message|type your message/i.test(currentContent.fullText)
    ) {
      const composer = await waitForLinkedInMessageComposer(page, 8000);
      if (composer) {
        console.log('[LinkedIn] Chat detected via profile message text');
        return { success: true, selectedMatch: q, openedVia: 'profile' };
      }
    }

    // Some LinkedIn versions open a flyout/overlay — wait a bit more
    await minimalDelay(3000);
    if (await waitForLinkedInMessageComposer(page, 7000)) {
      console.log('[LinkedIn] Chat opened via profile page (after delay for overlay)');
      return { success: true, selectedMatch: q, openedVia: 'profile' };
    }

    // If composer still not found, check for a messaging flyout window
    const flyoutVisible = await page
      .locator('.msg-overlay-list-bubble, .msg-conversations-container, [data-test-msg-overlay]')
      .first()
      .isVisible()
      .catch(() => false);

    if (flyoutVisible) {
      const composer = await waitForLinkedInMessageComposer(page, 9000);
      if (composer) {
        console.log('[LinkedIn] Messaging flyout detected from profile page');
        return { success: true, selectedMatch: q, openedVia: 'profile' };
      }
    }

    // Last attempt: check if we navigated to the messaging/compose page explicitly
    const currentUrl = page.url();
    if (currentUrl.includes('/messaging/compose/') || currentUrl.includes('/messaging/')) {
      console.log('[LinkedIn] Navigated to messaging page, looking for composer there...');
      await minimalDelay(2000);

      if (await waitForLinkedInMessageComposer(page, 8000)) {
        console.log('[LinkedIn] Composer found on messaging page');
        return { success: true, selectedMatch: q, openedVia: 'profile' };
      }
    }
  }

  // Strategy 2: Fall back to messaging search for existing contacts
  console.log(`[LinkedIn] Profile Message button approach didn't work for "${q}". Trying messaging fallback...`);
  if (mode === 'contact') {
    const existingFallback = await openLinkedInConversationFromMessaging(page, q, { compose: false });
    if (existingFallback) return existingFallback;
  } else {
    const composeFallback = await openLinkedInConversationFromMessaging(page, q, { compose: true });
    if (composeFallback) return composeFallback;

    const existingFallback = await openLinkedInConversationFromMessaging(page, q, { compose: false });
    if (existingFallback) return existingFallback;
  }

  console.log(`[LinkedIn] Could not find a usable message composer for "${q}".`);
  return false;
}

// Extract basic context from current page
async function getBasicContext(page) {
  const content = await extractPageContent(page);
  const profile = parseProfileFromContent(content, 'linkedin');

  let nameFromDom = profile.name;
  if (!nameFromDom) {
    nameFromDom = await page
      .locator('h1.text-heading-xlarge, h1.inline.t-24, main h1.break-words')
      .first()
      .innerText()
      .catch(() => '');
    nameFromDom = nameFromDom?.trim() || '';
  }

  return {
    name: nameFromDom || profile.name,
    headline: profile.headline,
    jobTitle: profile.jobTitle,
    company: profile.company,
    bio: profile.bio,
    rawText: content.fullText?.slice(0, 800) || '',
  };
}

// Send a LinkedIn message (msg-form composer; Send button when Enter-to-send is off)
async function sendLinkedInMessage(page, message, options = {}) {
  const { attachmentPath, requireManualReview } = options;

  await fillLinkedInMessageComposer(page, message, { messageGoal: options.messageGoal });

  if (attachmentPath) {
    try {
      const attachBtn = await findElementsByText(page, 'Attach', {
        tagNames: ['button', 'svg'],
        fuzzy: true,
      });

      if (attachBtn.length > 0) {
        await page.evaluate((idx) => {
          document.querySelectorAll('button, svg')[idx]?.click();
        }, attachBtn[0].index);

        await minimalDelay(500);

        const fileInput = await page.locator('input[type="file"]').first();
        if (fileInput) {
          await fileInput.setInputFiles(attachmentPath);
          await minimalDelay(1500);
        }
      }
    } catch (e) {
      console.warn('[LinkedIn] Attachment failed:', e.message);
    }
  }

  if (!requireManualReview) {
    await sendLinkedInComposer(page);
    return { sent: true };
  }

  return { sent: false, waitingForReview: true };
}

// Main handler
export const linkedinHandler = {
  platform: 'linkedin',
  
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;
    
    // Check login state
    if (['send_message', 'draft_message', 'open_target', 'message_batch'].includes(action)) {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.linkedin, { platform: 'linkedin' });
      const state = await checkLoginState(page, 'linkedin');
      if (!state.ready) {
        throw new Error(state.message || 'Please log in to LinkedIn');
      }
    }
    
    const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.linkedin, { platform: 'linkedin' });
    
    // ACTION: Send message - SIMPLIFIED FLOW
    if (action === 'send_message') {
      const { username, messageGoal, tone, query, requireManualReview, attachmentPath, operation } = args;
      const normalizedUsername = normalizeLinkedInTarget(username);
      const autoSendOperation = ['auto_dm', 'auto_dm_contact', 'auto_dm_new'].includes(operation);
      
      console.log(`[LinkedIn] Starting DM to "${normalizedUsername}"`);
      
      // Step 1: Open chat via messaging
      const mode = operation === 'auto_dm_contact' ? 'contact' : operation === 'auto_dm_new' ? 'new' : 'auto';
      const chatOpened = await openLinkedInChat(page, normalizedUsername, { mode });
      
      if (!chatOpened) {
        throw new Error(`Could not open a LinkedIn message composer for "${normalizedUsername}". You may need to connect with them first or they may not accept messages.`);
      }
      
      console.log(`[LinkedIn] Chat opened with: ${chatOpened.selectedMatch.slice(0, 60)}`);
      
      // Step 2: Get basic context from the page
      const context = await getBasicContext(page);
      console.log(`[LinkedIn] Context: ${context.name || username}, ${context.headline?.slice(0, 50) || 'no headline'}`);
      
      // Step 3: Extract any existing chat history
      const chatHistory = await extractChatContext(page, 'linkedin', 6);
      
      // Step 4: Generate message
      const message = await generateOutreachMessage({
        username: normalizedUsername,
        goal: messageGoal,
        tone,
        query,
        platform: 'linkedin',
        chatContext: chatHistory,
        profileInfo: context
      });
      
      console.log(`[LinkedIn] Generated: "${message.slice(0, 50)}..."`);
      
      // Step 5: Send
      const result = await sendLinkedInMessage(page, message, {
        attachmentPath,
        requireManualReview: autoSendOperation ? false : requireManualReview,
        messageGoal
      });
      
      return {
        status: 'completed',
        summary: summarizeAction('linkedin', step, { sent: result.sent }),
        data: {
          message,
          sent: result.sent,
          recipient: chatOpened.selectedMatch,
          profile: context
        }
      };
    }
    
    // ACTION: Draft message
    if (action === 'draft_message') {
      const { username, messageGoal, tone, query } = args;
      
      // Just generate the message without navigating
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'linkedin',
        chatContext: [],
        profileInfo: {}
      });
      
      return {
        status: 'ready',
        summary: summarizeAction('linkedin', step),
        data: { preview: message }
      };
    }
    
    // ACTION: Open target — profile URL for DMs, connect, follow, engage, etc. (not Messaging; send_message opens Messaging itself.)
    if (action === 'open_target') {
      const { username } = args;
      const url = buildPlatformTargetUrl('linkedin', username);
      await navigate(page, url, 'linkedin');
      await waitForAppShell(page, 'linkedin');

      return {
        status: 'ready',
        summary: summarizeAction('linkedin', step),
        data: await pageSnapshot(page),
      };
    }
    
    // ACTION: Message batch
    if (action === 'message_batch') {
      const usernames = (args.usernames || []).slice(0, 10);
      const results = [];
      
      for (const username of usernames) {
        try {
          const result = await this.execute({
            step: {
              action: 'send_message',
              platform: 'linkedin',
              args: { ...args, username }
            },
            attachedBrowser
          });
          results.push({ username, ...result });
          await minimalDelay(3000 + Math.random() * 2000);
        } catch (error) {
          results.push({ username, error: error.message, status: 'failed' });
        }
      }
      
      return {
        status: 'completed',
        summary: `Messaged ${usernames.length} LinkedIn contacts`,
        data: results
      };
    }
    
    // ACTION: Follow user
    if (action === 'follow_user') {
      const { username } = args;
      console.log(`[LinkedIn] Following ${username}...`);
      
      // Navigate to profile
      await navigate(page, `https://www.linkedin.com/in/${username}/`, 'linkedin');
      await waitForAppShell(page, 'linkedin');
      await minimalDelay(500);
      
      // Find and click Follow button
      const followBtn = await findElementsByText(page, 'Follow', {
        tagNames: ['button'],
        fuzzy: false
      });
      
      if (followBtn.length > 0) {
        await page.evaluate((index) => {
          document.querySelectorAll('button')[index]?.click();
        }, followBtn[0].index);
        await minimalDelay(500);
        
        return {
          status: 'completed',
          summary: `Followed ${username} on LinkedIn`,
          data: { username, action: 'followed' }
        };
      }
      
      throw new Error(`Could not find Follow button for ${username}. You may already be following them.`);
    }
    
    // ACTION: Connect via profile (top Connect or More → Connect) → artdeco invite modal
    if (action === 'connect' || action === 'connect_swn') {
      const { username } = args;
      if (!username) throw new Error('username is required for LinkedIn connect');
      console.log(`[LinkedIn] Connecting (Send without note) with ${username}...`);

      const { inviteAnchor } = await openLinkedInConnectModalFromMoreMenu(page, username);
      await waitForLinkedInInviteModal(page, inviteAnchor ? 65000 : 38000);

      const sendClicked = await clickSendWithoutNote(page);
      if (!sendClicked) {
        throw new Error('Could not find "Send without a note" on the invitation dialog');
      }

      console.log(`[LinkedIn] Successfully sent connection request to ${username}`);

      return {
        status: 'completed',
        summary: `Sent connection request (no note) to ${username}`,
        data: { username, action: 'connected', mode: 'connect_swn' },
      };
    }

    if (action === 'connect_sn') {
      const { username, messageGoal, tone, query } = args;
      if (!username) throw new Error('username is required for LinkedIn connect_sn');
      console.log(`[LinkedIn] Connecting with note (connect_sn) to ${username}...`);

      const { inviteAnchor } = await openLinkedInConnectModalFromMoreMenu(page, username);
      await waitForLinkedInInviteModal(page, inviteAnchor ? 65000 : 38000);

      const context = await getBasicContext(page);
      const note = await generateOutreachMessage({
        username,
        goal: messageGoal || 'connect professionally',
        tone,
        query,
        platform: 'linkedin',
        chatContext: [],
        profileInfo: context,
      });
      const truncatedNote = note.slice(0, 300);

      await completeLinkedInInviteWithNote(page, truncatedNote);

      return {
        status: 'completed',
        summary: `Sent connection request with note to ${username}`,
        data: { username, action: 'connected', mode: 'connect_sn', withNote: true, note: truncatedNote },
      };
    }

    // ACTION: Connect user (without note) — legacy path for bulk flows; uses profile Connect + invite modal when shown
    if (action === 'connect_user') {
      const { username } = args;
      console.log(`[LinkedIn] Connecting with ${username}...`);

      await navigate(page, `https://www.linkedin.com/in/${username}/`, 'linkedin');
      await waitForAppShell(page, 'linkedin');
      await minimalDelay(600);

      let clicked = await tryClickPrimaryProfileConnect(page);
      if (!clicked) {
        const connectBtn = await findElementsByText(page, 'Connect', {
          tagNames: ['button', 'a'],
          fuzzy: false,
        });
        if (connectBtn.length > 0) {
          await page.evaluate((index) => {
            document.querySelectorAll('button, a')[index]?.click();
          }, connectBtn[0].index);
          clicked = true;
        }
      }

      if (!clicked) {
        throw new Error(`Could not find Connect button for ${username}. You may already be connected.`);
      }

      await minimalDelay(900);
      let modalShown = true;
      try {
        await waitForLinkedInInviteModal(page, 14000);
      } catch {
        modalShown = false;
      }
      if (modalShown) {
        const sent = await clickSendWithoutNote(page);
        if (!sent) {
          throw new Error('Could not confirm Send without a note on invite modal');
        }
      }

      await minimalDelay(400);

      return {
        status: 'completed',
        summary: `Sent connection request to ${username}`,
        data: { username, action: 'connected', withNote: false },
      };
    }

    // ACTION: Connect with note — same invite flow as connect_sn (shared helpers), for legacy / bulk callers
    if (action === 'connect_with_note') {
      const { username, messageGoal, tone, query } = args;
      if (!username) throw new Error('username is required for connect_with_note');
      console.log(`[LinkedIn] Connecting with ${username} + note...`);

      const { inviteAnchor } = await openLinkedInConnectModalFromMoreMenu(page, username);
      await waitForLinkedInInviteModal(page, inviteAnchor ? 65000 : 38000);

      const context = await getBasicContext(page);
      const note = await generateOutreachMessage({
        username,
        goal: messageGoal || 'connect professionally',
        tone,
        query,
        platform: 'linkedin',
        chatContext: [],
        profileInfo: context,
      });
      const truncatedNote = note.slice(0, 300);

      await completeLinkedInInviteWithNote(page, truncatedNote);

      return {
        status: 'completed',
        summary: `Sent connection request with note to ${username}`,
        data: { username, action: 'connected', withNote: true, note: truncatedNote },
      };
    }
    
    // ACTION: Bulk connect from search results
    if (action === 'bulk_connect_search') {
      const { searchQuery, maxResults = 10, withNote = false, messageGoal, tone } = args;
      console.log(`[LinkedIn] Bulk connecting from search: "${searchQuery}"`);
      
      // Navigate to search
      await navigate(page, `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchQuery)}`, 'linkedin');
      await waitForAppShell(page, 'linkedin');
      await minimalDelay(1500);
      
      // Extract profiles with Connect buttons
      const profiles = await page.evaluate((limit) => {
        const results = [];
        const cards = document.querySelectorAll(
          '.reusable-search__result-container, .search-result, [data-testid="search-result"], li.reusable-search__result-container',
        );

        function findConnectButton(card) {
          const buttons = [...card.querySelectorAll('button')];
          return buttons.find((b) => {
            const t = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
            const a = (b.getAttribute('aria-label') || '').trim();
            if (/pending|following|message|withdraw/i.test(`${a} ${t}`)) return false;
            return t === 'Connect' || /\bconnect\b/i.test(a);
          });
        }

        for (let i = 0; i < Math.min(cards.length, limit); i++) {
          const card = cards[i];
          const nameEl = card.querySelector('a[href*="/in/"], .entity-result__title-text a');
          const connectBtn = findConnectButton(card);

          if (nameEl && connectBtn) {
            const href = nameEl.getAttribute('href');
            const username = href?.match(/\/in\/([^/?]+)/)?.[1];
            if (username) {
              results.push({ username, name: nameEl.textContent?.trim() });
            }
          }
        }
        return results;
      }, maxResults);
      
      console.log(`[LinkedIn] Found ${profiles.length} connectable profiles`);
      
      const results = [];
      for (const profile of profiles) {
        try {
          if (withNote) {
            const result = await this.execute({
              step: {
                action: 'connect_with_note',
                platform: 'linkedin',
                args: { username: profile.username, messageGoal, tone }
              },
              attachedBrowser
            });
            results.push({ username: profile.username, ...result });
          } else {
            const result = await this.execute({
              step: {
                action: 'connect_user',
                platform: 'linkedin',
                args: { username: profile.username }
              },
              attachedBrowser
            });
            results.push({ username: profile.username, ...result });
          }
          await minimalDelay(2000 + Math.random() * 1000);
        } catch (error) {
          results.push({ username: profile.username, error: error.message, status: 'failed' });
        }
      }
      
      return {
        status: 'completed',
        summary: `Bulk connected ${results.filter(r => r.status === 'completed').length}/${profiles.length} people from search`,
        data: { results, searchQuery }
      };
    }
    
    // ACTION: Bulk connect from My Network / People You May Know
    if (action === 'bulk_connect_network') {
      const { maxResults = 10, withNote = false, messageGoal, tone } = args;
      console.log(`[LinkedIn] Bulk connecting from My Network...`);
      
      // Navigate to My Network
      await navigate(page, 'https://www.linkedin.com/mynetwork/', 'linkedin');
      await waitForAppShell(page, 'linkedin');
      await minimalDelay(1500);
      
      // Extract "People you may know" with Connect buttons
      const profiles = await page.evaluate((limit) => {
        const results = [];
        const cards = document.querySelectorAll(
          '.mn-connection-card, .discover-entity-card, .artdeco-card .ember-view, [data-testid="people-you-may-know"] .artdeco-card, .discover-person-card',
        );

        function findConnectButton(card) {
          const buttons = [...card.querySelectorAll('button')];
          return buttons.find((b) => {
            const t = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
            const a = (b.getAttribute('aria-label') || '').trim();
            if (/pending|following|message|withdraw/i.test(`${a} ${t}`)) return false;
            return t === 'Connect' || /\bconnect\b/i.test(a);
          });
        }

        for (let i = 0; i < Math.min(cards.length, limit); i++) {
          const card = cards[i];
          const nameEl =
            card.querySelector('a[href*="/in/"]') ||
            card.querySelector('.discover-person-card__name a') ||
            card.querySelector('.mn-connection-card__name a');
          const connectBtn = findConnectButton(card);

          if (nameEl && connectBtn) {
            const href = nameEl.closest('a')?.getAttribute('href') || nameEl.getAttribute('href');
            const username =
              href?.match(/\/in\/([^/?]+)/)?.[1] ||
              nameEl.textContent?.trim()?.toLowerCase()?.replace(/\s+/g, '-');
            if (username) {
              results.push({ username, name: nameEl.textContent?.trim() });
            }
          }
        }
        return results;
      }, maxResults);
      
      console.log(`[LinkedIn] Found ${profiles.length} people in My Network to connect with`);
      
      const results = [];
      for (const profile of profiles) {
        try {
          if (withNote) {
            const result = await this.execute({
              step: {
                action: 'connect_with_note',
                platform: 'linkedin',
                args: { username: profile.username, messageGoal, tone }
              },
              attachedBrowser
            });
            results.push({ username: profile.username, ...result });
          } else {
            const result = await this.execute({
              step: {
                action: 'connect_user',
                platform: 'linkedin',
                args: { username: profile.username }
              },
              attachedBrowser
            });
            results.push({ username: profile.username, ...result });
          }
          await minimalDelay(2000 + Math.random() * 1000);
        } catch (error) {
          results.push({ username: profile.username, error: error.message, status: 'failed' });
        }
      }
      
      return {
        status: 'completed',
        summary: `Bulk connected ${results.filter(r => r.status === 'completed').length}/${profiles.length} from My Network`,
        data: { results }
      };
    }
    
    // Delegate other actions to base handler
    const baseHandler = createSocialHandler('linkedin', {
      async openLatestPost(page) {
        await openLatestLinkedInPost(page);
      },
      async likePost(page) {
        await likeLinkedInCurrentPost(page);
      },
      async prepareComment(page) {
        const ready = await openLinkedInCommentComposerForCurrentPost(page);
        if (!ready) {
          throw new Error('LinkedIn comment composer was not opened');
        }
      },
      commentSelectors: [
        '.comments-comment-box__form-container div[contenteditable="true"]:visible',
        '.comments-comment-box div[contenteditable="true"]:visible',
        '.comments-comment-texteditor div[contenteditable="true"]:visible',
        '[aria-label*="Add a comment" i][contenteditable="true"]:visible',
        '[data-placeholder*="Add a comment" i][contenteditable="true"]:visible',
        '.ql-editor[contenteditable="true"]:visible',
      ],
      sendComment: sendLinkedInComment,
      commentSubmitSelectors: [
        'button[aria-label="Post"]',
        'button[aria-label="Send"]',
        'button[aria-label*="Comment" i]',
        'button:has-text("Comment")',
      ],
      commentSubmitLabels: ['Comment', 'Post', 'Send'],
    });
    return baseHandler.execute({ step, attachedBrowser });
  }
};
