import fs from 'node:fs';
import path from 'node:path';
import {
  PLATFORM_URLS,
  clickByText,
  composePost,
  fillEditable,
  minimalDelay,
  navigate,
  openAttachedPage,
  pageSnapshot,
  summarizeAction,
  tryClick,
  waitForAppShell,
} from '../common.js';
import { checkLoginState } from '../state-checker.js';

const STUDIO_URL = 'https://studio.youtube.com/';
const UPLOAD_URL = 'https://www.youtube.com/upload';

const STUDIO_SURFACES = {
  'open_youtube_studio': { label: 'Dashboard', url: STUDIO_URL, nav: ['Dashboard'] },
  'open_youtube_content': { label: 'Content', url: STUDIO_URL, nav: ['Content'] },
  'open_youtube_analytics': { label: 'Analytics', url: STUDIO_URL, nav: ['Analytics'] },
  'open_youtube_community': { label: 'Community', url: STUDIO_URL, nav: ['Community'] },
  'open_youtube_customization': { label: 'Customization', url: STUDIO_URL, nav: ['Customization'] },
  'open_youtube_settings': { label: 'Settings', url: STUDIO_URL, nav: ['Settings'] },
};

const TITLE_SELECTORS = [
  '#title-textarea #textbox',
  'ytcp-social-suggestions-textbox#title-textarea #textbox',
  'div[contenteditable="true"][aria-label*="title" i]',
  'textarea[aria-label*="title" i]',
  'input[aria-label*="title" i]',
];

const DESCRIPTION_SELECTORS = [
  '#description-textarea #textbox',
  'ytcp-social-suggestions-textbox#description-textarea #textbox',
  'div[contenteditable="true"][aria-label*="description" i]',
  'textarea[aria-label*="description" i]',
];

const POST_TEXT_SELECTORS = [
  'div[contenteditable="true"][aria-label*="post" i]',
  'div[contenteditable="true"][aria-label*="Tell" i]',
  'ytcp-social-suggestions-textbox #textbox',
  'div[contenteditable="true"]',
  'textarea',
];

async function ensureYoutubeReady(page) {
  const state = await checkLoginState(page, 'youtube');
  if (!state.ready) {
    throw new Error(state.message || 'Please log in to YouTube in the Cherry browser profile');
  }
}

async function clickAnyText(page, labels = [], options = {}) {
  const selectors = options.selectors || [
    'ytcp-button',
    'tp-yt-paper-button',
    'tp-yt-paper-item',
    'button',
    'a',
    'div[role="button"]',
    'div[role="menuitem"]',
    'yt-formatted-string',
    'span',
  ];
  for (const label of labels) {
    const clicked = await clickByText(page, selectors, [label]).catch(() => false);
    if (clicked) {
      await minimalDelay(options.delay || 800);
      return true;
    }
  }
  return false;
}

async function openStudioSurface(attachedBrowser, action = 'open_youtube_studio') {
  const surface = STUDIO_SURFACES[action] || STUDIO_SURFACES.open_youtube_studio;
  const page = await openAttachedPage(attachedBrowser, surface.url, { platform: 'youtube', forceNavigate: true });
  await waitForAppShell(page, 'youtube');
  await ensureYoutubeReady(page);

  if (surface.nav?.length) {
    await clickAnyText(page, surface.nav, { delay: 1000 }).catch(() => false);
  }

  return page;
}

function fallbackTitle(args = {}) {
  const title = String(args.youtubeTitle || args.videoTitle || args.title || '').trim();
  if (title) return title.slice(0, 100);
  const topic = String(args.query || args.messageGoal || args.prompt || '').trim();
  if (topic) return topic.slice(0, 100);
  const filePath = String(args.attachmentPath || args.filePath || '').trim();
  return filePath ? path.basename(filePath, path.extname(filePath)).slice(0, 100) : 'New YouTube upload';
}

async function buildDescription(args = {}, type = 'video') {
  const provided = String(args.youtubeDescription || args.videoDescription || args.description || '').trim();
  if (provided) return provided;

  const base = await composePost({
    platform: type === 'short' ? 'youtube shorts' : 'youtube',
    goal: args.messageGoal || `write a ${type} description`,
    tone: args.tone || 'Clear and direct',
    query: args.query || args.prompt,
  });
  const tags = String(args.youtubeTags || args.tags || '').trim();
  return [base, tags].filter(Boolean).join('\n\n');
}

async function setText(page, selectors, value) {
  if (!value) return false;
  const filled = await fillEditable(page, selectors, value, { humanLike: false }).catch(() => ({ ok: false }));
  if (filled.ok) return true;

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!await locator.count().catch(() => 0)) continue;
    const ok = await locator.evaluate((element, text) => {
      if ('value' in element) {
        element.value = text;
      } else {
        element.textContent = text;
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, value).catch(() => false);
    if (ok) return true;
  }

  return false;
}

