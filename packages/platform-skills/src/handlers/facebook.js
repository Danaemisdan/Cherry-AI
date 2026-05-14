import {
  PLATFORM_URLS,
  buildPlatformTargetUrl,
  clickByText,
  composeComment,
  composePost,
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
import { extractProfileContext, formatProfileContext } from '../profile-context.js';
import { createSocialHandler } from '../social-base.js';

// Facebook DM Helper Functions
async function navigateToFacebookProfile(page, username) {
  const url = buildPlatformTargetUrl('facebook', username);
  await navigate(page, url, 'facebook');
  await waitForAppShell(page, 'facebook');
}

function normalizeFacebookProfileUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://www.facebook.com/${raw.replace(/^\/+/, '')}`);
    if (!url.hostname.includes('facebook.com')) return '';

    if (url.pathname === '/profile.php') {
      const id = url.searchParams.get('id');
      return id ? `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}` : '';
    }

    const cleanPath = url.pathname.replace(/\/+$/, '');
    if (!cleanPath || cleanPath === '/') return '';
    return `https://www.facebook.com${cleanPath}`;
  } catch {
    return raw.startsWith('http') ? raw : `https://www.facebook.com/${raw.replace(/^\/+/, '')}`;
  }
}

async function checkFacebookFriendStatus(page) {
  // Use parallel checks for better accuracy
  const checks = await Promise.allSettled([
    // Already friends - Friends button exists
    page.locator('button:has-text("Friends"), button[aria-label*="Friends"], div[role="button"]:has-text("Friends"), [data-testid="friendship-button"]').first().isVisible().catch(() => false),
    // Can add friend
    page.locator('button:has-text("Add friend"), button:has-text("Add Friend"), button[aria-label*="Add Friend"], div[role="button"]:has-text("Add friend")').first().isVisible().catch(() => false),
    // Cancel request (request already sent)
    page.locator('button:has-text("Cancel Request"), button:has-text("Cancel request")').first().isVisible().catch(() => false),
    // Message button visible
    page.locator('button:has-text("Message"), a:has-text("Message"), div[role="button"]:has-text("Message"), [aria-label="Message"]').first().isVisible().catch(() => false),
    // Follow button (pages or public figures)
    page.locator('button:has-text("Follow"), div[role="button"]:has-text("Follow")').first().isVisible().catch(() => false),
    // Already following
    page.locator('button:has-text("Following"), div[role="button"]:has-text("Following")').first().isVisible().catch(() => false),
    // Check if this is our own profile
    page.locator('text="Edit profile", [aria-label="Edit profile"]').first().isVisible().catch(() => false),
    // Check for content not available (blocked or private)
    page.locator('text="Content not available", text="This content isn\'t available right now"').first().isVisible().catch(() => false),
  ]);

  const [isFriendResult, canAddFriendResult, hasRequestPendingResult, hasMessageResult, canFollowResult, isFollowingResult, isOwnProfileResult, isBlockedResult] =
    checks.map(r => r.status === 'fulfilled' ? r.value : false);

  return {
    isFriend: isFriendResult,
    canAddFriend: canAddFriendResult,
    requestPending: hasRequestPendingResult,
    hasMessageButton: hasMessageResult,
    canFollow: canFollowResult,
    isFollowing: isFollowingResult,
    isOwnProfile: isOwnProfileResult,
    isValidProfile: !isBlockedResult,
  };
}

async function collectFacebookPeopleResults(page, query, maxResults = 10) {
  const limit = Math.max(1, Math.min(Number(maxResults) || 10, 50));
  await navigate(page, `https://www.facebook.com/search/people/?q=${encodeURIComponent(query || '')}`, 'facebook');
  await waitForAppShell(page, 'facebook');
  await minimalDelay(1500);

  const results = [];
  const seen = new Set();

  for (let pass = 0; pass < 6 && results.length < limit; pass += 1) {
    const batch = await page.evaluate((remaining) => {
      const blockedFirstSegments = new Set([
        'friends',
        'groups',
        'pages',
        'events',
        'marketplace',
        'watch',
        'gaming',
        'reel',
        'reels',
        'stories',
        'search',
        'notifications',
        'messages',
        'settings',
        'help',
      ]);

      const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const normalize = (href) => {
        try {
          const url = new URL(href, window.location.origin);
          if (!url.hostname.includes('facebook.com')) return null;

          if (url.pathname === '/profile.php') {
            const id = url.searchParams.get('id');
            return id ? `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}` : null;
          }

          const parts = url.pathname.split('/').filter(Boolean);
          if (!parts.length) return null;
          if (blockedFirstSegments.has(parts[0].toLowerCase())) return null;

          if (parts[0] === 'people' && parts.length >= 3) {
            return `https://www.facebook.com/${parts.slice(0, 3).join('/')}`;
          }

          if (parts.length === 1 && !parts[0].includes('.php')) {
            return `https://www.facebook.com/${parts[0]}`;
          }

          return null;
        } catch {
          return null;
        }
      };

      const candidates = [];
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      for (const anchor of anchors) {
        const profileUrl = normalize(anchor.href);
        if (!profileUrl) continue;

        const card = anchor.closest('[role="article"], [role="listitem"], div');
        const rawName = clean(anchor.textContent) || clean(card?.querySelector('strong, span')?.textContent);
        const snippet = clean(card?.innerText || anchor.textContent).slice(0, 300);
        const name = rawName.split('\n')[0].slice(0, 80);

        if (!name || /^(facebook|see more|add friend|message|follow)$/i.test(name)) continue;
        if (/group|page|event|marketplace/i.test(name) && !profileUrl.includes('/profile.php')) continue;

        candidates.push({ name, profileUrl, snippet });
        if (candidates.length >= remaining) break;
      }
      return candidates;
    }, Math.max(limit * 2, 20)).catch(() => []);

    for (const item of batch) {
      const profileUrl = normalizeFacebookProfileUrl(item.profileUrl);
      if (!profileUrl || seen.has(profileUrl)) continue;
      seen.add(profileUrl);
      results.push({ ...item, profileUrl });
      if (results.length >= limit) break;
    }

    if (results.length >= limit) break;
    await page.mouse.wheel(0, 900).catch(() => {});
    await minimalDelay(900);
  }

  return results.slice(0, limit);
}

