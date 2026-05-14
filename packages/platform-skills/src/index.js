import {
  PLATFORM_SKILL_CAPABILITIES,
  WORKFLOW_PRESETS,
  WORKFLOW_TEMPLATES,
} from '@cherry/shared';
import { facebookHandler } from './handlers/facebook.js';
import { gmailHandler } from './handlers/gmail.js';
import { instagramHandler } from './handlers/instagram.js';
import { linkedinHandler } from './handlers/linkedin.js';
import { researchHandler } from './handlers/research.js';
import { twitterHandler } from './handlers/twitter.js';
import { whatsappHandler } from './handlers/whatsapp.js';
import { chatgptHandler } from './handlers/chatgpt.js';
import { geminiHandler } from './handlers/gemini.js';
import { gsheetsHandler } from './handlers/gsheets.js';

import {
  PLATFORM_URLS,
  SEARCH_SELECTORS,
  buildSearchUrl,
  buildPlatformSearchUrl,
  humanScrollPage,
  openAttachedPage,
  openSearchSurface,
  openTargetPage,
  pageSnapshot,
  scrapePlatformProfiles,
  summarizeAction,
  typeLikeHuman,
  waitForVisible,
  pauseLikeHuman,
} from './common.js';

export const skillRegistry = new Map([
  ['instagram', instagramHandler],
  ['twitter', twitterHandler],
  ['linkedin', linkedinHandler],
  ['facebook', facebookHandler],
  ['gmail', gmailHandler],
  ['whatsapp', whatsappHandler],
  ['research', researchHandler],
  ['chatgpt', chatgptHandler],
  ['gemini', geminiHandler],
  ['sheets', gsheetsHandler],
]);


export const skillCatalog = Object.fromEntries(
  [...skillRegistry.keys()].map((platform) => [
    platform,
    {
      platform,
      actions: PLATFORM_SKILL_CAPABILITIES[platform] || [],
      workflows: Object.entries(WORKFLOW_TEMPLATES)
        .filter(([, actions]) => actions.some((action) => (PLATFORM_SKILL_CAPABILITIES[platform] || []).includes(action)))
        .map(([id, actions]) => ({ id, actions: actions.filter((action) => (PLATFORM_SKILL_CAPABILITIES[platform] || []).includes(action)) })),
    },
  ]),
);

export function getSkillCatalog() {
  return {
    platforms: skillCatalog,
    presets: WORKFLOW_PRESETS,
  };
}

export async function executeSkill({ step, attachedBrowser, managedBrowser }) {
  const skill = skillRegistry.get(step.platform);
  if (!skill) {
    throw new Error(`No skill registered for platform ${step.platform}`);
  }
  const supportedActions = PLATFORM_SKILL_CAPABILITIES[step.platform] || [];
  if (!supportedActions.includes(step.action)) {
    throw new Error(`${step.platform} does not support the normalized "${step.action}" action yet`);
  }
  const genericResult = await executeGenericSkill({ step, attachedBrowser, managedBrowser });
  if (genericResult) return genericResult;
  return skill.execute({ step, attachedBrowser, managedBrowser });
}

async function executeGenericSkill({ step, attachedBrowser, managedBrowser }) {
  const platform = step.platform;
  const args = step.args || {};

  if (step.action === 'open_home') {
    const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS[platform], { platform });
    return { status: 'completed', summary: `Opened ${platform} home page`, data: await pageSnapshot(page) };
  }

  if (step.action === 'search') {
    const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS[platform], { platform });

    if (platform === 'facebook' && args.query) {
      const searchUrl = buildPlatformSearchUrl(platform, args.query || args.prompt);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await pauseLikeHuman(page, 500, 1000);
      return { status: 'completed', summary: `Searched Facebook People for "${args.query}"`, data: await pageSnapshot(page) };
    }
    
    // Attempt human-like search if selectors exist
    const searchSelectors = SEARCH_SELECTORS[platform];
    if (searchSelectors && args.query) {
      const searchBox = await waitForVisible(page, searchSelectors, 5000).catch(() => null);
      if (searchBox) {
        await searchBox.click();
        await pauseLikeHuman(page, 50, 150);
        await typeLikeHuman(page, searchBox, args.query);
        await pauseLikeHuman(page, 100, 200);
        await page.keyboard.press('Enter');
        await pauseLikeHuman(page, 500, 1000);
        return { status: 'completed', summary: `Searched for "${args.query}" on ${platform}`, data: await pageSnapshot(page) };
      }
    }
    
    // Fallback to URL search if human-like fails or no query
    const searchUrl = buildPlatformSearchUrl(platform, args.query || args.prompt);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    await pauseLikeHuman(page, 500, 1000);
    return { status: 'completed', summary: `Navigated to ${platform} search results`, data: await pageSnapshot(page) };
  }

  if (step.action === 'apply_filters') {
    // Wait for a few seconds to let any dynamic filters load, this action assumes the page is already on search results
    const page = attachedBrowser.activePage;
    if (page) await pauseLikeHuman(page, 1500, 3000);
    return { status: 'ready', summary: `Applied visible ${platform} search controls`, data: page ? await pageSnapshot(page) : null };
  }

  if (step.action === 'scroll_collect') {
    if (platform === 'research' && managedBrowser) {
      const results = await managedBrowser.scrapePages({
        profileId: 'research',
        urls: [buildSearchUrl(args.query || args.prompt || 'research', args.engine || 'google')],
      });
      return { status: 'completed', summary: summarizeAction(platform, step), data: results };
    }

    const page = attachedBrowser.activePage || await openAttachedPage(
      attachedBrowser,
      PLATFORM_URLS[platform],
      { platform }
    );
    const maxScrolls = Math.min(8, Math.max(2, Number(args.maxResults) ? Math.ceil(Number(args.maxResults) / 5) : 4));
    const snapshots = await humanScrollPage(page, { maxScrolls });
    return { status: 'completed', summary: `Scrolled and collected visible ${platform} context`, data: { page: await pageSnapshot(page), scrolls: snapshots.length } };
  }

  if (step.action === 'scrape_profile') {
    const page = await openTargetPage(attachedBrowser, { platform, username: args.username });
    return { status: 'completed', summary: `Scraped visible ${platform} profile context`, data: await pageSnapshot(page) };
  }

  return null;
}

// Export test utilities
export { TestRunner, quickHealthCheck, runTests } from './tests/runner.js';
export { checkLoginState, ensurePlatformReadyWithState } from './state-checker.js';
export { extractChatContext } from './chat-context.js';
export { extractContactInfo, bulkExtractContacts } from './lead-extractor.js';
export { createPost, createStory, schedulePost } from './content-poster.js';
export { MultiTabController, BackgroundScheduler } from './multi-tab.js';