async function setUploadFile(page, filePath) {
  const resolvedPath = String(filePath || '').trim();
  if (!resolvedPath) {
    throw new Error('YouTube upload requires an Attachment path pointing to a video file');
  }
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`YouTube upload file was not found: ${resolvedPath}`);
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const inputs = page.locator('input[type="file"]');
    const count = await inputs.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index);
      const accepts = await input.getAttribute('accept').catch(() => '');
      if (accepts && !/video|\*/i.test(accepts)) continue;
      await input.setInputFiles(resolvedPath);
      await minimalDelay(2500);
      return true;
    }

    await tryClick(page, [
      'ytcp-button:has-text("Select files")',
      'button:has-text("Select files")',
      'ytcp-button:has-text("Upload videos")',
      'button[aria-label*="Upload"]',
      'ytcp-button[aria-label*="Create"]',
    ]).catch(() => false);
    await clickAnyText(page, ['Select files', 'Upload videos', 'Create']).catch(() => false);
    await minimalDelay(1000);
  }

  throw new Error('Could not find the YouTube Studio video file input');
}

async function openUploadDialog(attachedBrowser) {
  const page = await openAttachedPage(attachedBrowser, UPLOAD_URL, { platform: 'youtube', forceNavigate: true });
  await waitForAppShell(page, 'youtube');
  await ensureYoutubeReady(page);
  await minimalDelay(1500);
  return page;
}

async function chooseMadeForKids(page) {
  const selectors = [
    'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]',
    'tp-yt-paper-radio-button:has-text("No, it\'s not made for kids")',
    'div[role="radio"]:has-text("No, it\'s not made for kids")',
  ];
  const clicked = await tryClick(page, selectors).catch(() => false);
  if (!clicked) {
    await clickAnyText(page, ["No, it's not made for kids", 'No, it is not made for kids']).catch(() => false);
  }
}

async function applyVisibility(page, visibility = 'private') {
  const label = visibility === 'public' ? 'Public' : visibility === 'unlisted' ? 'Unlisted' : 'Private';
  await clickAnyText(page, [label], { delay: 700 }).catch(() => false);
}

async function advanceUploadWizard(page, args = {}) {
  await chooseMadeForKids(page).catch(() => {});

  for (let index = 0; index < 3; index += 1) {
    const clicked = await tryClick(page, [
      'ytcp-button:has-text("Next"):not([disabled])',
      'button:has-text("Next"):not([disabled])',
      'tp-yt-paper-button:has-text("Next"):not([disabled])',
    ]).catch(() => false);
    if (!clicked) break;
    await minimalDelay(1200);
  }

  await applyVisibility(page, args.youtubeVisibility || 'private').catch(() => {});

  const published = await tryClick(page, [
    'ytcp-button:has-text("Publish"):not([disabled])',
    'button:has-text("Publish"):not([disabled])',
    'ytcp-button:has-text("Save"):not([disabled])',
    'button:has-text("Save"):not([disabled])',
  ]).catch(() => false);
  if (published) await minimalDelay(1500);
  return published;
}

async function uploadYoutubeAsset(attachedBrowser, args = {}, type = 'video') {
  const page = await openUploadDialog(attachedBrowser);
  await setUploadFile(page, args.attachmentPath || args.filePath || args.mediaPath);

  const title = fallbackTitle(args);
  const description = await buildDescription(args, type);
  const finalTitle = type === 'short' && !/#shorts/i.test(title) ? `${title} #Shorts`.slice(0, 100) : title;
  const finalDescription = type === 'short' && !/#shorts/i.test(description) ? `${description}\n\n#Shorts` : description;

  await setText(page, TITLE_SELECTORS, finalTitle).catch(() => false);
  await setText(page, DESCRIPTION_SELECTORS, finalDescription).catch(() => false);

  let sent = false;
  if (!args.requireManualReview) {
    sent = await advanceUploadWizard(page, args).catch(() => false);
  }

  return {
    status: 'completed',
    summary: summarizeAction('youtube', { action: type === 'short' ? 'upload_youtube_short' : 'upload_youtube_video', args }, { sent }),
    data: {
      page: await pageSnapshot(page),
      title: finalTitle,
      description: finalDescription,
      sent,
    },
  };
}