async function followOrAddFacebookProfile(page, target, options = {}) {
  const { prefer = 'follow' } = options;
  const profileUrl = normalizeFacebookProfileUrl(target);
  if (!profileUrl) {
    throw new Error('Facebook follow/add friend requires a profile URL or username');
  }

  await navigateToFacebookProfile(page, profileUrl);
  const before = await checkFacebookFriendStatus(page);

  if (!before.isValidProfile) {
    return { status: 'skipped', action: 'unavailable', profileUrl, reason: 'Profile unavailable' };
  }
  if (before.isOwnProfile) {
    return { status: 'skipped', action: 'own_profile', profileUrl, reason: 'Own profile' };
  }
  if (before.isFriend) {
    return { status: 'completed', action: 'already_friends', profileUrl };
  }
  if (before.isFollowing) {
    return { status: 'completed', action: 'already_following', profileUrl };
  }
  if (before.requestPending) {
    return { status: 'completed', action: 'request_pending', profileUrl };
  }

  const followSelectors = [
      'button:has-text("Follow")',
      'div[role="button"]:has-text("Follow")',
      'button[aria-label*="Follow"]',
      'div[role="button"][aria-label*="Follow"]',
    ];
  const addFriendSelectors = [
    'button:has-text("Add friend")',
    'button:has-text("Add Friend")',
    'div[role="button"]:has-text("Add friend")',
    'div[role="button"]:has-text("Add Friend")',
    'button[aria-label*="Add Friend"]',
    'div[role="button"][aria-label*="Add Friend"]',
    '[data-testid="friend-add-button"]',
  ];

  const tryAddFriend = async () =>
    await tryClick(page, addFriendSelectors) ||
    await clickByText(page, ['button', 'div[role="button"]'], ['Add friend', 'Add Friend']);
  const tryFollow = async () =>
    await tryClick(page, followSelectors) ||
    await clickByText(page, ['button', 'div[role="button"]'], ['Follow']);

  if (prefer === 'add_friend') {
    const added = await tryAddFriend();
    if (added) {
      await waitForAppShell(page, 'facebook');
      await minimalDelay(900);
      return { status: 'completed', action: 'friend_request_sent', profileUrl };
    }

    const followed = await tryFollow();
    if (followed) {
      await waitForAppShell(page, 'facebook');
      await minimalDelay(800);
      return { status: 'completed', action: 'followed', profileUrl };
    }
  } else {
    const followed = await tryFollow();
    if (followed) {
      await waitForAppShell(page, 'facebook');
      await minimalDelay(800);
      return { status: 'completed', action: 'followed', profileUrl };
    }

    const added = await tryAddFriend();
    if (added) {
      await waitForAppShell(page, 'facebook');
      await minimalDelay(900);
      return { status: 'completed', action: 'friend_request_sent', profileUrl };
    }
  }

  return { status: 'failed', action: 'no_action_available', profileUrl, reason: 'No Follow or Add friend button found' };
}

async function resolveFacebookTargetProfile(page, target) {
  const searchTarget = String(target || '').trim();
  if (!searchTarget) {
    throw new Error('Facebook target requires a username, name, or profile URL');
  }

  if (/^https?:\/\//i.test(searchTarget)) {
    const profileUrl = normalizeFacebookProfileUrl(searchTarget);
    if (!profileUrl) {
      throw new Error(`Invalid Facebook profile URL: "${searchTarget}"`);
    }
    return {
      target: searchTarget,
      matchedProfile: { name: searchTarget, profileUrl, snippet: '' },
      profileUrl,
    };
  }

  const profiles = await collectFacebookPeopleResults(page, searchTarget, 1);
  const firstProfile = profiles[0];
  if (!firstProfile?.profileUrl) {
    throw new Error(`No Facebook people search result found for "${searchTarget}"`);
  }

  return {
    target: searchTarget,
    matchedProfile: firstProfile,
    profileUrl: firstProfile.profileUrl,
  };
}

async function openResolvedFacebookTarget(page, target) {
  const resolved = await resolveFacebookTargetProfile(page, target);
  await navigateToFacebookProfile(page, resolved.profileUrl);
  return resolved;
}

async function openResolvedFacebookTargetPosts(page, target) {
  const resolved = await openResolvedFacebookTarget(page, target);
  const url = new URL(resolved.profileUrl);
  url.searchParams.set('sk', 'posts');
  await navigate(page, url.toString(), 'facebook');
  await waitForAppShell(page, 'facebook');
  await minimalDelay(1200);
  return resolved;
}

