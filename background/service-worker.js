console.log('Cherry AI background service worker initialized.');

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

import CDPController from './cdp-controller.js';
import StealthEngine from './stealth-engine.js';

import { InstagramScraper } from '../modules/instagram/search-scraper.js';
import { InstagramDMSender } from '../modules/instagram/dm-sender.js';
import { InstagramEngagementSuite } from '../modules/instagram/engage-sender.js';
import { TwitterStealthEngine } from '../modules/twitter/twitter-stealth.js';
import { LinkedInStealthEngine } from '../modules/linkedin/linkedin-stealth.js';

const PLATFORM_URLS = {
  ig: 'https://www.instagram.com/',
  twitter: 'https://x.com/home',
  li: 'https://www.linkedin.com/feed/',
  fb: 'https://www.facebook.com/',
  gmail: 'https://mail.google.com/',
  ddg: 'https://html.duckduckgo.com/html/'
};

const PLATFORM_HOSTS = {
  ig: ['instagram.com'],
  twitter: ['x.com', 'twitter.com'],
  li: ['linkedin.com'],
  fb: ['facebook.com'],
  gmail: ['mail.google.com'],
  ddg: ['duckduckgo.com']
};

async function getPlatformTab(prefix) {
  const hosts = PLATFORM_HOSTS[prefix] || [];
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  for (const tab of allTabs) {
    if (tab.url && hosts.some(h => tab.url.includes(h))) {
      // Work in background - don't activate tab
      return tab.id;
    }
  }
  const url = PLATFORM_URLS[prefix] || 'https://www.google.com/';
  const newTab = await chrome.tabs.create({ url, active: false }); // Don't focus
  await new Promise(r => setTimeout(r, 2000)); // Reduced from 5s
  return newTab.id;
}

// ── CSV: generate string and trigger download via chrome.downloads API ──────────
// This is reliable from service worker context (no Blob URL or link.click() tricks)
async function downloadCSV(rows, prefix) {
  if (!rows || !rows.length) return;

  const headers = ['Username', 'Display Name', 'Profile URL', 'Email', 'Bio', 'Followers', 'Bio Links', 'Post URL', 'Post Description'];
  const escape = v => '"' + String(v || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ') + '"';

  const lines = [
    headers.join(','),
    ...rows.map(r => [
      r.username, r.displayName, r.profileUrl,
      r.email, r.bio, r.followers, r.bioLinks,
      r.postUrl, r.postDescription
    ].map(escape).join(','))
  ];

  const csvStr = lines.join('\n');
  const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvStr);
  const filename = 'cherry_' + prefix + '_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.csv';

  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
  console.log('[Cherry] CSV downloaded:', filename, '(' + rows.length + ' rows)');
}

