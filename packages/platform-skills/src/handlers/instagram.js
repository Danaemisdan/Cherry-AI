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
  console.log(`[Instagram] DM Contact: navigating to inbox and searching left rail...`);

  await navigate(page, 'https://www.instagram.com/direct/inbox/', 'instagram');
  await waitForAppShell(page, 'instagram');
  await minimalDelay(1500);

  // Find the search input in the left rail
  const searchInput = await firstVisibleLocator(page, [
    'input[placeholder="Search"]',
    'input[aria-label="Search input"]',
    'input[aria-label*="Search"]'
  ]);

  if (!searchInput) {
    console.log('[Instagram] Could not find inbox search bar in left rail');
    return false;
  }

  await searchInput.click();
  await minimalDelay(600 + Math.random() * 800);
  await searchInput.fill('');
  for (const char of username) {
    await searchInput.type(char, { delay: Math.floor(Math.random() * 130) + 50 });
  }
  await minimalDelay(2500 + Math.random() * 1200);

  // Find the matching row in the LEFT RAIL only (left 380px of screen)
  const matchInfo = await page.evaluate((targetName) => {
    const target = targetName.toLowerCase().trim();
    const allEls = Array.from(document.querySelectorAll('div, a')).filter(el => {
      const rect = el.getBoundingClientRect();
      if (rect.left > 380 || rect.width < 60) return false;
      if (rect.height < 40 || rect.height > 120) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return true;
    });
    const getText = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    let bestRow = null;
    for (const el of allEls) {
      const lines = getText(el).split('\n').map(l => l.trim());
      if (lines.some(l => l === target || l.replace(/^@/, '') === target)) { bestRow = el; break; }
    }
    if (!bestRow) {
      for (const el of allEls) {
        if (getText(el).includes(target)) { bestRow = el; break; }
      }
    }
    if (bestRow) {
      const rect = bestRow.getBoundingClientRect();
      return { found: true, x: rect.left + Math.min(80, rect.width / 2), y: rect.top + rect.height / 2, text: getText(bestRow).slice(0, 40) };
    }
    return { found: false };
  }, username);

  if (!matchInfo.found) {
    console.log(`[Instagram] Could not find "${username}" in inbox search results`);
    return false;
  }

  console.log(`[Instagram] Clicking contact row: "${matchInfo.text}" at (${matchInfo.x}, ${matchInfo.y})`);
  await page.mouse.click(matchInfo.x, matchInfo.y);
  await minimalDelay(1500);

  // Confirm the chat panel opened
  const composer = await page.locator('div[contenteditable="true"], textarea').first();
  if (await composer.count() > 0) {
    console.log('[Instagram] Chat panel confirmed open');
    return { success: true, method: 'contact_inbox' };
  }

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
async function likeInstagramPost(page, postUrl) {
  console.log('[Instagram] Liking post...');
  
  if (postUrl) {
    await navigate(page, postUrl, 'instagram');
    await waitForAppShell(page, 'instagram');
    await minimalDelay(800);
  }
  
  const content = await extractPageContent(page);
  // Find like button (Accessibility-first)
  let likeElement = content.interactiveElements.find(e => 
    e.ariaLabel === 'Like' || e.ariaLabel?.includes('Like')
  );
  
  if (!likeElement) {
    const likeBtns = await findElementsByText(page, 'Like', {
      tagNames: ['button', 'svg', 'span'],
      fuzzy: true
    });
    if (likeBtns.length > 0) likeElement = likeBtns[0];
  }
  
  if (likeElement) {
    await page.evaluate(({ tag, index }) => {
      const elements = document.querySelectorAll(tag);
      if (elements[index]) elements[index].click();
    }, { tag: likeElement.tag, index: likeElement.index });
    
    await minimalDelay(500);
    console.log('[Instagram] Post liked');
    return { liked: true };
  }
  
  return { liked: false };
}