async function createCommunityPost(attachedBrowser, args = {}) {
  const page = await openStudioSurface(attachedBrowser, 'open_youtube_community');
  await clickAnyText(page, ['Create', 'Post', 'Text post']).catch(() => false);
  await minimalDelay(1000);

  const postText = await composePost({
    platform: 'youtube community',
    goal: args.messageGoal || 'publish a YouTube community update',
    tone: args.tone || 'Clear and concise',
    query: args.query || args.prompt,
  });

  const filled = await setText(page, POST_TEXT_SELECTORS, postText);
  if (!filled) {
    throw new Error('Could not find the YouTube Studio community post composer');
  }

  let sent = false;
  if (!args.requireManualReview) {
    sent = await tryClick(page, [
      'ytcp-button:has-text("Post"):not([disabled])',
      'button:has-text("Post"):not([disabled])',
      'tp-yt-paper-button:has-text("Post"):not([disabled])',
    ]).catch(() => false);
    if (sent) await minimalDelay(1200);
  }

  return {
    status: 'completed',
    summary: summarizeAction('youtube', { action: 'create_youtube_post', args }, { sent }),
    data: { page: await pageSnapshot(page), postText, sent },
  };
}

async function writeYoutubeDescription(attachedBrowser, args = {}) {
  const page = await openAttachedPage(attachedBrowser, STUDIO_URL, { platform: 'youtube' });
  await waitForAppShell(page, 'youtube');
  await ensureYoutubeReady(page);

  const description = await buildDescription(args, 'video');
  const filled = await setText(page, DESCRIPTION_SELECTORS, description);
  if (!filled) {
    await openStudioSurface(attachedBrowser, 'open_youtube_content').catch(() => null);
  }

  return {
    status: filled ? 'completed' : 'ready',
    summary: summarizeAction('youtube', { action: 'write_youtube_description', args }, { filled }),
    data: {
      page: await pageSnapshot(page),
      description,
      filled,
      note: filled ? undefined : 'Open a YouTube Studio video details page, then run this action again to fill the description.',
    },
  };
}

async function scrapeYoutubeResults(attachedBrowser, args = {}) {
  const query = String(args.query || args.prompt || '').trim();
  const page = await openAttachedPage(
    attachedBrowser,
    query ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` : PLATFORM_URLS.youtube,
    { platform: 'youtube', forceNavigate: true },
  );
  await waitForAppShell(page, 'youtube');
  await minimalDelay(1200);

  const results = await page.evaluate((limit) => {
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const seen = new Set();
    const items = [];
    const anchors = Array.from(document.querySelectorAll('a[href*="/watch"], a[href*="/shorts/"], a[href^="/@"]'));
    for (const anchor of anchors) {
      const href = anchor.href || anchor.getAttribute('href') || '';
      const title = clean(anchor.getAttribute('title') || anchor.textContent);
      if (!href || !title || seen.has(href)) continue;
      seen.add(href);
      const card = anchor.closest('ytd-video-renderer, ytd-rich-item-renderer, ytd-channel-renderer, ytd-reel-item-renderer') || anchor.closest('div');
      items.push({
        title: title.slice(0, 160),
        url: href,
        snippet: clean(card?.innerText || title).slice(0, 500),
      });
      if (items.length >= limit) break;
    }
    return items;
  }, Math.max(1, Math.min(Number(args.maxResults) || 10, 30)));

  return {
    status: 'completed',
    summary: `Collected ${results.length} YouTube results for "${query}"`,
    data: { page: await pageSnapshot(page), results },
  };
}

export const youtubeHandler = {
  platform: 'youtube',
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;

    if (action === 'open_workspace' || action === 'open_youtube_studio') {
      const page = action === 'open_workspace'
        ? await openAttachedPage(attachedBrowser, PLATFORM_URLS.youtube, { platform: 'youtube' })
        : await openStudioSurface(attachedBrowser, action);
      return { status: 'ready', summary: summarizeAction('youtube', step), data: await pageSnapshot(page) };
    }

    if (STUDIO_SURFACES[action]) {
      const page = await openStudioSurface(attachedBrowser, action);
      return { status: 'ready', summary: summarizeAction('youtube', step), data: await pageSnapshot(page) };
    }

    if (action === 'upload_youtube_video') {
      return uploadYoutubeAsset(attachedBrowser, args, 'video');
    }

    if (action === 'upload_youtube_short') {
      return uploadYoutubeAsset(attachedBrowser, args, 'short');
    }

    if (action === 'create_youtube_post') {
      return createCommunityPost(attachedBrowser, args);
    }

    if (action === 'write_youtube_description') {
      return writeYoutubeDescription(attachedBrowser, args);
    }

    if (action === 'scrape_results' || action === 'extract_context' || action === 'export_artifact') {
      return scrapeYoutubeResults(attachedBrowser, args);
    }

    throw new Error(`youtube does not support the "${action}" action in Cherry yet`);
  },
};