async function followFirstFacebookPeopleResult(page, target, options = {}) {
  const resolved = await resolveFacebookTargetProfile(page, target);
  const actionResult = await followOrAddFacebookProfile(page, resolved.profileUrl, options);
  return {
    ...resolved,
    ...actionResult,
  };
}

async function findLatestFacebookProfilePost(page) {
  await waitForAppShell(page, 'facebook');
  await minimalDelay(1000);

  for (let pass = 0; pass < 8; pass += 1) {
    const articles = page.locator([
      '[role="main"] [role="article"]',
      '[data-pagelet*="ProfileTimeline"] [role="article"]',
      '[role="main"] div:has([aria-label*="Comment"]):has([aria-label*="Like"])',
    ].join(', '));
    const count = Math.min(await articles.count().catch(() => 0), 24);

    for (let index = 0; index < count; index += 1) {
      const article = articles.nth(index);
      if (!await article.isVisible().catch(() => false)) continue;

      const score = await article.evaluate((node) => {
        const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
        const rect = node.getBoundingClientRect();
        const hrefs = Array.from(node.querySelectorAll('a[href]')).map((a) => a.href || '');
        const buttonText = Array.from(node.querySelectorAll('[role="button"], button'))
          .map((button) => `${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`)
          .join(' ');
        const hasComment = /(^|\s)Comment(\s|$)|comment/i.test(buttonText);
        const hasLike = /(^|\s)Like(\s|$)|Remove Like|Unlike|React/i.test(buttonText);
        const hasPostPermalink = hrefs.some((href) => /\/posts\/|story_fbid=|\/photos\//i.test(href));
        const isReelOrVideoOnly = hrefs.some((href) => /\/reel\/|\/reels\/|\/videos\/|\/watch\//i.test(href)) && !hasPostPermalink;
        const isNonPostPanel = /^(Intro|Photos|Friends|Reels|Videos)\b/i.test(text) ||
          /People you may know|Suggested for you|Sponsored|What's on your mind/i.test(text);

        if (rect.width < 280 || rect.height < 80) return 0;
        if (isNonPostPanel || !hasComment || !hasLike) return 0;
        if (isReelOrVideoOnly && text.length < 80) return 0;

        let value = 1;
        if (hasPostPermalink) value += 2;
        if (text.length > 80) value += 1;
        if (rect.top >= 80 && rect.left > 250 && rect.left < window.innerWidth - 280) value += 1;
        return value;
      }).catch(() => 0);

      if (score > 0) {
        await article.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
        await minimalDelay(500);
        return article;
      }
    }

    await page.mouse.wheel(0, pass === 0 ? 700 : 1000).catch(() => {});
    await minimalDelay(900);
  }

  return null;
}

async function likeFacebookPostArticle(article) {
  const alreadyLiked = await article.locator(
    '[aria-label="Remove Like"], [aria-label*="Unlike"], div[role="button"]:has-text("Liked")',
  ).first().isVisible().catch(() => false);

  if (alreadyLiked) {
    return { liked: true, alreadyLiked: true };
  }

  const likeButton = article.locator(
    '[aria-label="Like"], [aria-label^="Like "], div[role="button"]:has-text("Like"), button:has-text("Like")',
  ).first();

  if (!await likeButton.count().catch(() => 0)) {
    return { liked: false, alreadyLiked: false };
  }

  await likeButton.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
  await likeButton.click({ timeout: 3000 }).catch(() => {});
  await minimalDelay(700);
  return { liked: true, alreadyLiked: false };
}

async function commentFacebookPostArticle(page, article, comment, options = {}) {
  const { send = true } = options;
  const commentSelectors = [
    'div[aria-label="Write a comment"][contenteditable="true"]',
    'div[aria-label*="comment"][contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    'div[data-lexical-editor="true"]',
  ];

  const commentButton = article.locator(
    '[aria-label="Comment"], [aria-label*="Comment"], div[role="button"]:has-text("Comment"), button:has-text("Comment")',
  ).first();

  if (await commentButton.count().catch(() => 0)) {
    await commentButton.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
    await commentButton.click({ timeout: 3000 }).catch(() => {});
    await minimalDelay(700);
  }

  let commentBox = await firstVisibleLocator(article, commentSelectors);
  if (!commentBox) {
    commentBox = await firstVisibleLocator(page, [
      '[role="dialog"] div[aria-label*="comment"][contenteditable="true"]',
      '[role="dialog"] div[role="textbox"][contenteditable="true"]',
      ...commentSelectors,
    ]);
  }

  if (!commentBox) {
    throw new Error('Facebook comment composer was not found');
  }

  await commentBox.click({ timeout: 3000 }).catch(() => {});
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+a`).catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await commentBox.type(comment, { delay: 18 }).catch(() => {});

  const typed = await commentBox.innerText().catch(() => '');
  if (!typed.trim()) {
    throw new Error('Could not fill Facebook comment composer');
  }

  if (send) {
    await page.keyboard.press('Enter').catch(() => {});
    await minimalDelay(1000);
  }
  return true;
}

async function openFacebookPostComposer(page) {
  await navigate(page, PLATFORM_URLS.facebook, 'facebook');
  await waitForAppShell(page, 'facebook');
  await minimalDelay(1000);

  const composerTriggers = [
    'div[role="button"]:has-text("What\'s on your mind")',
    'span:has-text("What\'s on your mind")',
    'div[aria-label*="Create a post"]',
    'div[role="button"][aria-label*="post"]',
    '[data-testid="status-attachment-input"]',
  ];

  for (const selector of composerTriggers) {
    const trigger = page.locator(selector).first();
    if (await trigger.isVisible().catch(() => false)) {
      await trigger.click({ timeout: 3000 }).catch(() => {});
      break;
    }
  }

  await minimalDelay(1200);
  const dialog = page.locator('[role="dialog"]:has-text("Create post")').first();
  if (!await dialog.isVisible().catch(() => false)) {
    throw new Error('Facebook Create post dialog did not open');
  }
  return dialog;
}

async function fillFacebookPostComposer(page, text) {
  const composerSelectors = [
    '[role="dialog"] div[aria-label*="What\'s on your mind"][contenteditable]',
    '[role="dialog"] div[aria-placeholder*="What\'s on your mind"][contenteditable]',
    '[role="dialog"] div[role="textbox"][contenteditable]',
    '[role="dialog"] div[data-lexical-editor="true"][contenteditable]',
    'div[aria-label*="What\'s on your mind"][contenteditable]',
    'div[role="textbox"][contenteditable]',
  ];

  const composer = await firstVisibleLocator(page, composerSelectors);
  if (!composer) {
    throw new Error('Could not find Facebook post text box');
  }

  await composer.click({ timeout: 3000 }).catch(() => {});
  await composer.type(text, { delay: 18 }).catch(() => {});
  await minimalDelay(500);

  const typed = await composer.innerText().catch(() => '');
  if (!typed.trim()) {
    throw new Error('Could not fill Facebook post composer');
  }

  return composer;
}

async function publishFacebookPost(page) {
  const posted = await submitComposer(page, [
    '[role="dialog"] [aria-label="Post"]:not([aria-disabled="true"])',
    '[role="dialog"] div[role="button"]:has-text("Post"):not([aria-disabled="true"])',
    '[role="dialog"] button:has-text("Post"):not([disabled])',
  ], ['Post'], { timeout: 7000 });

  if (!posted) {
    throw new Error('Facebook Post button was not enabled or not found');
  }
  await minimalDelay(1500);
  return true;
}

async function findFacebookMessageComposer(page) {
  const selector = [
    'div[aria-label="Message"][role="textbox"][contenteditable="true"]',
    'div[aria-label*="Message"][role="textbox"][contenteditable="true"]',
    'div[aria-label="Aa"][contenteditable="true"]',
    'div[aria-placeholder="Aa"][contenteditable="true"]',
    'div[aria-placeholder*="message"][contenteditable="true"]',
    'div[data-testid="mw_message_input"][contenteditable="true"]',
    'div[data-testid="message-composer-input"][contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    'div[data-lexical-editor="true"][contenteditable="true"]',
    'textarea',
  ].join(', ');

  const candidates = page.locator(selector);
  const count = Math.min(await candidates.count().catch(() => 0), 40);
  let fallback = null;

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (!await candidate.isVisible().catch(() => false)) continue;

    const meta = await candidate.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const labels = [
        el.getAttribute('aria-label') || '',
        el.getAttribute('aria-placeholder') || '',
        el.getAttribute('placeholder') || '',
        el.getAttribute('data-testid') || '',
        el.closest('[role="dialog"], [aria-label]')?.getAttribute('aria-label') || '',
      ].join(' ').toLowerCase();
      const text = (el.textContent || '').trim().toLowerCase();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        labels,
        text,
      };
    }).catch(() => null);

    if (!meta || meta.width < 80 || meta.height < 18) continue;
    if (/search|comment|reply|what's on your mind|create post/.test(meta.labels)) continue;

    const looksLikeMessage = /message|messenger|mw_message|composer|aa/.test(meta.labels);
    const bottomChatPopup = meta.x > 900 && meta.y > 500;
    const fullMessengerComposer = meta.y > 400 && meta.width > 250;

    if (looksLikeMessage || bottomChatPopup || fullMessengerComposer) {
      return candidate;
    }

    fallback ||= candidate;
  }

  return fallback;
}

async function fillFacebookMessageComposer(page, message) {
  const composer = await findFacebookMessageComposer(page);
  if (!composer) {
    throw new Error('Could not find Facebook message composer');
  }

  await composer.click({ timeout: 3000 }).catch(() => {});
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+a`).catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await composer.type(message, { delay: 18 }).catch(() => {});
  await minimalDelay(400);

  const typed = await composer.innerText().catch(async () => composer.inputValue().catch(() => ''));
  if (!typed.trim()) {
    throw new Error('Could not fill Facebook message composer');
  }

  return composer;
}

async function sendFacebookMessage(page) {
  const sent = await submitComposer(page, [
    'div[aria-label="Send"]',
    'div[aria-label*="Send"]',
    'button[aria-label*="Send"]',
    '[data-testid="send"]',
  ], ['Send'], { timeout: 4000 });

  if (sent) return true;

  await page.keyboard.press('Enter').catch(() => {});
  await minimalDelay(800);
  return true;
}

async function openFacebookMessageFromInbox(page, username) {
  // Strategy: Navigate to Facebook Messenger and search for user
  try {
    await navigate(page, 'https://www.facebook.com/messages', 'facebook');
    await waitForAppShell(page, 'facebook');
    await minimalDelay(800);

    // Look for "New message" button
    const newMessageSelectors = [
      'a[href="/messages/new/"]',
      'button:has-text("New message")',
      'div[role="button"]:has-text("New message")',
      '[aria-label="New message"]',
    ];

    let opened = await tryClick(page, newMessageSelectors);
    if (!opened) {
      opened = await clickByText(page, ['button', 'a', 'div[role="button"]'], ['New message']);
    }

    if (!opened) {
      return false;
    }

    await waitForAppShell(page, 'facebook');
    await minimalDelay(500);

    // Find search input
    const searchBox = await firstVisibleLocator(page, [
      'input[placeholder*="Search"]',
      'input[aria-label*="Search"]',
      'input[type="text"]',
      'input[role="combobox"]',
    ]);

    if (!searchBox) {
      return false;
    }

    // Type username
    await searchBox.click().catch(() => {});
    await searchBox.fill('').catch(() => {});
    await searchBox.type(username, { delay: 20 }).catch(() => {});
    await minimalDelay(1000);

    // Click on user result
    const userResultSelectors = [
      `div[role="option"]:has-text("${username}")`,
      'div[role="option"]',
      'div[role="listitem"]',
      'li div[role="button"]',
    ];

    for (const selector of userResultSelectors) {
      const result = page.locator(selector).first();
      if (await result.isVisible().catch(() => false)) {
        await result.click().catch(() => {});
        await minimalDelay(800);
        break;
      }
    }

    // Verify composer is available
    const composer = await firstVisibleLocator(page, [
      'div[contenteditable="true"]',
      'div[role="textbox"]',
      'textarea',
    ]);

    return !!composer;
  } catch (error) {
    console.log('[Facebook] Inbox search error:', error.message);
    return false;
  }
}

async function openFacebookMessage(page, username) {
  // Facebook DM rules:
  // 1. Best case: Already friends - Message button available
  // 2. Not friends but Message button visible (some pages/public figures allow this)
  // 3. Not friends, need to add friend first - will show Add Friend
  // 4. Can follow instead (pages/public figures)
  // 5. Can't message at all - no Message button and can't add friend

  const friendStatus = await checkFacebookFriendStatus(page);

  if (!friendStatus.isValidProfile) {
    throw new Error(`Cannot message ${username}. Profile not found or content unavailable.`);
  }

  if (friendStatus.isOwnProfile) {
    throw new Error(`Cannot message yourself (${username})`);
  }

  // Try multiple Message button selectors
  const messageSelectors = [
    'button:has-text("Message")',
    'a:has-text("Message")',
    'div[role="button"]:has-text("Message")',
    '[aria-label="Message"]',
    '[data-testid="message-button"]',
    'div[aria-label="Message"]',
  ];

  let clicked = await tryClick(page, messageSelectors);

  if (!clicked) {
    // Try clicking by text with broader search
    clicked = await clickByText(page, ['a', 'div[role="button"]', 'button', 'span'], ['Message', 'Messages']);
  }

  await minimalDelay(1200);

  let composer = await findFacebookMessageComposer(page);
  if (clicked && composer) {
    return {
      type: 'message',
      canSend: true,
      isFriend: friendStatus.isFriend,
      requestPending: friendStatus.requestPending,
      friendRequestSent: false,
    };
  }

  if (!clicked && friendStatus.requestPending) {
    throw new Error(`Cannot message ${username}. Friend request already pending and no Message button was available.`);
  }

  // If no Message button and we can add friend, send friend request
  if (!clicked && friendStatus.canAddFriend) {
    const addFriendSelectors = [
      'button:has-text("Add friend")',
      'button:has-text("Add Friend")',
      'div[role="button"]:has-text("Add friend")',
      '[data-testid="friend-add-button"]',
    ];

    const friendRequestSent = await tryClick(page, addFriendSelectors);

    if (friendRequestSent) {
      await waitForAppShell(page, 'facebook');
      await minimalDelay(800);

      // Re-check status after adding friend
      const newStatus = await checkFacebookFriendStatus(page);

      if (newStatus.isFriend) {
        // Try message button again after becoming friends (rare but possible)
        clicked = await tryClick(page, messageSelectors);
      }

      if (!clicked) {
        // Still no message button - friend request is pending
        throw new Error(`Cannot message ${username}. Friend request sent - you'll be able to message once they accept.`);
      }
    }
  }

  // If we can follow (pages/public figures), follow then try message again
  if (!clicked && friendStatus.canFollow) {
    const followSelectors = [
      'button:has-text("Follow")',
      'div[role="button"]:has-text("Follow")',
    ];

    const followed = await tryClick(page, followSelectors) ||
                     await clickByText(page, ['button', 'div[role="button"]'], ['Follow']);

    if (followed) {
      await waitForAppShell(page, 'facebook');
      await minimalDelay(500);

      // Try message button again after following
      clicked = await tryClick(page, messageSelectors);

      if (!clicked) {
        throw new Error(`Followed ${username} but cannot message. Some Facebook pages only allow messaging from friends.`);
      }
    }
  }

  if (!clicked) {
    throw new Error(`Could not open Facebook message for ${username}. You may need to be friends first, or they may have restricted messaging.`);
  }

  await waitForAppShell(page, 'facebook');
  await minimalDelay(1000); // Facebook messenger takes longer to load

  composer = await findFacebookMessageComposer(page);

  if (!composer) {
    // Might have opened in messenger.com in new tab
    const currentUrl = page.url();
    if (currentUrl.includes('messenger.com') || currentUrl.includes('/messages/') || currentUrl.includes('/t/')) {
      await waitForAppShell(page, 'facebook');
      await minimalDelay(1500);

      const messengerComposer = await findFacebookMessageComposer(page);

      if (!messengerComposer) {
        throw new Error(`Messenger opened but could not find composer for ${username}`);
      }
    } else {
      throw new Error(`Could not open Facebook message composer for ${username}`);
    }
  }

  return {
    type: 'message',
    canSend: true,
    isFriend: friendStatus.isFriend,
    friendRequestSent: !friendStatus.isFriend && friendStatus.canAddFriend,
  };
}

// Base social handler for non-DM actions
const baseHandler = createSocialHandler('facebook', {
  async openMessage(page, username) {
    await openFacebookMessage(page, username);
  },
  messageComposerSelectors: ['div[role="textbox"][contenteditable="true"]', 'textarea'],
  async sendMessage(page) {
    await page.keyboard.press('Enter').catch(() => {});
  },
  followLabels: ['Follow', 'Add friend'],
  async openLatestPost(page) {
    const postLinks = await page.locator('a[href*="/posts/"], a[href*="/photos/"]').all();
    if (postLinks.length > 0) {
      await postLinks[0].click().catch(() => {});
      await waitForAppShell(page, 'facebook');
      await minimalDelay(1000);
    }
  },
  async likePost(page) {
    await clickByText(page, ['div[role="button"]', 'button'], ['Like']).catch(() => {});
  },
  commentSelectors: ['div[role="textbox"][contenteditable="true"]'],
  async sendComment(page) {
    await page.keyboard.press('Enter').catch(() => {});
  },
  async openPostComposer(page) {
    // Try multiple strategies to open Facebook post composer
    const createSelectors = [
      'div[role="button"][aria-label*="Create"]',
      'div[role="button"][aria-label*="post"]',
      'div[role="button"]:has-text("What")',
      'span:has-text("What")',
      'div[role="button"]:has-text("Create post")',
      '[aria-label="Create a post"]',
      '[data-testid="status-attachment-input"]',
    ];
    for (const selector of createSelectors) {
      try {
        const el = await page.locator(selector).first();
        if (await el.count() > 0 && await el.isVisible()) {
          await el.click({ timeout: 3000 });
          await minimalDelay(1000);
          break;
        }
      } catch { /* continue */ }
    }
    await waitForAppShell(page, 'facebook');
  },
  postComposerSelectors: [
    'div[aria-label*="What"][contenteditable="true"]',
    'div[aria-label*="mind"][contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    'div[data-lexical-editor="true"][contenteditable="true"]',
  ],
  publishPostSelectors: [
    'button:has-text("Post")',
    'div[role="button"]:has-text("Post")',
    '[aria-label="Post"]',
    '[data-testid="react-composer-post-button"]',
  ],
  publishPostLabels: ['Post', 'Share'],
  async attachMedia(page, filePath) {
    // Facebook-specific media upload
    try {
      // Look for file input directly
      const fileInput = await page.locator('input[type="file"]').first();
      if (await fileInput.count() > 0) {
        await fileInput.setInputFiles(filePath);
        await minimalDelay(3000);
        return true;
      }
      
      // Try clicking photo/video button first
      const photoBtn = await page.locator('button[aria-label*="photo"], button[aria-label*="video"], input[accept*="image"]').first();
      if (await photoBtn.count() > 0) {
        const isInput = await photoBtn.evaluate(el => el.tagName === 'INPUT').catch(() => false);
        if (isInput) {
          await photoBtn.setInputFiles(filePath);
        } else {
          await photoBtn.click();
          await minimalDelay(1000);
          const input = await page.locator('input[type="file"]').first();
          if (await input.count() > 0) {
            await input.setInputFiles(filePath);
          }
        }
        await minimalDelay(3000);
        return true;
      }
    } catch (e) {
      console.warn('[Facebook] Media upload failed:', e.message);
    }
    return false;
  },
});

// Enhanced handler with proper Facebook-specific DM flow
export const facebookHandler = {
  platform: 'facebook',
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;

    // Check login state for actions that require auth
    if (['send_message', 'draft_message', 'open_target', 'message_batch', 'follow_user', 'follow_search', 'add_friend', 'bulk_add_friends', 'engage_post', 'like_post', 'comment_post'].includes(action)) {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.facebook, { platform: 'facebook' });
      const state = await checkLoginState(page, 'facebook');
      if (!state.ready) {
        throw new Error(state.message || 'Please log in to Facebook');
      }
    }

    // Handle DM-specific actions with custom Facebook flow
    if (action === 'open_target') {
      const { username } = args;
      if (!username) {
        throw new Error('Facebook open_target requires a username');
      }

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.facebook, { platform: 'facebook' });
      const resolved = await openResolvedFacebookTarget(page, username);

      // Check friend status
      const friendStatus = await checkFacebookFriendStatus(page);

      return {
        status: 'ready',
        summary: summarizeAction('facebook', step),
        data: { ...await pageSnapshot(page), friendStatus, matchedProfile: resolved.matchedProfile },
      };
    }

    if (action === 'draft_message') {
      const { username, messageGoal, tone, query } = args;

      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'facebook',
        chatContext: [],
        profileInfo: {},
      });

      return {
        status: 'ready',
        summary: summarizeAction('facebook', step),
        data: { preview: message },
      };
    }

    if (action === 'send_message') {
      const { username, messageGoal, tone, query, requireManualReview, attachmentPath, attachmentType } = args;

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.facebook, { platform: 'facebook' });
      let messageStatus;

      // Profile-first is more reliable on Facebook: the visible profile header can expose
      // a Message button even when Messenger search cannot select the recipient.
      try {
        await openResolvedFacebookTarget(page, username);
        messageStatus = await openFacebookMessage(page, username);
      } catch (profileError) {
        console.log(`[Facebook] Profile message failed for ${username}, trying Messenger search... ${profileError.message}`);
        const openedViaInbox = await openFacebookMessageFromInbox(page, username);

        if (!openedViaInbox) {
          const connectionResult = await followOrAddFacebookProfile(page, page.url(), { prefer: 'add_friend' }).catch(() => null);
          if (connectionResult?.status === 'completed') {
            return {
              status: 'completed',
              summary: `Could not message ${username}; ${connectionResult.action.replace(/_/g, ' ')} on Facebook`,
              data: {
                page: await pageSnapshot(page),
                message: '',
                sent: false,
                connectionAction: connectionResult.action,
                reason: profileError.message,
              },
            };
          }

          throw new Error(`Could not message ${username} on Facebook. ${profileError.message || 'They may restrict messages to friends.'}`);
        }

        messageStatus = { type: 'message', canSend: true, method: 'messenger_search' };
      }

      // Extract chat context AND full profile context
      const chatContext = await extractChatContext(page, 'facebook', 6);
      
      // Extract comprehensive profile info (work, education, bio)
      console.log(`[Facebook] Extracting full profile context for ${username}...`);
      const rawProfileInfo = await extractProfileContext(page, 'facebook', username);
      const profileInfo = formatProfileContext(rawProfileInfo, 'facebook');
      console.log(`[Facebook] Profile context: ${rawProfileInfo.work || 'no work info'}, ${rawProfileInfo.education || 'no education info'}`);

      // Generate message with FULL context
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'facebook',
        chatContext,
        profileInfo,
      });

      await fillFacebookMessageComposer(page, message);

      // Send if not manual review
      let sent = false;
      if (!requireManualReview) {
        sent = await sendFacebookMessage(page);
      }

      return {
        status: 'completed',
        summary: summarizeAction('facebook', step, { sent }),
        data: { page: await pageSnapshot(page), message, sent, ...messageStatus },
      };
    }

    if (action === 'message_batch') {
      const usernames = (args.usernames || []).slice(0, Math.max(1, Math.min(Number(args.maxResults) || 10, 10))); // Lower limit for Facebook
      const results = [];

      for (const username of usernames) {
        try {
          const result = await this.execute({
            step: {
              action: 'send_message',
              platform: 'facebook',
              args: { ...args, username },
            },
            attachedBrowser,
          });
          results.push({ username, ...result });
          // Longer random delay for Facebook (more restrictive)
          await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000));
        } catch (error) {
          results.push({ username, error: error.message, status: 'failed' });
        }
      }

      return {
        status: 'completed',
        summary: `Processed ${usernames.length} Facebook DM targets`,
        data: results,
      };
    }

    if (['engage_post', 'like_post', 'comment_post'].includes(action)) {
      const target = args.username || args.query || args.prompt;
      if (!target) {
        throw new Error(`Facebook ${action} requires a target username or name`);
      }

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.facebook, { platform: 'facebook' });
      const resolved = await openResolvedFacebookTargetPosts(page, target);
      const postArticle = await findLatestFacebookProfilePost(page);

      if (!postArticle) {
        throw new Error(`Could not find a recent profile feed post for "${target}"`);
      }

      let liked = false;
      let alreadyLiked = false;
      let comment = '';
      let commented = false;

      if (action === 'like_post' || action === 'engage_post') {
        const likeResult = await likeFacebookPostArticle(postArticle);
        liked = likeResult.liked;
        alreadyLiked = likeResult.alreadyLiked;
        if (!liked && action === 'like_post') {
          throw new Error(`Could not find a Like button on the latest profile feed post for "${target}"`);
        }
      }

      if (action === 'comment_post' || action === 'engage_post') {
        comment = await composeComment({ tone: args.tone, goal: args.messageGoal || args.query || args.prompt });
        commented = await commentFacebookPostArticle(page, postArticle, comment, { send: !args.requireManualReview });
      }

      return {
        status: 'completed',
        summary: action === 'like_post'
          ? `Liked latest Facebook post for ${target}`
          : args.requireManualReview
            ? `Drafted Facebook comment for ${target}`
            : `Engaged with latest Facebook post for ${target}`,
        data: {
          page: await pageSnapshot(page),
          matchedProfile: resolved.matchedProfile,
          liked,
          alreadyLiked,
          comment,
          commented,
          sent: commented && !args.requireManualReview,
        },
      };
    }

    if (action === 'compose_post' || action === 'publish_post') {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.facebook, { platform: 'facebook' });
      const postText = await composePost({
        platform: 'facebook',
        goal: args.messageGoal,
        tone: args.tone,
        query: args.query,
      });

      await openFacebookPostComposer(page);
      await fillFacebookPostComposer(page, postText);

      let sent = false;
      if (action === 'publish_post' && !args.requireManualReview) {
        sent = await publishFacebookPost(page);
      }

      return {
        status: 'completed',
        summary: sent ? 'Submitted Facebook post' : 'Drafted Facebook post',
        data: {
          page: await pageSnapshot(page),
          postText,
          sent,
        },
      };
    }

    if (action === 'scrape_results') {
      const { query, prompt, maxResults = 10 } = args;
      const searchQuery = String(query || prompt || '').trim();
      if (!searchQuery) {
        throw new Error('Facebook scrape_results requires a search query');
      }

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.facebook, { platform: 'facebook' });
      const results = await collectFacebookPeopleResults(page, searchQuery, maxResults);

      return {
        status: 'completed',
        summary: `Collected ${results.length} Facebook people results for "${searchQuery}"`,
        data: {
          page: await pageSnapshot(page),
          results: results.map((item) => ({
            title: item.name,
            url: item.profileUrl,
            snippet: item.snippet,
            type: 'profile',
          })),
        },
      };
    }

    // ACTION: Search Facebook People and follow/add friend each visible result
    if (action === 'follow_search') {
      const { query, prompt, searchQuery: explicitSearchQuery, maxResults = 10 } = args;
      const searchQuery = String(explicitSearchQuery || query || prompt || '').trim();
      if (!searchQuery) {
        throw new Error('Facebook follow_search requires a search query');
      }

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.facebook, { platform: 'facebook' });
      console.log(`[Facebook] Searching people for "${searchQuery}" and following/adding up to ${maxResults} results...`);

      const profiles = await collectFacebookPeopleResults(page, searchQuery, maxResults);
      const results = [];

      for (const profile of profiles) {
        try {
          const actionResult = await followOrAddFacebookProfile(page, profile.profileUrl);
          results.push({ ...profile, ...actionResult });
          await minimalDelay(2200 + Math.random() * 1400);
        } catch (error) {
          results.push({ ...profile, status: 'failed', error: error.message });
        }
      }

      const completed = results.filter((item) => item.status === 'completed').length;
      return {
        status: 'completed',
        summary: `Followed or added ${completed}/${profiles.length} Facebook people from "${searchQuery}"`,
        data: { query: searchQuery, results },
      };
    }

    // ACTION: Search the target name/username, open first people result, then add friend/follow
    if (action === 'follow_user') {
      const target = args.username || args.profileUrl || args.query || args.prompt;
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.facebook, { platform: 'facebook' });
      console.log(`[Facebook] Searching first people result for "${target}" before follow/add friend...`);

      const result = await followFirstFacebookPeopleResult(page, target, { prefer: 'add_friend' });
      if (result.status === 'failed') {
        throw new Error(result.reason || `Could not add/follow ${target} on Facebook`);
      }

      return {
        status: result.status === 'skipped' ? 'completed' : result.status,
        summary: `${result.action.replace(/_/g, ' ')} for ${target} on Facebook`,
        data: result,
      };
    }

    // ACTION: Add friend
    if (action === 'add_friend') {
      const username = args.username || args.profileUrl;
      console.log(`[Facebook] Adding ${username} as friend...`);

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.facebook, { platform: 'facebook' });
      const result = await followFirstFacebookPeopleResult(page, username, { prefer: 'add_friend' });
      if (result.status === 'failed') {
        throw new Error(result.reason || `Could not find Follow or Add Friend button for ${username}`);
      }

      return {
        status: result.status === 'skipped' ? 'completed' : result.status,
        summary: `${result.action.replace(/_/g, ' ')} for ${username} on Facebook`,
        data: { username, ...result },
      };
    }
    
    // ACTION: Bulk add friends from People You May Know
    if (action === 'bulk_add_friends') {
      const { maxResults = 10 } = args;
      console.log(`[Facebook] Bulk adding friends from suggestions...`);

      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.facebook, { platform: 'facebook' });
      
      // Navigate to People You May Know
      await navigate(page, 'https://www.facebook.com/friends/suggestions', 'facebook');
      await waitForAppShell(page, 'facebook');
      await minimalDelay(1500);
      
      // Extract suggested friends
      const profiles = await page.evaluate((limit) => {
        const results = [];
        // Look for friend suggestion cards
        const cards = document.querySelectorAll('[data-testid="friend_list_item"], [role="article"], div[data-pagelet="PYMK"] > div > div');
        
        for (let i = 0; i < Math.min(cards.length, limit); i++) {
          const card = cards[i];
          // Try to find profile link
          const linkEl = card.querySelector('a[href*="/"][role="link"]');
          if (linkEl) {
            const href = linkEl.getAttribute('href');
            const match = href?.match(/\/([^/]+)\/?$/);
            if (match) {
              const username = match[1];
              if (username && username !== 'friends' && username !== 'pages') {
                results.push({ username, name: linkEl.textContent?.trim() });
              }
            }
          }
        }
        return results;
      }, maxResults);
      
      console.log(`[Facebook] Found ${profiles.length} people to add`);
      
      const results = [];
      for (const profile of profiles) {
        try {
          const result = await followOrAddFacebookProfile(page, profile.username);
          results.push({ username: profile.username, ...result });
          await minimalDelay(2000 + Math.random() * 1000);
        } catch (error) {
          results.push({ username: profile.username, error: error.message, status: 'failed' });
        }
      }
      
      return {
        status: 'completed',
        summary: `Sent ${results.filter(r => r.status === 'completed').length}/${profiles.length} friend requests`,
        data: { results }
      };
    }
    
    // Delegate all other actions to base handler
    return baseHandler.execute({ step, attachedBrowser });
  },
};