// Comment on post
async function commentOnInstagramPost(page, comment, postUrl) {
  console.log('[Instagram] Commenting on post...');
  
  if (postUrl) {
    await navigate(page, postUrl, 'instagram');
    await waitForAppShell(page, 'instagram');
    await minimalDelay(800);
  }
  
  // Find comment box (Accessibility-first)
  let commentBox = [];
  const textareas = await page.locator('textarea[aria-label*="Add a comment"], textarea[placeholder*="Add a comment"]').all();
  if (textareas.length > 0) {
    commentBox = [{ index: -1, element: textareas[0] }];
  } else {
    commentBox = await findElementsByText(page, 'Add a comment', {
      tagNames: ['textarea', 'div[contenteditable="true"]'],
      fuzzy: true
    });
  }
  
  if (commentBox.length === 0) {
    throw new Error('Comment box not found');
  }
  
  // Click and type comment
  if (commentBox[0].index === -1 && commentBox[0].element) {
    await commentBox[0].element.click().catch(() => {});
    await commentBox[0].element.focus().catch(() => {});
  } else {
    await page.evaluate(({ tag, index }) => {
      const elements = document.querySelectorAll(tag);
      if (elements[index]) {
        elements[index].click();
        elements[index].focus();
      }
    }, { tag: commentBox[0].tag, index: commentBox[0].index });
  }
  
  await minimalDelay(200);
  await page.keyboard.type(comment, { delay: 10 });
  await minimalDelay(300);
  
  // Find Post button (NOT Share)
  const postBtn = await findElementsByText(page, 'Post', {
    tagNames: ['button', 'div'],
    fuzzy: false
  });
  
  if (postBtn.length > 0) {
    await page.evaluate(({ tag, index }) => {
      const elements = document.querySelectorAll(tag);
      if (elements[index]) elements[index].click();
    }, { tag: postBtn[0].tag, index: postBtn[0].index });
    
    await minimalDelay(500);
    console.log('[Instagram] Comment posted');
    return { commented: true };
  }
  
  // Fallback to Enter
  await page.keyboard.press('Enter');
  await minimalDelay(500);
  
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
    
    // Check login state
    if (['send_message', 'draft_message', 'open_target', 'message_batch', 'like_post', 'comment_post'].includes(action)) {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.instagram, { platform: 'instagram' });
      const state = await checkLoginState(page, 'instagram');
      if (!state.ready) {
        throw new Error(state.message || 'Please log in to Instagram');
      }
    }
    
    const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.instagram, { platform: 'instagram' });
    
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
      
      // STEP 2: Try messaging methods
      let chatOpened = null;
      let methodUsed = null;
      const triedMethods = new Set();
      
      if (operation === 'auto_dm_contact') {
        triedMethods.add('contact_inbox');
        chatOpened = await messageContactViaInbox(page, username);
        if (chatOpened) methodUsed = 'contact_inbox';
      } else if (operation === 'auto_dm_new' || operation === 'auto_dm') {
        triedMethods.add('new_message_modal');
        chatOpened = await messageViaInbox(page, username);
        if (chatOpened) methodUsed = 'new_message_modal';
      }
      
      // Method: Inbox (Fallback if not explicitly defined above, or if defined but failed)
      if (!chatOpened && !['auto_dm_contact', 'auto_dm_new', 'auto_dm'].includes(operation)) {
        triedMethods.add('inbox');
        chatOpened = await messageViaInbox(page, username);
        if (chatOpened) methodUsed = 'inbox';
      }
      
      // Method 2: Profile (if inbox failed or not suitable AND we aren't restricted to inbox)
      if (!chatOpened && profileContext.canMessage && !['auto_dm_contact', 'auto_dm_new', 'auto_dm'].includes(operation)) {
        triedMethods.add('profile');
        chatOpened = await messageViaProfile(page, username);
        if (chatOpened) methodUsed = 'profile';
      }
      
      // Method 3: Explore
      if (!chatOpened && !['auto_dm_contact', 'auto_dm_new', 'auto_dm'].includes(operation)) {
        triedMethods.add('explore');
        chatOpened = await messageViaExplore(page, username);
        if (chatOpened) methodUsed = 'explore';
      }
      
      // Ultimate fallback to generic inbox method if the specific one failed
      if (!chatOpened && !triedMethods.has('new_message_modal') && !triedMethods.has('inbox')) {
         chatOpened = await messageViaInbox(page, username);
         if (chatOpened) methodUsed = 'fallback_inbox';
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
      const { postUrl } = args;
      const result = await likeInstagramPost(page, postUrl);
      
      return {
        status: 'completed',
        summary: summarizeAction('instagram', step),
        data: result
      };
    }
    
    // ACTION: Comment on post
    if (action === 'comment_post') {
      const { postUrl, comment, messageGoal, tone, query } = args;
      
      // Generate AI comment if not provided
      let finalComment = comment;
      if (!finalComment && messageGoal) {
        finalComment = await generateOutreachMessage({
          username: 'post',
          goal: messageGoal,
          tone,
          query,
          platform: 'instagram',
          chatContext: [],
          profileInfo: {}
        });
      }
      
      const result = await commentOnInstagramPost(page, finalComment, postUrl);
      
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
        const postBtn = await page.locator('div[role="button"]:has-text("Post"), button:has-text("Post")').first();
        if (await postBtn.count() > 0 && await postBtn.isVisible()) {
          await postBtn.click().catch(() => {});
          await minimalDelay(1500);
          return true;
        }
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