async function runInstagramBulkAction(tabId, usernames, actionLabel, runner) {
  const normalizedUsers = (usernames || []).map((username) => String(username || '').trim()).filter(Boolean);
  let successCount = 0;

  for (let i = 0; i < normalizedUsers.length; i++) {
    StealthEngine.checkAbort();
    const username = normalizedUsers[i];
    chrome.runtime.sendMessage({ action: 'PROGRESS', current: i + 1, total: normalizedUsers.length });

    try {
      console.log(`[Cherry IG] ${actionLabel} targeting: @${username}`);
      await runner(username);
      successCount++;
    } catch (err) {
      if (err.message === 'USER_ABORTED') throw err;
      console.log(`[Cherry IG] Failed to ${actionLabel.toLowerCase()} @${username}:`, err.message);
    }

    if (i < normalizedUsers.length - 1) {
      await StealthEngine.sleep(2000); // Reduced from 15-45s to 2s
    }
  }

  return { successCount, totalCount: normalizedUsers.length };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Cherry AI received:', request.action, request.type);

  if (request.action === 'PING') {
    sendResponse({ status: 'OK' });
    return false;
  }

  if (request.action === 'ABORT_ENGINE') {
    StealthEngine.abort();
    sendResponse({ status: 'Stopping... CSV will download if any profiles were scraped.' });
    return false;
  }

  if (request.action === 'START_ENGINE') {
    StealthEngine.reset();

    (async () => {
      let activeTabId = null;
      try {
        const prefix = (request.type || '').split('_')[0];
        activeTabId = await getPlatformTab(prefix);
        await CDPController.attach(activeTabId);
        await new Promise(r => setTimeout(r, 500)); // Reduced from 1.5s

        let result = null;

        // ── Instagram ────────────────────────────────────────────────────────────
        if (request.type === 'ig_scrape') {
          const q = (request.payload.hashtag || '').trim();
          const maxLimit = request.payload.maxLimit || 15;
          const onProgress = (current, total) => {
             chrome.runtime.sendMessage({ action: 'PROGRESS', current, total });
          };
          const results = !q.includes(' ')
            ? await InstagramScraper.scrapeHashtag(activeTabId, q, maxLimit, onProgress)
            : await InstagramScraper.scrapeByKeyword(activeTabId, q, maxLimit, onProgress);

          if (results.length > 0) {
            await downloadCSV(results, 'ig_' + q.replace(/[^a-z0-9]/gi, ''));
            result = { status: 'Scraped ' + results.length + ' profiles → CSV saved to Downloads!' };
          } else {
            result = { status: 'Scraped 0 profiles. Is Instagram open and logged in?' };
          }

        } else if (request.type === 'ig_dm') {
          await InstagramDMSender.sendDM(activeTabId, request.payload.username, {}, request.payload.userGoal, request.payload.tonePrompt, request.payload.attachmentUrl);
          result = { status: 'DM dispatched.' };

        } else if (request.type === 'ig_csv_dm') {
          const bulkResult = await runInstagramBulkAction(
            activeTabId,
            request.payload.usernameList,
            'Bulk DM',
            (username) => InstagramDMSender.sendDM(
              activeTabId,
              username,
              {},
              request.payload.userGoal,
              request.payload.tonePrompt,
              request.payload.attachmentUrl
            )
          );
          result = { status: `Bulk DM complete. Reached ${bulkResult.successCount} / ${bulkResult.totalCount} users.` };

        } else if (request.type === 'ig_csv_engage') {
          const bulkResult = await runInstagramBulkAction(
            activeTabId,
            request.payload.usernameList,
            'Bulk Engage',
            (username) => InstagramEngagementSuite.engageWithUser(
              activeTabId,
              username,
              request.payload.userGoal,
              request.payload.tonePrompt
            )
          );
          result = { status: `Bulk engage complete. Reached ${bulkResult.successCount} / ${bulkResult.totalCount} users.` };

        } else if (request.type === 'ig_csv_follow') {
          const bulkResult = await runInstagramBulkAction(
            activeTabId,
            request.payload.usernameList,
            'Bulk Follow',
            (username) => InstagramEngagementSuite.followUser(activeTabId, username)
          );
          result = { status: `Bulk follow complete. Reached ${bulkResult.successCount} / ${bulkResult.totalCount} users.` };

        } else if (request.type === 'ig_engage') {
          result = await InstagramEngagementSuite.engageWithUser(activeTabId, request.payload.username, request.payload.userGoal, request.payload.tonePrompt);

        } else if (request.type === 'ig_follow') {
          result = await InstagramEngagementSuite.followUser(activeTabId, request.payload.username);

        } else if (request.type === 'ig_post') {
          result = await InstagramEngagementSuite.createPost(activeTabId, request.payload.tonePrompt);

        // ── Twitter ──────────────────────────────────────────────────────────────
        } else if (request.type.startsWith('twitter_')) {
          const r = await TwitterStealthEngine.executeCommand(activeTabId, request.type, request.payload);
          if (r.type === 'csv' && r.data && r.data.length > 0) {
            await downloadCSV(r.data, 'twitter');
            result = { status: 'Scraped ' + r.data.length + ' profiles → CSV saved to Downloads!' };
          } else {
            result = { status: r.status };
          }

        // ── LinkedIn ─────────────────────────────────────────────────────────────
        } else if (request.type.startsWith('li_')) {
          const r = await LinkedInStealthEngine.executeCommand(activeTabId, request.type, request.payload);
          if (r.type === 'csv' && r.data && r.data.length > 0) {
            await downloadCSV(r.data, 'linkedin');
            result = { status: 'Scraped ' + r.data.length + ' profiles → CSV saved to Downloads!' };
          } else {
            result = { status: r.status };
          }

        } else if (request.type.startsWith('fb_')) {
          result = { status: 'Facebook module coming soon.' };
        } else if (request.type.startsWith('gmail_')) {
          result = { status: 'Gmail module coming soon.' };
        } else if (request.type.startsWith('ddg_')) {
          result = { status: 'DuckDuckGo module coming soon.' };
        } else {
          result = { status: 'Unknown command: ' + request.type };
        }

        sendResponse(result || { status: 'Done.' });

      } catch (err) {
        console.error('Cherry AI engine error:', err);
        if (err.message === 'USER_ABORTED') {
          sendResponse({ status: 'Stopped — CSV auto-saved if any profiles were scraped.' });
        } else {
          sendResponse({ status: 'Error: ' + err.message });
        }
      } finally {
        if (activeTabId) {
          try { await CDPController.detach(activeTabId); } catch(e) {}
        }
      }
    })();

    return true;
  }

  return false;
});
