import {
  PLATFORM_URLS,
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
import { extractPageContent, findElementsByText, parseProfileFromContent, detectRelationshipStatus } from '../page-extractor.js';
import { createSocialHandler } from '../social-base.js';

/**
 * Instagram Handler - Smart UI-based automation
 * Uses full page extraction + intelligent parsing (resilient to UI changes)
 */

const INSTAGRAM_NAVIGATION_ACTIONS = {
  'connect_instagram_account': 'https://www.instagram.com/',
  'refresh_permissions': 'https://www.instagram.com/accounts/edit/',
  'sync_profile': 'https://www.instagram.com/',
  'view_account_status': 'https://www.instagram.com/accounts/status/',
  'open_profile': 'https://www.instagram.com/',
  'edit_profile': 'https://www.instagram.com/accounts/edit/',
  'change_profile_photo': 'https://www.instagram.com/accounts/edit/',
  'open_settings': 'https://www.instagram.com/accounts/edit/',
  'open_more_menu': 'https://www.instagram.com/',
  'open_activity': 'https://www.instagram.com/your_activity/',
  'open_saved': 'https://www.instagram.com/saved/',
  'open_search_results': 'https://www.instagram.com/explore/search/keyword/',
  'open_notifications': 'https://www.instagram.com/accounts/activity/',
  'open_explore': 'https://www.instagram.com/explore/',
  'open_reels': 'https://www.instagram.com/reels/',
  'view_suggestions': 'https://www.instagram.com/explore/people/',
  'view_feed_posts': 'https://www.instagram.com/',
  'switch_professional_account': 'https://www.instagram.com/accounts/account_type_and_tools/',
  'switch_normal_account': 'https://www.instagram.com/accounts/account_type_and_tools/',
  'open_professional_dashboard': 'https://www.instagram.com/professional_dashboard/',
  'sync_insights': 'https://www.instagram.com/professional_dashboard/',
  'view_report': 'https://www.instagram.com/professional_dashboard/',
  'export_report': 'https://www.instagram.com/professional_dashboard/',
  'open_ad_account': 'https://www.instagram.com/professional_dashboard/',
  'open_content_tools': 'https://www.instagram.com/professional_dashboard/',
  'open_ad_tools': 'https://www.instagram.com/professional_dashboard/',
  'open_professional_settings': 'https://www.instagram.com/accounts/account_type_and_tools/',
  'create_ad': 'https://www.instagram.com/professional_dashboard/',
  'track_post_performance': 'https://www.instagram.com/professional_dashboard/',
  'track_reel_performance': 'https://www.instagram.com/professional_dashboard/',
  'track_story_performance': 'https://www.instagram.com/professional_dashboard/',
  'open_inbox': 'https://www.instagram.com/direct/inbox/',
  'open_messages_list': 'https://www.instagram.com/direct/inbox/',
  'open_requested_messages': 'https://www.instagram.com/direct/requests/',
  'open_primary_messages': 'https://www.instagram.com/direct/inbox/',
  'open_general_messages': 'https://www.instagram.com/direct/inbox/',
  'create_media_publish_flow': 'https://www.instagram.com/create/select/',
  'create_post_draft': 'https://www.instagram.com/create/select/',
  'upload_media': 'https://www.instagram.com/create/select/',
  'create_reel': 'https://www.instagram.com/create/select/',
  'create_story': 'https://www.instagram.com/create/select/',
  'start_live': 'https://www.instagram.com/create/select/',
  'create_live_video': 'https://www.instagram.com/create/select/',
  'open_ai_create': 'https://www.instagram.com/create/select/',
  'view_stories': 'https://www.instagram.com/',
  'open_user_posts': 'https://www.instagram.com/',
  'open_user_videos': 'https://www.instagram.com/reels/',
};

const INSTAGRAM_UNSUPPORTED_ACTIONS = new Set([
  'change_bio',
  'switch_appearance',
  'report_problem',
  'switch_accounts',
  'logout',
  'write_caption',
  'add_hashtags',
  'add_location',
  'tag_users',
  'save_draft',
  'schedule_post',
  'publish_now',
  'delete_post',
  'archive_post',
  'pin_post',
  'publish_reel',
  'delete_reel',
  'publish_story',
  'delete_story',
  'add_story_highlight',
  'reply_to_story',
  'comment_on_story',
  'reply_to_post_comment',
  'open_user_videos',
  'repost_post',
  'use_saved_reply',
  'accept_message_request',
  'delete_message_request',
  'blur_message_request',
  'move_request_primary',
  'move_request_general',
  'move_request_channel',
  'assign_conversation_to_human',
  'mark_conversation_resolved',
  'reply_to_comment',
  'hide_comment',
  'unhide_comment',
  'delete_comment',
  'disable_comments',
  'enable_comments',
  'send_private_reply',
  'hide_spam_comment',
  'flag_negative_comment',
  'escalate_issue',
  'block_user',
  'restrict_user',
  'report_user',
  'remove_follower',
  'create_live_video',
  'qualify_lead',
  'score_lead',
  'save_lead',
  'push_lead_to_crm',
  'add_lead_to_spreadsheet',
  'create_follow_up',
  'create_automation_rule',
  'enable_rule',
  'pause_rule',
  'run_workflow',
  'approve_action',
  'reject_action',
  'view_action_log',
]);

function unsupportedInstagramAction(action) {
  return {
    status: 'failed',
    summary: `Instagram action "${action}" is not supported yet`,
    data: {
      platform: 'instagram',
      action,
      unsupported: true,
      message: `Instagram action "${action}" is not supported yet`,
    },
  };
}

async function extractVisibleInstagramComments(page, maxResults = 25) {
  const comments = await page.evaluate((limit) => {
    const nodes = Array.from(document.querySelectorAll('article span, ul span, div[role="dialog"] span'));
    const ignored = new Set(['Reply', 'See translation', 'View replies', 'Like', 'More']);
    const values = [];
    for (const node of nodes) {
      const text = (node.innerText || node.textContent || '').trim();
      if (!text || ignored.has(text) || text.length < 2 || text.length > 500) continue;
      if (!values.includes(text)) values.push(text);
      if (values.length >= limit) break;
    }
    return values;
  }, maxResults);
  return comments.map((text, index) => ({ id: `comment_${index + 1}`, text }));
}

function classifySpamComments(comments) {
  const spamPattern = /\b(dm\s+me|crypto|forex|investment|giveaway|free\s+followers|promo|http|www\.|telegram|whatsapp)\b/i;
  return comments.map((comment) => ({
    ...comment,
    spam: spamPattern.test(comment.text),
  }));
}

function inferAccountType(text) {
  const normalized = text.toLowerCase();
  if (/"is_professional_account"\s*:\s*true/.test(normalized)
    || /\bis_professional_account\\?":\s*true/.test(normalized)
    || /\b(professional dashboard|ad tools|ad account|insights|professional account|content tools)\b/.test(normalized)) {
    return 'professional';
  }
  if (/"is_professional_account"\s*:\s*false/.test(normalized)
    || /\bis_professional_account\\?":\s*false/.test(normalized)
    || /\b(switch to professional|account type and tools|creator|business)\b/.test(normalized)) {
    return 'normal';
  }
  return 'unknown';
}

const INSTAGRAM_DESTRUCTIVE_ACTIONS = new Set([
  'delete_post',
  'archive_post',
  'delete_reel',
  'delete_story',
  'disable_comments',
  'delete_comment',
  'hide_comment',
  'hide_spam_comment',
  'block_user',
  'restrict_user',
  'report_user',
  'remove_follower',
  'delete_message_request',
  'logout',
  'publish_now',
  'publish_reel',
  'publish_story',
  'start_live',
  'create_live_video',
  'create_ad',
  'switch_professional_account',
  'switch_normal_account',
]);

async function clickInstagramLabel(page, labels = [], options = {}) {
  const {
    partial = false,
    withinDialog = false,
    preferLeftRail = false,
    timeoutAfterClick = 600,
  } = options;
  const normalizedLabels = labels.filter(Boolean).map((label) => String(label));
  if (!normalizedLabels.length) return null;

  const match = await page.evaluate(({ labels: evalLabels, partial: allowPartial, withinDialog: dialogOnly, preferLeftRail: leftRail }) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const wanted = evalLabels.map(normalize);
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const elementLabel = (element) => {
      const aria = element.getAttribute('aria-label');
      const placeholder = element.getAttribute('placeholder');
      const title = element.getAttribute('title');
      const text = element.innerText || element.textContent || '';
      return [aria, placeholder, title, text].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    };
    const clickableFor = (element) => {
      if (element.matches('button,a,[role="button"],[role="link"],[role="menuitem"],input,textarea')) return element;
      return element.closest('button,a,[role="button"],[role="link"],[role="menuitem"]') || element;
    };
    const root = dialogOnly ? document.querySelector('div[role="dialog"]') : document;
    if (!root) return null;
    const candidates = Array.from(root.querySelectorAll('button,a,[role="button"],[role="link"],[role="menuitem"],input,textarea,svg[aria-label]'));
    const scored = [];

    for (const element of candidates) {
      const clickable = clickableFor(element);
      if (!clickable || !isVisible(clickable)) continue;
      const rect = clickable.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      if (leftRail && rect.left > 430) continue;

      const label = normalize(elementLabel(element) || elementLabel(clickable));
      if (!label) continue;

      for (let index = 0; index < wanted.length; index += 1) {
        const target = wanted[index];
        if (!target) continue;
        const exact = label === target;
        const textExact = normalize(clickable.innerText || clickable.textContent || '') === target;
        const contains = allowPartial && label.includes(target);
        if (!exact && !textExact && !contains) continue;

        const score = (exact || textExact ? 100 : 20) - index - Math.min(20, Math.round(rect.left / 100));
        scored.push({
          score,
          label,
          requested: evalLabels[index],
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored[0] || null;
  }, { labels: normalizedLabels, partial, withinDialog, preferLeftRail });

  if (!match) return null;
  await page.mouse.click(match.x, match.y).catch(() => {});
  await minimalDelay(timeoutAfterClick);
  return match;
}

async function clickInstagramAny(page, selectors = [], labels = [], options = {}) {
  const clickedBySelector = await tryClick(page, selectors);
  if (clickedBySelector) {
    await minimalDelay(options.timeoutAfterClick || 600);
    return { via: 'selector' };
  }
  const clickedByText = await clickInstagramLabel(page, labels, options);
  if (clickedByText) return { via: 'label', ...clickedByText };
  return null;
}

async function openInstagramMoreMenu(page) {
  return clickInstagramAny(page, [
    'svg[aria-label="Settings"]',
    'svg[aria-label="More"]',
    'div[role="button"]:has-text("More")',
    'button:has-text("More")',
  ], ['More', 'Settings'], { preferLeftRail: true, timeoutAfterClick: 800 });
}

async function openInstagramCreateMenu(page) {
  return clickInstagramAny(page, [
    'svg[aria-label="New post"]',
    'svg[aria-label="Create"]',
    'a[href="/create/select/"]',
    'div[role="button"]:has-text("Create")',
  ], ['New post', 'Create'], { preferLeftRail: true, timeoutAfterClick: 900 });
}

async function openInstagramInbox(page) {
  const clicked = await clickInstagramAny(page, [
    'a[href="/direct/inbox/"]',
    'a[href*="/direct/inbox"]',
    'svg[aria-label="Messages"]',
  ], ['Messages'], { preferLeftRail: true, timeoutAfterClick: 1000 });
  if (clicked) return clicked;
  await navigate(page, 'https://www.instagram.com/direct/inbox/', 'instagram');
  await waitForAppShell(page, 'instagram');
  return { via: 'fallback-url', target: 'inbox' };
}

async function openInstagramSettings(page) {
  const settingsDirect = await clickInstagramLabel(page, ['Settings'], { partial: false, timeoutAfterClick: 900 });
  if (settingsDirect) return settingsDirect;
  await openInstagramMoreMenu(page);
  return clickInstagramLabel(page, ['Settings', 'Settings and activity'], { partial: false, timeoutAfterClick: 900 });
}

async function openInstagramProfileUi(page, args = {}) {
  const username = args.username || args.handle;
  if (username) {
    await navigateToProfileViaSearch(page, username);
    return { via: 'search', username };
  }
  const clicked = await clickInstagramAny(page, [
    'a[href^="/"][href$="/"]:has(img[alt*="profile picture"])',
    'a[role="link"]:has-text("Profile")',
    'svg[aria-label="Profile"]',
  ], ['Profile'], { preferLeftRail: true, timeoutAfterClick: 1000 });
  if (clicked) return clicked;
  await navigate(page, 'https://www.instagram.com/', 'instagram');
  await waitForAppShell(page, 'instagram');
  return { via: 'fallback-home' };
}

async function openInstagramSearchUi(page, query) {
  const clicked = await clickInstagramAny(page, [
    'svg[aria-label="Search"]',
    'input[placeholder*="Search"]',
    'a[href*="/explore/search"]',
  ], ['Search'], { preferLeftRail: true, timeoutAfterClick: 600 });
  if (query) {
    await fillEditable(page, [
      'input[placeholder*="Search"]',
      'input[aria-label*="Search"]',
      'input[aria-label="Search input"]',
      'div[contenteditable="true"][role="textbox"]',
    ], query, { humanLike: true, typingSpeed: 'normal' }).catch(() => {});
    await minimalDelay(900);
  }
  return clicked || { via: 'search-open-attempt' };
}

async function openInstagramAccountTypeTools(page) {
  await openInstagramSettings(page).catch(() => null);
  const clicked = await clickInstagramLabel(page, [
    'Account type and tools',
    'Creator tools and controls',
    'Business tools and controls',
    'Professional account',
  ], { partial: true, timeoutAfterClick: 900 });
  if (clicked) return clicked;
  await navigate(page, 'https://www.instagram.com/accounts/account_type_and_tools/', 'instagram');
  await waitForAppShell(page, 'instagram');
  return { via: 'fallback-url', target: 'account_type_and_tools' };
}

async function openInstagramProfessionalDashboard(page, targetLabels = []) {
  const direct = await clickInstagramLabel(page, ['Professional dashboard'], { partial: true, timeoutAfterClick: 1000 });
  if (!direct) {
    await openInstagramProfileUi(page).catch(() => null);
    await clickInstagramLabel(page, ['Professional dashboard'], { partial: true, timeoutAfterClick: 1000 }).catch(() => null);
  }
  if (targetLabels.length) {
    await clickInstagramLabel(page, targetLabels, { partial: true, timeoutAfterClick: 900 }).catch(() => null);
  }
  const content = await extractPageContent(page).catch(() => ({ fullText: '' }));
  if (!/professional dashboard|insights|ad tools|content|ad account/i.test(content.fullText || '')) {
    await navigate(page, 'https://www.instagram.com/professional_dashboard/', 'instagram');
    await waitForAppShell(page, 'instagram');
    if (targetLabels.length) {
      await clickInstagramLabel(page, targetLabels, { partial: true, timeoutAfterClick: 900 }).catch(() => null);
    }
    return { via: 'fallback-url', target: targetLabels[0] || 'Professional dashboard' };
  }
  return { via: 'ui', target: targetLabels[0] || 'Professional dashboard' };
}

async function uploadInstagramMediaIfProvided(page, args = {}) {
  const attachmentPath = args.attachmentPath || args.filePath || args.mediaPath;
  if (!attachmentPath) return false;
  const input = await page.locator('input[type="file"]').first();
  if (await input.count() > 0) {
    await input.setInputFiles(attachmentPath);
    await minimalDelay(1500);
    return true;
  }
  return false;
}

async function openInstagramPostOptions(page, targetLabels = [], args = {}) {
  const opened = await clickInstagramAny(page, [
    'svg[aria-label="More options"]',
    'svg[aria-label="Options"]',
    'button[aria-label*="options" i]',
    'div[role="button"][aria-label*="options" i]',
  ], ['More options', 'Options'], { timeoutAfterClick: 700 });
  if (!opened) return null;
  if (args.requireManualReview) return { via: 'ui', waitingForReview: true, target: targetLabels[0] };
  if (targetLabels.length) {
    return clickInstagramLabel(page, targetLabels, { partial: true, timeoutAfterClick: 800 });
  }
  return opened;
}

async function clickInstagramDialogConfirmation(page, labels = ['Done', 'Save', 'Confirm', 'OK', 'Apply']) {
  return clickInstagramLabel(page, labels, {
    partial: false,
    withinDialog: true,
    timeoutAfterClick: 900,
  });
}

async function setInstagramAppearance(page, desiredAppearance) {
  const target = String(desiredAppearance || '').trim().toLowerCase();
  const targetLabels = target.includes('dark')
    ? ['Dark mode', 'Dark']
    : target.includes('light')
      ? ['Light mode', 'Light']
      : ['Dark mode', 'Switch appearance', 'Appearance'];

  const clickedLabel = await clickInstagramLabel(page, targetLabels, {
    partial: true,
    withinDialog: true,
    timeoutAfterClick: 700,
  }).catch(() => null);
  if (clickedLabel) return { changed: true, method: 'label', target: target || clickedLabel.requested };

  const toggle = await page.evaluate((desired) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const root = document.querySelector('div[role="dialog"]') || document;
    const candidates = Array.from(root.querySelectorAll('[role="switch"], input[type="checkbox"], button, [role="button"]'));
    for (const element of candidates) {
      if (!isVisible(element)) continue;
      const text = normalize([
        element.getAttribute('aria-label'),
        element.getAttribute('aria-checked'),
        element.innerText,
        element.textContent,
      ].filter(Boolean).join(' '));
      if (desired && !text.includes(desired) && !text.includes('dark') && !text.includes('appearance')) continue;
      const rect = element.getBoundingClientRect();
      return {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        label: text.slice(0, 80),
      };
    }
    return null;
  }, target.includes('dark') ? 'dark' : target.includes('light') ? 'light' : '');

  if (!toggle) return { changed: false, method: 'not-found' };
  await page.mouse.click(toggle.x, toggle.y).catch(() => {});
  await minimalDelay(700);
  return { changed: true, method: 'toggle', target: target || toggle.label };
}

async function chooseInstagramSearchResult(page, query) {
  if (!query) return null;
  await minimalDelay(900);
  const selected = await page.evaluate((rawQuery) => {
    const query = String(rawQuery || '').trim().toLowerCase().replace(/^@+/, '');
    if (!query) return null;
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };
    const rows = Array.from(document.querySelectorAll('a, [role="button"], [role="option"], button')).filter(isVisible);
    for (const row of rows) {
      const text = (row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const href = row.getAttribute('href') || '';
      if (!text.includes(query) && !href.toLowerCase().includes(query)) continue;
      const rect = row.getBoundingClientRect();
      return {
        x: Math.round(rect.left + Math.min(rect.width / 2, 120)),
        y: Math.round(rect.top + rect.height / 2),
        text: text.slice(0, 80),
      };
    }
    return null;
  }, query);
  if (!selected) return null;
  await page.mouse.click(selected.x, selected.y).catch(() => {});
  await minimalDelay(900);
  return selected;
}

async function runInstagramUiAction(page, action, args = {}, step = {}) {
  const requireManualReview = Boolean(args.requireManualReview);
  const ready = async (summary, extra = {}) => ({
    status: extra.status || 'ready',
    summary,
    data: {
      action,
      page: await pageSnapshot(page),
      requiresManualReview: requireManualReview || INSTAGRAM_DESTRUCTIVE_ACTIONS.has(action),
      ...extra.data,
    },
  });

  if (action === 'connect_instagram_account' || action === 'sync_profile' || action === 'view_feed_posts') {
    const clicked = await clickInstagramAny(page, ['a[href="/"]', 'svg[aria-label="Home"]'], ['Home'], { preferLeftRail: true, timeoutAfterClick: 900 });
    if (!clicked) await navigateToInstagramHome(page);
    return ready(summarizeAction('instagram', step), { status: 'completed' });
  }

  if (action === 'refresh_permissions' || action === 'open_settings') {
    await openInstagramSettings(page);
    return ready(summarizeAction('instagram', step));
  }

  if (action === 'open_more_menu') {
    await openInstagramMoreMenu(page);
    return ready('Opened Instagram More menu');
  }

  if (action === 'view_account_status') {
    await openInstagramSettings(page);
    await clickInstagramLabel(page, ['Account status'], { partial: true, timeoutAfterClick: 800 }).catch(() => null);
    return ready('Opened Instagram account status', { status: 'completed' });
  }

  if (action === 'open_profile') {
    await openInstagramProfileUi(page, args);
    return ready(args.username ? `Opened Instagram profile @${args.username}` : 'Opened Instagram profile', { status: 'completed' });
  }

  if (action === 'edit_profile' || action === 'change_bio' || action === 'change_profile_photo') {
    await openInstagramProfileUi(page, args);
    await clickInstagramLabel(page, ['Edit profile', 'Edit Profile'], { partial: false, timeoutAfterClick: 900 }).catch(() => null);
    if (action === 'change_bio' && args.bio) {
      await fillEditable(page, ['textarea', 'input[name="biography"]', 'div[contenteditable="true"]'], args.bio, { humanLike: true }).catch(() => null);
      if (!requireManualReview) {
        await clickInstagramDialogConfirmation(page, ['Submit', 'Done', 'Save']).catch(() => null);
        await clickInstagramLabel(page, ['Submit', 'Done', 'Save'], { partial: false, timeoutAfterClick: 900 }).catch(() => null);
      }
    }
    if (action === 'change_profile_photo') {
      await clickInstagramLabel(page, ['Change photo', 'Change profile photo', 'Edit picture or avatar'], { partial: true, timeoutAfterClick: 900 }).catch(() => null);
      await uploadInstagramMediaIfProvided(page, args).catch(() => false);
      if (!requireManualReview) {
        await clickInstagramDialogConfirmation(page, ['Done', 'Save', 'Apply']).catch(() => null);
      }
    }
    return ready(summarizeAction('instagram', step), { status: requireManualReview ? 'ready' : 'completed' });
  }

  if (['open_activity', 'open_saved', 'switch_appearance', 'report_problem', 'switch_accounts', 'logout'].includes(action)) {
    await openInstagramMoreMenu(page);
    const labelsByAction = {
      open_activity: ['Your activity', 'Activity'],
      open_saved: ['Saved'],
      switch_appearance: ['Switch appearance', 'Appearance'],
      report_problem: ['Report a problem'],
      switch_accounts: ['Switch accounts'],
      logout: ['Log out', 'Logout'],
    };
    await clickInstagramLabel(page, labelsByAction[action], { partial: true, timeoutAfterClick: 900 }).catch(() => null);
    if (action === 'switch_appearance') {
      const appearance = await setInstagramAppearance(page, args.appearance || args.mode || args.theme);
      return ready(appearance.changed ? 'Changed Instagram appearance' : 'Opened Instagram appearance control', {
        status: appearance.changed ? 'completed' : 'ready',
        data: { appearance },
      });
    }
    if (action === 'report_problem' && (args.message || args.text || args.description)) {
      await fillEditable(page, ['textarea', 'input', 'div[contenteditable="true"][role="textbox"]'], args.message || args.text || args.description, { humanLike: true }).catch(() => null);
      if (!requireManualReview) {
        await clickInstagramDialogConfirmation(page, ['Send', 'Submit', 'Report']).catch(() => null);
      }
      return ready('Submitted Instagram problem report', { status: requireManualReview ? 'ready' : 'completed' });
    }
    if (action === 'switch_accounts' && args.username) {
      await clickInstagramLabel(page, [args.username, args.username.replace(/^@+/, '')], { partial: true, timeoutAfterClick: 900 }).catch(() => null);
      return ready(`Switched Instagram account to ${args.username}`, { status: 'completed' });
    }
    return ready(action === 'logout' && requireManualReview ? 'Opened Instagram logout control for review' : summarizeAction('instagram', step), {
      status: INSTAGRAM_DESTRUCTIVE_ACTIONS.has(action) && requireManualReview ? 'ready' : 'completed',
    });
  }

  if (action === 'open_search_results') {
    await openInstagramSearchUi(page, args.query || args.search || '');
    await chooseInstagramSearchResult(page, args.select || args.username || args.target || '').catch(() => null);
    return ready(args.query ? `Opened Instagram search for "${args.query}"` : 'Opened Instagram search', { status: 'completed' });
  }

  if (action === 'open_notifications') {
    await clickInstagramAny(page, ['svg[aria-label="Notifications"]'], ['Notifications'], { preferLeftRail: true, timeoutAfterClick: 900 });
    return ready('Opened Instagram notifications', { status: 'completed' });
  }

  if (action === 'open_explore' || action === 'open_reels' || action === 'view_suggestions') {
    const labelsByAction = {
      open_explore: ['Explore'],
      open_reels: ['Reels'],
      view_suggestions: ['See all', 'Suggested for you'],
    };
    const selectorsByAction = {
      open_explore: ['a[href="/explore/"]', 'a[href*="/explore/"]', 'svg[aria-label="Explore"]'],
      open_reels: ['a[href="/reels/"]', 'a[href*="/reels/"]', 'svg[aria-label="Reels"]'],
      view_suggestions: ['a[href="/explore/people/"]', 'a[href*="/explore/people"]'],
    };
    await clickInstagramAny(page, selectorsByAction[action], labelsByAction[action], { preferLeftRail: action !== 'view_suggestions', timeoutAfterClick: 1000 });
    return ready(summarizeAction('instagram', step), { status: 'completed' });
  }

  if (action === 'switch_professional_account' || action === 'switch_normal_account') {
    await openInstagramAccountTypeTools(page);
    const labels = action === 'switch_professional_account'
      ? ['Switch to professional account', 'Switch to professional', 'Professional account']
      : ['Switch to personal account', 'Switch to personal', 'Switch to normal'];
    if (!requireManualReview) {
      await clickInstagramLabel(page, labels, { partial: true, timeoutAfterClick: 900 }).catch(() => null);
    }
    return ready(action === 'switch_professional_account'
      ? 'Opened Instagram professional account conversion flow'
      : 'Opened Instagram personal account conversion flow', {
      status: requireManualReview ? 'ready' : 'completed',
    });
  }

  if ([
    'create_media_publish_flow',
    'create_post_draft',
    'upload_media',
    'create_reel',
    'create_story',
    'start_live',
    'create_live_video',
    'open_ai_create',
    'create_ad',
  ].includes(action)) {
    await openInstagramCreateMenu(page);
    const labelsByAction = {
      create_media_publish_flow: ['Post', 'Reel', 'Story'],
      create_post_draft: ['Post'],
      upload_media: ['Post', 'Select from computer'],
      create_reel: ['Reel', 'Reels'],
      create_story: ['Story'],
      start_live: ['Live video', 'Live'],
      create_live_video: ['Live video', 'Live'],
      open_ai_create: ['AI'],
      create_ad: ['Ad', 'Create ad'],
    };
    await clickInstagramLabel(page, labelsByAction[action], { partial: true, timeoutAfterClick: 900 }).catch(() => null);
    await uploadInstagramMediaIfProvided(page, args).catch(() => false);
    return ready(summarizeAction('instagram', step), {
      status: requireManualReview && INSTAGRAM_DESTRUCTIVE_ACTIONS.has(action) ? 'ready' : 'completed',
    });
  }

  if (['write_caption', 'add_hashtags', 'add_location', 'tag_users', 'save_draft', 'schedule_post', 'publish_now', 'publish_reel', 'publish_story'].includes(action)) {
    const textByAction = {
      write_caption: args.caption || args.text || '',
      add_hashtags: args.hashtags || args.text || '',
      add_location: args.location || '',
      tag_users: Array.isArray(args.users) ? args.users.join(' ') : (args.username || args.users || ''),
    };
    const labelsByAction = {
      add_location: ['Add location', 'Location'],
      tag_users: ['Tag people', 'Tag users'],
      save_draft: ['Save draft', 'Save'],
      schedule_post: ['Schedule', 'Advanced settings'],
      publish_now: ['Share', 'Post', 'Publish'],
      publish_reel: ['Share', 'Post', 'Publish'],
      publish_story: ['Share', 'Your story', 'Publish'],
    };
    if (labelsByAction[action] && !['publish_now', 'publish_reel', 'publish_story'].includes(action)) {
      await clickInstagramLabel(page, labelsByAction[action], { partial: true, timeoutAfterClick: 700 }).catch(() => null);
    }
    if (textByAction[action]) {
      await fillEditable(page, ['textarea', 'input[placeholder*="caption" i]', 'input[placeholder*="location" i]', 'input[aria-label*="location" i]', 'input[placeholder*="Search" i]', 'div[contenteditable="true"]'], textByAction[action], { humanLike: true }).catch(() => null);
      if (action === 'add_location' || action === 'tag_users') {
        await chooseInstagramSearchResult(page, textByAction[action]).catch(() => null);
      }
    }
    if (labelsByAction[action] && !(requireManualReview && INSTAGRAM_DESTRUCTIVE_ACTIONS.has(action))) {
      await clickInstagramLabel(page, labelsByAction[action], { partial: true, timeoutAfterClick: 900 }).catch(() => null);
      if (action === 'schedule_post') {
        await clickInstagramDialogConfirmation(page, ['Schedule', 'Done', 'Save']).catch(() => null);
      }
    }
    return ready(summarizeAction('instagram', step), {
      status: requireManualReview && INSTAGRAM_DESTRUCTIVE_ACTIONS.has(action) ? 'ready' : 'completed',
    });
  }

  if (['delete_post', 'archive_post', 'pin_post', 'disable_comments', 'enable_comments', 'delete_reel', 'delete_story', 'add_story_highlight'].includes(action)) {
    const labelsByAction = {
      delete_post: ['Delete'],
      archive_post: ['Archive'],
      pin_post: ['Pin to your profile', 'Pin'],
      disable_comments: ['Turn off commenting', 'Disable comments'],
      enable_comments: ['Turn on commenting', 'Enable comments'],
      delete_reel: ['Delete'],
      delete_story: ['Delete'],
      add_story_highlight: ['Highlight', 'Add to highlights'],
    };
    await openInstagramPostOptions(page, labelsByAction[action], args);
    return ready(summarizeAction('instagram', step), {
      status: requireManualReview && INSTAGRAM_DESTRUCTIVE_ACTIONS.has(action) ? 'ready' : 'completed',
    });
  }

  if (['view_stories', 'reply_to_story', 'comment_on_story'].includes(action)) {
    await clickInstagramAny(page, ['a[href*="/stories/"]', 'canvas'], ['Stories', 'Your story'], { timeoutAfterClick: 1000 });
    if ((action === 'reply_to_story' || action === 'comment_on_story') && (args.message || args.comment)) {
      await fillEditable(page, ['textarea', 'input', 'div[contenteditable="true"]'], args.message || args.comment, { humanLike: true }).catch(() => null);
      if (!requireManualReview) {
        await clickInstagramLabel(page, ['Send', 'Post', 'Reply'], { partial: true, timeoutAfterClick: 800 }).catch(() => null);
      }
    }
    return ready(summarizeAction('instagram', step), { status: 'completed' });
  }

  if (['open_user_posts', 'open_user_videos'].includes(action)) {
    await openInstagramProfileUi(page, args);
    if (action === 'open_user_videos') {
      await clickInstagramLabel(page, ['Reels', 'Videos'], { partial: true, timeoutAfterClick: 900 }).catch(() => null);
    } else {
      await clickInstagramLabel(page, ['Posts'], { partial: true, timeoutAfterClick: 900 }).catch(() => null);
    }
    return ready(summarizeAction('instagram', step), { status: 'completed' });
  }

  if (action === 'repost_post') {
    await clickInstagramAny(page, ['svg[aria-label="Share"]'], ['Share'], { timeoutAfterClick: 700 });
    await clickInstagramLabel(page, ['Add post to your story', 'Repost', 'Share'], { partial: true, timeoutAfterClick: 900 }).catch(() => null);
    return ready('Opened Instagram repost/share flow', { status: requireManualReview ? 'ready' : 'completed' });
  }

  if (['open_inbox', 'open_messages_list', 'open_requested_messages', 'open_primary_messages', 'open_general_messages'].includes(action)) {
    await openInstagramInbox(page);
    const labelsByAction = {
      open_requested_messages: ['Requests', 'Message requests'],
      open_primary_messages: ['Primary'],
      open_general_messages: ['General'],
    };
    if (labelsByAction[action]) {
      await clickInstagramLabel(page, labelsByAction[action], { partial: true, timeoutAfterClick: 900 }).catch(() => null);
    }
    return ready(summarizeAction('instagram', step), { status: 'completed' });
  }

  if (['accept_message_request', 'delete_message_request', 'blur_message_request', 'move_request_primary', 'move_request_general', 'move_request_channel', 'use_saved_reply'].includes(action)) {
    await openInstagramInbox(page);
    await clickInstagramLabel(page, ['Requests', 'Message requests'], { partial: true, timeoutAfterClick: 800 }).catch(() => null);
    const labelsByAction = {
      accept_message_request: ['Accept'],
      delete_message_request: ['Delete'],
      blur_message_request: ['Blur', 'Hide'],
      move_request_primary: ['Move to Primary', 'Primary'],
      move_request_general: ['Move to General', 'General'],
      move_request_channel: ['Move to Channel', 'Channel'],
      use_saved_reply: ['Saved reply', 'Saved replies'],
    };
    if (!(requireManualReview && INSTAGRAM_DESTRUCTIVE_ACTIONS.has(action))) {
      await clickInstagramLabel(page, labelsByAction[action], { partial: true, timeoutAfterClick: 900 }).catch(() => null);
      await clickInstagramDialogConfirmation(page, ['Move', 'Accept', 'OK', 'Done', 'Confirm']).catch(() => null);
    }
    return ready(summarizeAction('instagram', step), {
      status: requireManualReview && INSTAGRAM_DESTRUCTIVE_ACTIONS.has(action) ? 'ready' : 'completed',
    });
  }

  if (['assign_conversation_to_human', 'mark_conversation_resolved'].includes(action)) {
    await openInstagramInbox(page);
    const labelsByAction = {
      assign_conversation_to_human: ['Assign', 'Assign to', 'Human'],
      mark_conversation_resolved: ['Resolved', 'Mark resolved', 'Done'],
    };
    await clickInstagramLabel(page, labelsByAction[action], { partial: true, timeoutAfterClick: 900 }).catch(() => null);
    return ready(action === 'assign_conversation_to_human'
      ? 'Opened Instagram inbox for human assignment'
      : 'Opened Instagram inbox for resolution', { status: 'completed' });
  }

  if (['reply_to_post_comment', 'reply_to_comment', 'hide_comment', 'unhide_comment', 'delete_comment', 'send_private_reply', 'hide_spam_comment', 'flag_negative_comment', 'escalate_issue'].includes(action)) {
    if (args.comment || args.message) {
      await clickInstagramLabel(page, ['Reply'], { partial: true, timeoutAfterClick: 600 }).catch(() => null);
      await fillEditable(page, ['textarea', 'input', 'div[contenteditable="true"]'], args.comment || args.message, { humanLike: true }).catch(() => null);
      if (!requireManualReview) {
        await clickInstagramLabel(page, ['Post', 'Send', 'Reply'], { partial: false, timeoutAfterClick: 800 }).catch(() => null);
      }
    } else {
      await clickInstagramLabel(page, ['More', 'Options'], { partial: true, timeoutAfterClick: 600 }).catch(() => null);
    }
    const labelsByAction = {
      hide_comment: ['Hide'],
      unhide_comment: ['Unhide'],
      delete_comment: ['Delete'],
      send_private_reply: ['Message', 'Send message', 'Private reply'],
      hide_spam_comment: ['Hide'],
      flag_negative_comment: ['Report'],
      escalate_issue: ['Report'],
    };
    if (labelsByAction[action] && !(requireManualReview && INSTAGRAM_DESTRUCTIVE_ACTIONS.has(action))) {
      await clickInstagramLabel(page, labelsByAction[action], { partial: true, timeoutAfterClick: 800 }).catch(() => null);
      await clickInstagramDialogConfirmation(page, ['Done', 'Confirm', 'OK', 'Delete', 'Hide']).catch(() => null);
    }
    return ready(summarizeAction('instagram', step), {
      status: requireManualReview && INSTAGRAM_DESTRUCTIVE_ACTIONS.has(action) ? 'ready' : 'completed',
    });
  }

  if (['block_user', 'restrict_user', 'report_user', 'remove_follower'].includes(action)) {
    await openInstagramProfileUi(page, args);
    await clickInstagramLabel(page, ['Options', 'More options'], { partial: true, timeoutAfterClick: 700 }).catch(() => null);
    const labelsByAction = {
      block_user: ['Block'],
      restrict_user: ['Restrict'],
      report_user: ['Report'],
      remove_follower: ['Remove follower', 'Remove'],
    };
    if (!requireManualReview) {
      await clickInstagramLabel(page, labelsByAction[action], { partial: true, timeoutAfterClick: 900 }).catch(() => null);
      await clickInstagramDialogConfirmation(page, ['Block', 'Restrict', 'Report', 'Remove', 'Confirm']).catch(() => null);
    }
    return ready(summarizeAction('instagram', step), {
      status: requireManualReview ? 'ready' : 'completed',
    });
  }

  if (action === 'open_professional_settings') {
    await openInstagramAccountTypeTools(page);
    return ready('Opened Instagram professional account settings', { status: 'completed' });
  }

  if (['open_professional_dashboard', 'sync_insights', 'view_report', 'export_report', 'open_ad_account', 'open_content_tools', 'open_ad_tools', 'track_post_performance', 'track_reel_performance', 'track_story_performance'].includes(action)) {
    const labelsByAction = {
      sync_insights: ['Insights'],
      view_report: ['Insights', 'Report'],
      export_report: ['Export', 'Download'],
      open_ad_account: ['Ad account'],
      open_content_tools: ['Content'],
      open_ad_tools: ['Ad tools'],
      track_post_performance: ['Content', 'Posts'],
      track_reel_performance: ['Content', 'Reels'],
      track_story_performance: ['Content', 'Stories'],
    };
    await openInstagramProfessionalDashboard(page, labelsByAction[action] || []);
    return ready(summarizeAction('instagram', step), { status: 'completed' });
  }

  if (['qualify_lead', 'score_lead', 'save_lead', 'push_lead_to_crm', 'add_lead_to_spreadsheet', 'create_follow_up'].includes(action)) {
    await openInstagramInbox(page);
    const leadData = {
      username: args.username || args.handle || null,
      score: args.score || null,
      qualification: args.qualification || args.status || null,
      note: args.note || args.message || '',
      nextStep: action === 'create_follow_up' ? (args.followUp || args.nextStep || 'Follow up') : null,
    };
    return ready(summarizeAction('instagram', step), {
      status: 'completed',
      data: { lead: leadData },
    });
  }

  if (['create_automation_rule', 'enable_rule', 'pause_rule', 'run_workflow', 'approve_action', 'reject_action', 'view_action_log'].includes(action)) {
    return ready(summarizeAction('instagram', step), {
      status: 'completed',
      data: {
        automation: {
          rule: args.rule || args.name || action,
          state: action,
        },
      },
    });
  }

  return null;
}

// Navigate to Instagram home via UI (not direct URL) - FAST
async function navigateToInstagramHome(page) {
  console.log('[Instagram] Navigating to home...');
  
  // Quick URL navigation - most reliable and fastest
  await navigate(page, PLATFORM_URLS.instagram, 'instagram');
  await waitForAppShell(page, 'instagram');
  return true;
}

// Navigate to profile via UI search (not direct URL)
async function navigateToProfileViaSearch(page, username) {
  console.log(`[Instagram] Searching for @${username} via UI...`);
  
  // Method 1: Use top search bar
  const searchClicked = await tryClick(page, [
    'input[placeholder*="Search"]',
    'svg[aria-label="Search"]',
    'div[role="button"]:has(svg[aria-label="Search"])',
  ]);
  
  if (searchClicked) {
    await minimalDelay(300);
    await page.keyboard.type(username, { delay: 20 });
    await minimalDelay(1000);
    
    // Find and click user result
    const results = await findElementsByText(page, username, {
      tagNames: ['a', 'div', 'span'],
      fuzzy: true
    });
    
    for (const result of results) {
      if (result.href?.includes(username) || result.text.toLowerCase().includes(username.toLowerCase())) {
        await page.evaluate(({ tag, index }) => {
          const elements = document.querySelectorAll(tag);
          if (elements[index]) elements[index].click();
        }, { tag: result.tag, index: result.index });
        await minimalDelay(800);
        
        // Verify we're on profile page
        const content = await extractPageContent(page);
        const profile = parseProfileFromContent(content, 'instagram');
        if (profile.name || content.fullText.toLowerCase().includes(username.toLowerCase())) {
          console.log(`[Instagram] Found profile via search: ${profile.name || username}`);
          return true;
        }
      }
    }
  }
  
  // Method 2: Direct URL fallback (only if UI search fails)
  console.log('[Instagram] UI search failed, using URL fallback');
  await navigate(page, `https://www.instagram.com/${username}/`, 'instagram');
  await waitForAppShell(page, 'instagram');
  await minimalDelay(500);
  
  const content = await extractPageContent(page);
  const profile = parseProfileFromContent(content, 'instagram');
  return profile.name || content.fullText.length > 100;
}

// Get comprehensive profile context using smart extraction
async function getInstagramProfileContext(page, username) {
  console.log(`[Instagram] Extracting full profile context for @${username}...`);
  
  const content = await extractPageContent(page);
  const profile = parseProfileFromContent(content, 'instagram');
  const relationship = await detectRelationshipStatus(page, 'instagram');
  
  // Extract recent posts if available
  const posts = [];
  const postLinks = content.interactiveElements.filter(e => 
    e.href?.includes('/p/') || e.href?.includes('/reel/')
  ).slice(0, 3);
  
  for (const link of postLinks) {
    posts.push({
      url: link.href,
      type: link.href.includes('/reel/') ? 'reel' : 'post'
    });
  }
  
  const context = {
    username,
    name: profile.name,
    bio: profile.bio,
    category: profile.category,
    followers: profile.followers,
    following: profile.following,
    isPrivate: profile.isPrivate,
    isBusiness: profile.isBusiness,
    relationship: relationship.relationship,
    isFollowing: relationship.isFollowing,
    canMessage: relationship.canMessage,
    recentPosts: posts,
    rawText: profile.rawText?.slice(0, 1000) || ''
  };
  
  console.log(`[Instagram] Context: ${context.name || username}, ${context.bio?.slice(0, 50) || 'no bio'}, ${context.relationship}`);
  return context;
}

// Method 1a: DM a Contact — uses the inbox LEFT RAIL search bar to find an existing thread
async function messageContactViaInbox(page, username) {
  const normalizedTarget = username.toLowerCase().replace(/^@+/, '').trim();
  console.log(`[Instagram] DM Contact: opening inbox and searching for @${normalizedTarget}...`);

  await navigate(page, 'https://www.instagram.com/direct/inbox/', 'instagram');
  await waitForAppShell(page, 'instagram');
  await minimalDelay(2000);

  // Find the search bar in the left rail
  const searchInput = await firstVisibleLocator(page, [
    'input[placeholder="Search"]',
    'input[aria-label="Search input"]',
    'input[aria-label*="Search"]',
  ]);

  if (!searchInput) {
    console.log('[Instagram] No inbox search bar found in left rail');
    return false;
  }

  await searchInput.click();
  await minimalDelay(500);
  await searchInput.fill('');
  for (const char of normalizedTarget) {
    await searchInput.type(char, { delay: 60 + Math.floor(Math.random() * 80) });
  }
  // Wait for both sections to render
  await minimalDelay(3500);

  // ── Pick from "More accounts" section ONLY ──────────────────────────────
  // Instagram's inbox search shows TWO sections:
  //   1. "Messages" — content matches (threads where message TEXT contains the query)
  //      → clicking these FILTERS the inbox, does NOT open a chat
  //   2. "More accounts" — actual people/accounts matching the name
  //      → clicking these navigates to a direct thread
  //
  // Strategy: find the "More accounts" section header, then pick the best
  // matching account row that appears after it.
  const clickResult = await page.evaluate((target) => {
    const normalize = (s) => (s || '').toLowerCase().replace(/^@+/, '').trim();

    // Find the "More accounts" section header span/div
    const allText = Array.from(document.querySelectorAll('span, div, p, h3, h4'));
    const moreAccountsHeader = allText.find(el => {
      const t = (el.innerText || el.textContent || '').trim();
      return t === 'More accounts' && el.getBoundingClientRect().width > 0;
    });

    // Collect candidate rows. If we found the header, only look at elements
    // that appear AFTER it in DOM order (inside the left rail).
    const allCandidates = Array.from(
      document.querySelectorAll('a[href*="/"], div[role="button"], div[role="option"]')
    ).filter(el => {
      const rect = el.getBoundingClientRect();
      if (rect.left >= 400) return false;        // left rail only
      if (rect.width < 60 || rect.height < 40) return false;
      if (rect.height > 130) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;

      // If we found the header, skip anything that comes BEFORE it in the DOM
      if (moreAccountsHeader) {
        const pos = moreAccountsHeader.compareDocumentPosition(el);
        // DOCUMENT_POSITION_FOLLOWING = 4
        if (!(pos & 4)) return false;
      }
      return true;
    });

    const getText = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();

    // For each candidate row, extract:
    //   - The first line (display name)
    //   - The second line (usually the @handle on Instagram)
    // Match primarily against the @handle, then the display name.
    let best = null;
    let bestScore = 0;

    for (const el of allCandidates) {
      const raw = getText(el);
      const lines = raw.split('\n').map(l => normalize(l)).filter(Boolean);
      const handle = lines[1] || '';   // second line is usually the @handle
      const displayName = lines[0] || '';

      // Skip content-match rows: they say things like "2 matched messages"
      if (/\d+\s+matched\s+message/i.test(raw)) continue;
      // Skip section header rows themselves
      if (normalize(raw) === 'more accounts' || normalize(raw) === 'messages') continue;

      let score = 0;
      // Exact handle match = best possible
      if (handle === target) score = 10;
      else if (handle.includes(target) || target.includes(handle)) score = 6;
      // Display name fallback
      else if (displayName === target) score = 5;
      else if (displayName.includes(target)) score = 3;
      else if (normalize(raw).includes(target)) score = 1;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (!best || bestScore === 0) return { found: false, debug: allCandidates.length };

    const rect = best.getBoundingClientRect();
    return {
      found: true,
      x: Math.round(rect.left + Math.min(80, rect.width / 3)),
      y: Math.round(rect.top + rect.height / 2),
      text: getText(best).slice(0, 80),
      score: bestScore,
    };
  }, normalizedTarget);

  if (!clickResult.found) {
    console.log(`[Instagram] @${normalizedTarget} not found in "More accounts" section (${clickResult.debug ?? 0} candidates scanned)`);
    return false;
  }

  console.log(`[Instagram] Clicking "More accounts" result (score=${clickResult.score}): "${clickResult.text}" at (${clickResult.x}, ${clickResult.y})`);
  await page.mouse.click(clickResult.x, clickResult.y);
  await minimalDelay(2500);

  // Confirm chat opened
  const urlChanged = page.url().includes('/direct/t/');
  const composerCount = await page.locator(
    'div[contenteditable="true"][aria-label], div[contenteditable="true"][role="textbox"], div[contenteditable="true"]'
  ).count();

  if (urlChanged || composerCount > 0) {
    console.log(`[Instagram] Chat opened ✓ (url=${page.url().split('?')[0]}, composer=${composerCount > 0})`);
    return { success: true, method: 'contact_inbox' };
  }

  console.log('[Instagram] Chat did not open after clicking "More accounts" result');
  return false;
}




// Method 1b: DM a New Person — clicks the compose/pencil icon, searches in modal, clicks Chat
async function messageViaInbox(page, username) {
  console.log(`[Instagram] DM New Person: opening new message modal...`);

  await navigate(page, 'https://www.instagram.com/direct/inbox/', 'instagram');
  await waitForAppShell(page, 'instagram');
  await minimalDelay(1500);

  // Click the pencil/compose icon — walk up from SVG to its clickable parent
  const composeBtnCoords = await page.evaluate(() => {
    for (const svg of document.querySelectorAll('svg[aria-label="New message"]')) {
      const btn = svg.closest('button') || svg.closest('a') || svg.closest('[role="button"]');
      if (btn) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
      }
    }
    // Fallback: any labeled button in the top area of the left rail
    for (const btn of document.querySelectorAll('button, a[role="button"], div[role="button"]')) {
      const rect = btn.getBoundingClientRect();
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (rect.left < 380 && rect.top < 160 && rect.width > 20 && rect.width < 90
          && (label.includes('new') || label.includes('compose'))) {
        return { found: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    return { found: false };
  });

  if (!composeBtnCoords.found) {
    console.log('[Instagram] Compose button not found');
    return false;
  }

  console.log(`[Instagram] Clicking compose button at (${composeBtnCoords.x}, ${composeBtnCoords.y})`);
  await page.mouse.click(composeBtnCoords.x, composeBtnCoords.y);
  await minimalDelay(1500);

  // Verify modal opened
  const modal = page.locator('div[role="dialog"]').first();
  if (await modal.count() === 0) {
    console.log('[Instagram] New message modal did not open');
    return false;
  }

  // Type username in the modal search input
  const modalInput = page.locator('div[role="dialog"] input').first();
  if (await modalInput.count() > 0) {
    await modalInput.click().catch(() => {});
    await minimalDelay(400 + Math.random() * 600);
    await modalInput.fill('');
  }
  for (const char of username) {
    await page.keyboard.type(char, { delay: Math.floor(Math.random() * 130) + 50 });
  }
  await minimalDelay(2500 + Math.random() * 1200);

  // Find and click the matching user row INSIDE the modal only
  const matchInfo = await page.evaluate((targetName) => {
    const target = targetName.toLowerCase().trim();
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return { found: false };
    const getText = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const rows = Array.from(dialog.querySelectorAll('div, button')).filter(el => {
      const rect = el.getBoundingClientRect();
      if (rect.height < 40 || rect.height > 120 || rect.width < 80) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return el.querySelector('img') || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'option';
    });
    let bestRow = null;
    for (const row of rows) {
      const lines = getText(row).split('\n').map(l => l.trim());
      if (lines.some(l => l === target || l.replace(/^@/, '') === target)) { bestRow = row; break; }
    }
    if (!bestRow) {
      for (const row of rows) { if (getText(row).includes(target)) { bestRow = row; break; } }
    }
    if (bestRow) {
      const rect = bestRow.getBoundingClientRect();
      return { found: true, x: rect.left + Math.min(80, rect.width / 2), y: rect.top + rect.height / 2, text: getText(bestRow).slice(0, 40) };
    }
    return { found: false };
  }, username);

  if (matchInfo.found) {
    console.log(`[Instagram] Clicking modal row: "${matchInfo.text}" at (${matchInfo.x}, ${matchInfo.y})`);
    await page.mouse.click(matchInfo.x, matchInfo.y);
  } else {
    console.log('[Instagram] No match in modal, pressing Enter for first result');
    await page.keyboard.press('Enter');
  }
  await minimalDelay(1000);

  // Click the "Chat" button (exact text) that appears after selecting a user in the modal
  const chatBtn = page.locator('div[role="dialog"] button, div[role="dialog"] div[role="button"]').filter({ hasText: /^Chat$/ }).first();
  if (await chatBtn.count() > 0 && await chatBtn.isVisible()) {
    console.log('[Instagram] Clicking Chat button');
    await chatBtn.click().catch(() => {});
    await minimalDelay(1500);
  } else {
    // Fallback: find Chat/Next by text anywhere in dialog
    const fallback = await page.evaluate(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return null;
      for (const btn of dialog.querySelectorAll('button, div[role="button"]')) {
        const t = (btn.textContent || '').trim().toLowerCase();
        const rect = btn.getBoundingClientRect();
        if ((t === 'chat' || t === 'next') && rect.width > 60) {
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        }
      }
      return null;
    });
    if (fallback) { await page.mouse.click(fallback.x, fallback.y); await minimalDelay(1500); }
  }

  // Confirm chat is open
  const composer = page.locator('div[contenteditable="true"], textarea').first();
  if (await composer.count() > 0) {
    console.log('[Instagram] Chat confirmed open via new message modal');
    return { success: true, method: 'new_message_modal' };
  }

  console.log('[Instagram] Composer not visible after modal flow');
  return false;
}

// Method 2: Message via profile - OPTIMIZED
async function messageViaProfile(page, username) {
  console.log(`[Instagram] Method 2: Profile messaging...`);
  
  // Direct URL to profile - fastest
  await navigate(page, `https://www.instagram.com/${username}/`, 'instagram');
  await waitForAppShell(page, 'instagram');
  
  const relationship = await detectRelationshipStatus(page, 'instagram');
  
  if (relationship.isOwnProfile) {
    throw new Error(`Cannot message yourself (@${username})`);
  }
  
  if (!relationship.canMessage) {
    return false; // Can't message this profile
  }
  
  // Click Message button
  const msgClicked = await tryClick(page, [
    'div[role="button"]:has-text("Message")',
    'button:has-text("Message")',
    'button[aria-label="Message"]',
    'a[role="link"]:has-text("Message")',
  ]);
  
  if (!msgClicked) {
    const msgButtons = await findElementsByText(page, 'Message', {
      tagNames: ['button', 'div', 'a'],
      fuzzy: false
    });
    if (msgButtons.length > 0) {
      await page.evaluate(({ tag, index }) => {
        const elements = document.querySelectorAll(tag);
        if (elements[index]) elements[index].click();
      }, { tag: msgButtons[0].tag, index: msgButtons[0].index });
    }
  }
  
  await minimalDelay(600);
  
  // Verify chat opened
  const composer = await findElementsByText(page, '', {
    tagNames: ['textarea', 'div[contenteditable="true"]'],
    fuzzy: true
  });
  
  if (composer.length > 0) {
    return { success: true, method: 'profile', relationship };
  }
  
  return false;
}

// Method 3: Message via explore - OPTIMIZED
async function messageViaExplore(page, username) {
  console.log(`[Instagram] Method 3: Explore messaging...`);
  
  // Direct URL
  await navigate(page, `https://www.instagram.com/explore/search/keyword/?q=${username}`, 'instagram');
  await waitForAppShell(page, 'instagram');
  await minimalDelay(800);
  
  // Click first user result
  const results = await findElementsByText(page, username, {
    tagNames: ['a', 'div'],
    fuzzy: true
  });
  
  if (results.length > 0) {
    await page.evaluate(({ tag, index }) => {
      const elements = document.querySelectorAll(tag);
      if (elements[index]) elements[index].click();
    }, { tag: results[0].tag, index: results[0].index });
    
    await minimalDelay(800);
    return await messageViaProfile(page, username);
  }
  
  return false;
}

// Extract chat history from current conversation
async function extractInstagramChatHistory(page, limit = 10) {
  console.log('[Instagram] Extracting chat history...');
  
  const content = await extractPageContent(page);
  const messages = [];
  
  // Look for message patterns in the page
  const lines = content.fullText.split('\n').filter(l => l.trim());
  
  // Instagram messages appear as blocks with sender info
  // Try to identify message bubbles
  const messageElements = content.interactiveElements.filter(e => 
    e.tag === 'div' && 
    !e.href && 
    e.text.length > 0 && 
    e.text.length < 500
  );
  
  // Parse messages (this is a heuristic approach)
  let lastSender = null;
  for (const line of lines) {
    // Skip timestamps and UI elements
    if (line.match(/\d+:\d+/) || line.includes('Seen') || line.includes('Delivered')) {
      continue;
    }
    
    // Check if this looks like a username/sender
    if (line.length < 30 && !line.includes(' ')) {
      lastSender = line;
      continue;
    }
    
    // This might be a message
    if (line.length > 5 && lastSender) {
      messages.push({
        sender: lastSender,
        text: line,
        role: lastSender === 'You' ? 'me' : 'them'
      });
    }
  }
  
  console.log(`[Instagram] Found ${messages.length} messages in chat`);
  return messages.slice(-limit);
}

// Send message with attachment support
async function sendInstagramMessage(page, message, options = {}) {
  const { attachmentPath, requireManualReview } = options;
  
  console.log('[Instagram] Sending message...');
  
  // Find composer
  const composer = await page.locator('textarea, div[contenteditable="true"]').last();
  if (await composer.count() === 0) {
    throw new Error('Message composer not found');
  }
  
  // Click composer and type
  await composer.click({ force: true }).catch(() => {});
  await composer.focus().catch(() => {});
  await minimalDelay(500 + Math.random() * 1000);
  
  // Human-like typing
  for (const char of message) {
    await page.keyboard.type(char, { delay: Math.floor(Math.random() * 100) + 30 });
  }
  
  // Handle attachment if provided
  if (attachmentPath) {
    console.log('[Instagram] Attaching media...');
    try {
      const attachBtn = await page.locator('svg[aria-label="Gallery"], svg[aria-label="Add photo or video"], button[aria-label="Add photo or video"]').first();
      if (await attachBtn.count() > 0) {
        await attachBtn.evaluate(el => {
          const btn = el.closest('button') || el.closest('div[role="button"]') || el;
          btn.click();
        }).catch(() => {});
        
        await minimalDelay(1000);
        
        const fileInput = await page.locator('input[type="file"]').first();
        if (await fileInput.count() > 0) {
          await fileInput.setInputFiles(attachmentPath);
          await minimalDelay(2000);
        }
      }
    } catch (e) {
      console.warn('[Instagram] Attachment failed:', e.message);
    }
  }
  
  // Send or wait for review
  if (!requireManualReview) {
    await minimalDelay(1000); // Wait for the Send button to become active
    
    // Try send button
    const sendBtn = await page.locator('svg[aria-label="Send"], button:has-text("Send"), button[aria-label="Send"], div[role="button"]:has-text("Send")').first();
    
    if (await sendBtn.count() > 0 && await sendBtn.isVisible()) {
      console.log('[Instagram] Clicking Send button natively');
      await sendBtn.evaluate(el => {
        const btn = el.closest('button') || el.closest('div[role="button"]') || el;
        btn.click();
      }).catch(() => {});
    } else {
      console.log('[Instagram] Send button not found, falling back to Enter key');
      await page.keyboard.press('Enter');
    }
    
    await minimalDelay(1500);
    console.log('[Instagram] Message sent');
    return { sent: true };
  }
  
  return { sent: false, waitingForReview: true };
}

// Like post via UI
async function likeInstagramPost(page, postUrl, username) {
  console.log(`[Instagram] likeInstagramPost — postUrl=${postUrl}, username=${username}`);

  // 1. If a direct post URL is given, navigate to it
  if (postUrl) {
    await navigate(page, postUrl, 'instagram');
    await waitForAppShell(page, 'instagram');
    await minimalDelay(1000);
  } else if (username) {
    // 2. Navigate to profile and open the first post
    console.log(`[Instagram] Navigating to @${username}'s profile to find first post...`);
    await navigate(page, `https://www.instagram.com/${username}/`, 'instagram');
    await waitForAppShell(page, 'instagram');
    await minimalDelay(1500);

    // Click the first post thumbnail
    const firstPost = await firstVisibleLocator(page, [
      'a[href*="/p/"]',
      'a[href*="/reel/"]',
    ]);
    if (!firstPost) throw new Error(`Could not find any posts on @${username}'s profile`);
    await firstPost.click();
    await waitForAppShell(page, 'instagram');
    await minimalDelay(1500);
  } else {
    console.log('[Instagram] likeInstagramPost: no postUrl or username — attempting to like whatever post is open');
  }

  // 3. Try Playwright locator first (most reliable)
  const likeBtn = page.locator('svg[aria-label="Like"]').first();
  if (await likeBtn.count() > 0) {
    await likeBtn.evaluate(el => {
      const btn = el.closest('button') || el.closest('[role="button"]') || el;
      btn.click();
    }).catch(() => {});
    await minimalDelay(600);
    console.log('[Instagram] Post liked via SVG aria-label');
    return { liked: true };
  }

  // 4. Fallback: extractPageContent scan
  const content = await extractPageContent(page);
  const likeElement = content.interactiveElements.find(e =>
    e.ariaLabel === 'Like' || e.ariaLabel?.includes('Like')
  );
  if (likeElement) {
    await page.evaluate(({ tag, index }) => {
      const elements = document.querySelectorAll(tag);
      if (elements[index]) elements[index].click();
    }, { tag: likeElement.tag, index: likeElement.index });
    await minimalDelay(600);
    console.log('[Instagram] Post liked via extractPageContent');
    return { liked: true };
  }

  console.warn('[Instagram] Could not find Like button');
  return { liked: false };
}


// Comment on post
async function commentOnInstagramPost(page, comment, postUrl, username) {
  console.log(`[Instagram] commentOnInstagramPost — postUrl=${postUrl}, username=${username}`);

  // 1. Navigate to the post
  if (postUrl) {
    await navigate(page, postUrl, 'instagram');
    await waitForAppShell(page, 'instagram');
    await minimalDelay(1200);
  } else if (username) {
    console.log(`[Instagram] Navigating to @${username}'s profile to open first post...`);
    await navigate(page, `https://www.instagram.com/${username}/`, 'instagram');
    await waitForAppShell(page, 'instagram');
    await minimalDelay(1500);

    const firstPost = await firstVisibleLocator(page, [
      'a[href*="/p/"]',
      'a[href*="/reel/"]',
    ]);
    if (!firstPost) throw new Error(`Could not find any posts on @${username}'s profile`);
    await firstPost.click();
    await waitForAppShell(page, 'instagram');
    await minimalDelay(1500);
  }

  // 2. Find comment textarea
  const textarea = await firstVisibleLocator(page, [
    'textarea[aria-label="Add a comment\u2026"]',
    'textarea[placeholder="Add a comment\u2026"]',
    'textarea[aria-label*="comment"]',
    'textarea[placeholder*="comment"]',
    'textarea',
  ]);

  if (!textarea) throw new Error('Comment textarea not found on post');

  await textarea.click();
  await minimalDelay(400);
  await textarea.focus();
  await page.keyboard.type(comment, { delay: 18 });
  await minimalDelay(600);

  // 3. Submit — walk from textarea up to its container, find button with exact text "Post"
  const submitted = await page.evaluate(() => {
    const ta = document.querySelector(
      'textarea[aria-label="Add a comment\u2026"], textarea[placeholder="Add a comment\u2026"], textarea[aria-label*="comment"]'
    );
    if (!ta) return false;
    let container = ta.parentElement;
    for (let i = 0; i < 12 && container; i++) {
      for (const btn of Array.from(container.querySelectorAll('button, div[role="button"]'))) {
        const text = (btn.innerText || btn.textContent || '').trim();
        if (text === 'Post') { btn.click(); return true; }
      }
      container = container.parentElement;
    }
    return false;
  });

  if (submitted) {
    await minimalDelay(1500);
    console.log('[Instagram] Comment posted via Post button');
    return { commented: true };
  }

  // Fallback
  await page.keyboard.press('Enter');
  await minimalDelay(1000);
  console.log('[Instagram] Comment posted via Enter key');
  return { commented: true };
}


// Search for content/users via UI
async function instagramSearch(page, query, type = 'all') {
  console.log(`[Instagram] Searching for "${query}"...`);
  
  await navigateToInstagramHome(page);
  
  // Click search
  const searchClicked = await tryClick(page, [
    'input[placeholder*="Search"]',
    'svg[aria-label="Search"]',
  ]);
  
  if (!searchClicked) {
    // Try to find search via text
    const searchElements = await findElementsByText(page, 'Search', {
      tagNames: ['input', 'div', 'button'],
      fuzzy: true
    });
    
    if (searchElements.length > 0) {
      await page.evaluate(({ tag, index }) => {
        const elements = document.querySelectorAll(tag);
        if (elements[index]) elements[index].click();
      }, { tag: searchElements[0].tag, index: searchElements[0].index });
    }
  }
  
  await minimalDelay(300);
  await page.keyboard.type(query, { delay: 20 });
  await minimalDelay(1500);
  
  // Extract search results
  const content = await extractPageContent(page);
  const results = [];
  
  // Parse results based on type
  if (type === 'users' || type === 'all') {
    const userElements = content.interactiveElements.filter(e => 
      (e.href?.includes('/p/') || !e.href) && 
      e.text && 
      e.text.length > 0 && 
      e.text.length < 30
    );
    
    for (const el of userElements.slice(0, 10)) {
      results.push({
        type: 'user',
        username: el.text,
        url: el.href,
        element: el
      });
    }
  }
  
  if (type === 'posts' || type === 'all') {
    const postElements = content.interactiveElements.filter(e => 
      e.href?.includes('/p/') || e.href?.includes('/reel/')
    );
    
    for (const el of postElements.slice(0, 10)) {
      results.push({
        type: el.href?.includes('/reel/') ? 'reel' : 'post',
        url: el.href,
        element: el
      });
    }
  }
  
  console.log(`[Instagram] Found ${results.length} results`);
  return results;
}

// Main handler
export const instagramHandler = {
  platform: 'instagram',
  
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;
    
    // Check login state for actions that write/navigate
    if (['send_message', 'draft_message', 'open_target', 'message_batch'].includes(action)) {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.instagram, { platform: 'instagram' });
      const state = await checkLoginState(page, 'instagram');
      if (!state.ready) {
        throw new Error(state.message || 'Please log in to Instagram');
      }
    }

    // For like_post / comment_post: get the existing Instagram tab WITHOUT resetting URL.
    // openAttachedPage(PLATFORM_URLS.instagram) would navigate back to instagram.com home
    // if the tab is currently on a profile/post page, destroying context.
    if (action === 'like_post' || action === 'comment_post') {
      // Get the existing Instagram tab (or open at home as fallback)
      let page = await attachedBrowser.findPage((p) => p.url().includes('instagram.com')).catch(() => null);
      if (!page) {
        page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.instagram, { platform: 'instagram' });
      }
      const { postUrl, username, comment, messageGoal, tone, query } = args;

      if (action === 'like_post') {
        const result = await likeInstagramPost(page, postUrl, username);
        return { status: 'completed', summary: summarizeAction('instagram', step), data: result };
      }

      if (action === 'comment_post') {
        let finalComment = comment;
        if (!finalComment) {
          finalComment = await generateOutreachMessage({
            username: username || 'post',
            goal: messageGoal || 'leave an engaging, genuine comment',
            tone: tone || 'casual',
            query,
            platform: 'instagram',
            chatContext: [],
            profileInfo: {}
          });
        }
        const result = await commentOnInstagramPost(page, finalComment, postUrl, username);
        return { status: 'completed', summary: summarizeAction('instagram', step), data: { comment: finalComment, ...result } };
      }
    }

    const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.instagram, { platform: 'instagram' });

    if (action === 'analyze_instagram_account_type') {
      const firstPassContent = await extractPageContent(page).catch(() => ({ fullText: '' }));
      let accountType = inferAccountType(firstPassContent.fullText || '');
      if (accountType === 'unknown') {
        await openInstagramAccountTypeTools(page).catch(() => null);
      }
      const content = await extractPageContent(page);
      accountType = inferAccountType(content.fullText || '') || accountType;
      return {
        status: 'completed',
        summary: `Instagram account type: ${accountType}`,
        data: {
          action,
          accountType,
          signals: {
            professionalDashboard: /professional dashboard/i.test(content.fullText || ''),
            insights: /insights/i.test(content.fullText || ''),
            switchToProfessional: /switch to professional/i.test(content.fullText || ''),
            accountTypeTools: /account type and tools/i.test(content.fullText || ''),
          },
          page: await pageSnapshot(page),
        },
      };
    }

    if (action === 'analyze_instagram_profile' || action === 'analyze_user_profile') {
      const username = args.username;
      if (action === 'analyze_user_profile' && username) {
        await navigateToProfileViaSearch(page, username);
      } else {
        await openInstagramProfileUi(page, args).catch(() => navigateToInstagramHome(page));
      }
      const content = await extractPageContent(page);
      const profile = parseProfileFromContent(content, 'instagram');
      return {
        status: 'completed',
        summary: action === 'analyze_user_profile'
          ? `Analyzed Instagram profile ${username ? `@${username}` : ''}`.trim()
          : 'Analyzed current Instagram profile/feed context',
        data: {
          action,
          profile,
          accountType: inferAccountType(content.fullText || ''),
          page: await pageSnapshot(page),
        },
      };
    }

    if (action === 'open_profile' && args.username) {
      await navigateToProfileViaSearch(page, args.username);
      return {
        status: 'ready',
        summary: `Opened Instagram profile @${args.username}`,
        data: { action, page: await pageSnapshot(page) },
      };
    }

    const uiActionResult = await runInstagramUiAction(page, action, args, step);
    if (uiActionResult) return uiActionResult;

    if (INSTAGRAM_NAVIGATION_ACTIONS[action]) {
      await navigate(page, INSTAGRAM_NAVIGATION_ACTIONS[action], 'instagram');
      await waitForAppShell(page, 'instagram');

      if (action === 'upload_media' && args.attachmentPath) {
        const input = await page.locator('input[type="file"]').first();
        if (await input.count() > 0) {
          await input.setInputFiles(args.attachmentPath);
          await minimalDelay(1500);
        }
      }

      return {
        status: 'ready',
        summary: summarizeAction('instagram', step),
        data: {
          action,
          page: await pageSnapshot(page),
          requiresManualReview: Boolean(args.requireManualReview),
        },
      };
    }

    if (action === 'reply_to_dm' || action === 'send_dm_media') {
      if (!args.username) {
        return {
          status: 'failed',
          summary: `Instagram action "${action}" requires a target username`,
          data: { action, missing: 'username' },
        };
      }
      return this.execute({
        step: {
          ...step,
          action: 'send_message',
          args: { ...args, operation: action },
        },
        attachedBrowser,
      });
    }

    if (action === 'load_comments' || action === 'detect_spam') {
      const comments = await extractVisibleInstagramComments(page, Number(args.maxResults) || 25);
      return {
        status: 'completed',
        summary: action === 'detect_spam'
          ? `Checked ${comments.length} Instagram comments for spam`
          : `Loaded ${comments.length} Instagram comments`,
        data: {
          action,
          comments: action === 'detect_spam' ? classifySpamComments(comments) : comments,
          page: await pageSnapshot(page),
        },
      };
    }

    if (INSTAGRAM_UNSUPPORTED_ACTIONS.has(action)) {
      return unsupportedInstagramAction(action);
    }
    
    // ACTION: Open profile
    if (action === 'open_target') {
      const { username, operation } = args;
      if (!username) throw new Error('Instagram open_target requires a username');
      
      // DO NOT navigate to profile if user explicitly requested a direct inbox message operation!
      if (['auto_dm_contact', 'auto_dm_new', 'auto_dm'].includes(operation)) {
        console.log(`[Instagram] Skipping profile navigation for direct inbox messaging (${operation})`);
        return {
          status: 'ready',
          summary: `Skipped profile load for direct messaging`,
          data: { profile: { username }, snapshot: await pageSnapshot(page) }
        };
      }
      
      await navigateToProfileViaSearch(page, username);
      const context = await getInstagramProfileContext(page, username);
      
      return {
        status: 'ready',
        summary: summarizeAction('instagram', step),
        data: { profile: context, snapshot: await pageSnapshot(page) }
      };
    }
    
    // ACTION: Draft message
    if (action === 'draft_message') {
      const { username, messageGoal, tone, query, operation } = args;
      
      let context = {};
      // ONLY fetch profile context if it's not a direct inbox DM operation
      if (!['auto_dm_contact', 'auto_dm_new', 'auto_dm'].includes(operation)) {
        await navigateToProfileViaSearch(page, username);
        context = await getInstagramProfileContext(page, username);
      }
      
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'instagram',
        chatContext: [],
        profileInfo: context
      });
      
      return {
        status: 'ready',
        summary: summarizeAction('instagram', step),
        data: { preview: message, profile: context }
      };
    }
    
    // ACTION: Send message (with 3 methods)
    if (action === 'send_message') {
      const { username, messageGoal, tone, query, requireManualReview, attachmentPath, operation } = args;
      
      console.log(`[Instagram] Starting DM to @${username} (Operation: ${operation || 'default'})`);
      
      // STEP 1: Get profile context FIRST
      let profileContext = { canMessage: true };
      
      // ONLY load profile context if the user didn't explicitly request direct inbox messaging
      if (!['auto_dm_contact', 'auto_dm_new', 'auto_dm'].includes(operation)) {
        await navigateToProfileViaSearch(page, username);
        profileContext = await getInstagramProfileContext(page, username);
      }
      
      // STEP 2: Open chat via the correct method for this operation
      let chatOpened = null;
      let methodUsed = null;

      if (operation === 'auto_dm_contact') {
        // Existing contact → use left-rail inbox search bar ONLY
        console.log('[Instagram] Method 1: Inbox messaging (Contact - left rail search)...');
        chatOpened = await messageContactViaInbox(page, username);
        if (chatOpened) methodUsed = 'contact_inbox';
        // If left-rail search failed, do NOT fall back to new-message modal — it's a different flow
        if (!chatOpened) {
          throw new Error(`Could not find @${username} in your inbox. Make sure they are an existing contact.`);
        }

      } else if (operation === 'auto_dm_new' || operation === 'auto_dm') {
        // New person → use compose/pencil button → new message modal ONLY
        console.log('[Instagram] Method 1: Inbox messaging (New Person - compose button)...');
        chatOpened = await messageViaInbox(page, username);
        if (chatOpened) methodUsed = 'new_message_modal';
        if (!chatOpened) {
          throw new Error(`Could not open new message dialog for @${username}.`);
        }

      } else {
        // Generic send_message — try all methods in order
        chatOpened = await messageViaInbox(page, username);
        if (chatOpened) methodUsed = 'inbox';

        if (!chatOpened && profileContext.canMessage) {
          chatOpened = await messageViaProfile(page, username);
          if (chatOpened) methodUsed = 'profile';
        }

        if (!chatOpened) {
          chatOpened = await messageViaExplore(page, username);
          if (chatOpened) methodUsed = 'explore';
        }
      }

      if (!chatOpened) {
        throw new Error(`Could not open chat with @${username}. They may have restricted messaging or search failed to find them.`);
      }
      
      console.log(`[Instagram] Chat opened via: ${methodUsed}`);
      
      // STEP 3: Extract chat history ONLY for reply flows, never for cold DM operations
      // Cold DMs (auto_dm_contact, auto_dm_new, auto_dm) must not use scraped sidebar text as context
      // — it causes the LLM to hallucinate from unrelated messages visible in the inbox
      const isColdDm = ['auto_dm_contact', 'auto_dm_new', 'auto_dm'].includes(operation);
      const chatHistory = isColdDm ? [] : await extractInstagramChatHistory(page, 6);
      
      // STEP 4: Generate personalized message
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'instagram',
        chatContext: chatHistory,    // Empty for cold DMs — goal+tone only
        profileInfo: profileContext  // Empty object for inbox-only flows (no profile scraped)
      });
      
      console.log(`[Instagram] Message: "${message.slice(0, 50)}..."`);
      
      // STEP 5: Send message
      const result = await sendInstagramMessage(page, message, {
        attachmentPath,
        requireManualReview
      });
      
      return {
        status: 'completed',
        summary: summarizeAction('instagram', step, { sent: result.sent }),
        data: { 
          message, 
          sent: result.sent,
          method: methodUsed,
          profile: profileContext,
          chatHistory: chatHistory.length > 0 ? chatHistory : undefined
        }
      };
    }
    
    // ACTION: Message batch
    if (action === 'message_batch') {
      const usernames = (args.usernames || []).slice(0, Math.min(Number(args.maxResults) || 10, 20));
      const results = [];
      
      for (const username of usernames) {
        try {
          const result = await this.execute({
            step: {
              action: 'send_message',
              platform: 'instagram',
              args: { ...args, username }
            },
            attachedBrowser
          });
          results.push({ username, ...result });
          await minimalDelay(2000 + Math.random() * 2000);
        } catch (error) {
          results.push({ username, error: error.message, status: 'failed' });
        }
      }
      
      return {
        status: 'completed',
        summary: `Messaged ${usernames.length} Instagram users`,
        data: results
      };
    }
    
    // ACTION: Like post
    if (action === 'like_post') {
      const { postUrl, username } = args;
      const result = await likeInstagramPost(page, postUrl, username);
      return {
        status: 'completed',
        summary: summarizeAction('instagram', step),
        data: result
      };
    }
    
    // ACTION: Comment on post
    if (action === 'comment_post') {
      const { postUrl, comment, messageGoal, tone, query, username } = args;

      // Generate AI comment if not provided
      let finalComment = comment;
      if (!finalComment) {
        finalComment = await generateOutreachMessage({
          username: username || 'post',
          goal: messageGoal || goal || 'leave an engaging comment',
          tone: tone || 'casual',
          query,
          platform: 'instagram',
          chatContext: [],
          profileInfo: {}
        });
      }

      const result = await commentOnInstagramPost(page, finalComment, postUrl, username);
      return {
        status: 'completed',
        summary: summarizeAction('instagram', step),
        data: { comment: finalComment, ...result }
      };
    }
    
    // ACTION: Search
    if (action === 'search') {
      const { query, type } = args;
      const results = await instagramSearch(page, query, type || 'all');
      
      return {
        status: 'completed',
        summary: `Searched Instagram for "${query}"`,
        data: { results, query }
      };
    }
    
    // ACTION: Follow user
    if (action === 'follow_user') {
      const { username } = args;
      console.log(`[Instagram] Following @${username}...`);
      
      // Navigate to profile
      await navigate(page, `https://www.instagram.com/${username}/`, 'instagram');
      await waitForAppShell(page, 'instagram');
      await minimalDelay(500);
      
      // Find and click Follow button
      const followBtn = await findElementsByText(page, 'Follow', {
        tagNames: ['button'],
        fuzzy: false
      });
      
      if (followBtn.length > 0) {
        await page.evaluate(({ tag, index }) => {
          const elements = document.querySelectorAll(tag);
          if (elements[index]) elements[index].click();
        }, { tag: followBtn[0].tag, index: followBtn[0].index });
        await minimalDelay(500);
        
        return {
          status: 'completed',
          summary: `Followed @${username} on Instagram`,
          data: { username, action: 'followed' }
        };
      }
      
      // Check if already following
      const followingBtn = await findElementsByText(page, 'Following', {
        tagNames: ['button'],
        fuzzy: false
      });
      
      if (followingBtn.length > 0) {
        return {
          status: 'completed',
          summary: `Already following @${username}`,
          data: { username, action: 'already_following' }
        };
      }
      
      throw new Error(`Could not find Follow button for @${username}`);
    }
    
    // ACTION: Bulk follow from search
    if (action === 'bulk_follow_search') {
      const { searchQuery, maxResults = 10 } = args;
      console.log(`[Instagram] Bulk following from search: "${searchQuery}"`);
      
      // Navigate to search
      await navigate(page, `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(searchQuery)}`, 'instagram');
      await waitForAppShell(page, 'instagram');
      await minimalDelay(1000);
      
      // Extract users from search results
      const users = await page.evaluate((limit) => {
        const results = [];
        const userCards = document.querySelectorAll('a[href^="/"]');
        
        for (const card of userCards.slice(0, limit)) {
          const href = card.getAttribute('href');
          if (href && href.match(/^\/[a-zA-Z0-9._]+\/$/)) {
            const username = href.replace(/\//g, '');
            if (username && username.length > 1) {
              results.push(username);
            }
          }
        }
        return [...new Set(results)].slice(0, limit);
      }, maxResults);
      
      console.log(`[Instagram] Found ${users.length} users to follow`);
      
      const results = [];
      for (const username of users) {
        try {
          const result = await this.execute({
            step: {
              action: 'follow_user',
              platform: 'instagram',
              args: { username }
            },
            attachedBrowser
          });
          results.push({ username, ...result });
          await minimalDelay(1500 + Math.random() * 1000);
        } catch (error) {
          results.push({ username, error: error.message, status: 'failed' });
        }
      }
      
      return {
        status: 'completed',
        summary: `Bulk followed ${results.filter(r => r.status === 'completed').length}/${users.length} users from search`,
        data: { results, searchQuery }
      };
    }
    
    // ACTION: Bulk follow suggested users
    if (action === 'bulk_follow_suggested') {
      const { maxResults = 10 } = args;
      console.log(`[Instagram] Bulk following suggested users...`);
      
      // Navigate to explore/suggested
      await navigate(page, 'https://www.instagram.com/explore/people/', 'instagram');
      await waitForAppShell(page, 'instagram');
      await minimalDelay(1000);
      
      // Extract suggested users
      const users = await page.evaluate((limit) => {
        const results = [];
        const suggestedCards = document.querySelectorAll('a[href^="/"]');
        
        for (const card of suggestedCards.slice(0, limit * 2)) {
          const href = card.getAttribute('href');
          if (href && href.match(/^\/[a-zA-Z0-9._]+\/$/)) {
            const username = href.replace(/\//g, '');
            if (username && username.length > 1 && !results.includes(username)) {
              results.push(username);
            }
          }
        }
        return results.slice(0, limit);
      }, maxResults);
      
      console.log(`[Instagram] Found ${users.length} suggested users to follow`);
      
      const results = [];
      for (const username of users) {
        try {
          const result = await this.execute({
            step: {
              action: 'follow_user',
              platform: 'instagram',
              args: { username }
            },
            attachedBrowser
          });
          results.push({ username, ...result });
          await minimalDelay(1500 + Math.random() * 1000);
        } catch (error) {
          results.push({ username, error: error.message, status: 'failed' });
        }
      }
      
      return {
        status: 'completed',
        summary: `Bulk followed ${results.filter(r => r.status === 'completed').length}/${users.length} suggested users`,
        data: { results }
      };
    }
    
    // Delegate other actions to base handler
    const baseHandler = createSocialHandler('instagram', {
      async openLatestPost(page) {
        const postLinks = await page.locator('a[href*="/p/"], a[href*="/reel/"]').all();
        if (postLinks.length > 0) {
          await postLinks[0].click().catch(() => {});
          await waitForAppShell(page, 'instagram');
          await minimalDelay(1000);
        }
      },
      async likePost(page) {
        const likeBtn = await page.locator('svg[aria-label="Like"]').first();
        if (await likeBtn.count() > 0) {
          await likeBtn.evaluate(el => {
            const btn = el.closest('button') || el.closest('[role="button"]') || el;
            btn.click();
          }).catch(() => {});
          await minimalDelay(500);
        }
      },
      async sendComment(page) {
        // The comment submit button is labelled "Post" and lives INSIDE the comment form,
        // NOT in the action bar (where Repost lives).
        // Strategy:
        //   1. Find the active comment textarea first
        //   2. Walk UP to its form/container
        //   3. Find a "Post" button WITHIN that container
        //   4. Fall back to Enter key only if nothing found
        const submitted = await page.evaluate(() => {
          // Locate the comment textarea
          const textarea = document.querySelector(
            'textarea[aria-label="Add a comment…"], textarea[placeholder="Add a comment…"], textarea[aria-label*="comment"]'
          );
          if (!textarea) return false;

          // Walk up to a reasonable form ancestor (max 10 levels)
          let container = textarea.parentElement;
          for (let i = 0; i < 10 && container; i++) {
            // Look for a button/div with exact text "Post" inside this container
            const candidates = Array.from(container.querySelectorAll(
              'button, div[role="button"]'
            ));
            for (const btn of candidates) {
              const text = (btn.innerText || btn.textContent || '').trim();
              // Must be exactly "Post" — not "Repost", not "Share", not "Post anyway"
              if (text === 'Post') {
                btn.click();
                return true;
              }
            }
            container = container.parentElement;
          }
          return false;
        });

        if (submitted) {
          await minimalDelay(1500);
          return true;
        }

        // Nothing found via DOM walk — press Enter as last resort
        await page.keyboard.press('Enter');
        await minimalDelay(1500);
        return true;
      },
      commentSelectors: ['textarea[aria-label="Add a comment…"]', 'textarea[placeholder="Add a comment…"]', 'textarea', 'div[role="textbox"][contenteditable="true"]'],
      commentSubmitSelectors: ['button:has-text("Post")', 'div:has-text("Post")'],
      commentSubmitLabels: ['Post'],
      async openPostComposer(page, attachmentPath) {
        const createBtn = await page.locator('svg[aria-label="New post"]').first();
        if (await createBtn.count() > 0) {
          await createBtn.evaluate(el => {
            const btn = el.closest('a') || el.closest('button') || el.closest('[role="link"]');
            if (btn) btn.click();
          }).catch(() => {});
          await minimalDelay(1000);
        } else {
          await navigate(page, 'https://www.instagram.com/create/style/', 'instagram').catch(() => {});
          await minimalDelay(1000);
        }

        if (attachmentPath) {
          try {
            await minimalDelay(1500);
            const fileInput = await page.locator('input[type="file"]').first();
            if (await fileInput.count() > 0) {
              await fileInput.setInputFiles(attachmentPath);
              await minimalDelay(2000);
              
              // Navigate through the "Next" modal steps
              for (let i = 0; i < 2; i++) {
                let nextBtn = page.locator('button:has-text("Next"), div[role="button"]:has-text("Next")').first();
                if (await nextBtn.isVisible().catch(() => false)) {
                  await nextBtn.click();
                  await minimalDelay(1000);
                }
              }
            }
          } catch (e) {
            console.warn('[Instagram] Media upload failed in openPostComposer:', e.message);
          }
        }
      },
      postComposerSelectors: ['div[role="textbox"][contenteditable="true"]', 'textarea[aria-label="Write a caption..."]'],
      publishPostSelectors: ['button:has-text("Share")'],
      publishPostLabels: ['Share']
    });
    return baseHandler.execute({ step, attachedBrowser });
  }
};
