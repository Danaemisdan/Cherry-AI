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
        await page.evaluate((index) => {
          const elements = document.querySelectorAll('a, div, span');
          if (elements[index]) elements[index].click();
        }, result.index);
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

// Method 1: Message via inbox search - OPTIMIZED FOR SPEED
async function messageViaInbox(page, username) {
  console.log(`[Instagram] Method 1: Inbox messaging...`);
  
  // Navigate directly to inbox - fastest
  await navigate(page, 'https://www.instagram.com/direct/inbox/', 'instagram');
  await waitForAppShell(page, 'instagram');
  
  // Click "New message"
  const newMsgClicked = await tryClick(page, [
    'button:has-text("New message")',
    'button[aria-label="New message"]',
    'svg[aria-label="New message"]',
  ]);
  
  if (!newMsgClicked) {
    console.log('[Instagram] New message button not found');
    return false;
  }
  
  // Type username quickly
  await page.keyboard.type(username, { delay: 10 });
  await minimalDelay(800); // Just enough for results
  
  // Extract and find results
  const content = await extractPageContent(page);
  const userResults = content.interactiveElements.filter(e => 
    e.text.toLowerCase().includes(username.toLowerCase()) && 
    e.visible !== false
  );
  
  if (userResults.length === 0) {
    return false;
  }
  
  // Click first valid result
  const bestMatch = userResults.find(r => 
    r.text.length > username.length && !r.text.includes('To:')
  ) || userResults[0];
  
  await page.evaluate((index) => {
    document.querySelectorAll('div[role="button"], div[role="dialog"] div')[index]?.click();
  }, bestMatch.index);
  
  await minimalDelay(500);
  
  // Click Chat button if present
  const chatButton = await findElementsByText(page, 'Chat', {
    tagNames: ['button', 'div'],
    fuzzy: false
  });
  
  if (chatButton.length > 0) {
    await page.evaluate((index) => {
      document.querySelectorAll('button, div')[index]?.click();
    }, chatButton[0].index);
    await minimalDelay(300);
  }
  
  // Quick composer check
  const composer = await findElementsByText(page, '', {
    tagNames: ['textarea', 'div[contenteditable="true"]'],
    fuzzy: true
  });
  
  if (composer.length > 0) {
    return { success: true, method: 'inbox' };
  }
  
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
    'button:has-text("Message")',
    'button[aria-label="Message"]',
  ]);
  
  if (!msgClicked) {
    const msgButtons = await findElementsByText(page, 'Message', {
      tagNames: ['button', 'div'],
      fuzzy: false
    });
    if (msgButtons.length > 0) {
      await page.evaluate((index) => {
        document.querySelectorAll('button')[index]?.click();
      }, msgButtons[0].index);
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
    await page.evaluate((index) => {
      document.querySelectorAll('a, div')[index]?.click();
    }, results[0].index);
    
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
  const composerResults = await findElementsByText(page, '', {
    tagNames: ['textarea', 'div[contenteditable="true"]'],
    fuzzy: true
  });
  
  if (composerResults.length === 0) {
    throw new Error('Message composer not found');
  }
  
  // Click composer and type
  await page.evaluate((index) => {
    const elements = document.querySelectorAll('textarea, div[contenteditable="true"]');
    if (elements[index]) {
      elements[index].click();
      elements[index].focus();
    }
  }, composerResults[0].index);
  
  await minimalDelay(200);
  await page.keyboard.type(message, { delay: 10 });
  
  // Handle attachment if provided
  if (attachmentPath) {
    console.log('[Instagram] Attaching media...');
    try {
      // Look for attachment button
      const attachBtn = await findElementsByText(page, 'Gallery', {
        tagNames: ['button', 'svg', 'div'],
        fuzzy: true
      });
      
      if (attachBtn.length > 0) {
        await page.evaluate((index) => {
          const elements = document.querySelectorAll('button, svg, div');
          if (elements[index]) elements[index].click();
        }, attachBtn[0].index);
        
        await minimalDelay(500);
        
        // Find file input
        const fileInput = await page.locator('input[type="file"]').first();
        if (fileInput) {
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
    // Try send button
    const sendBtn = await findElementsByText(page, 'Send', {
      tagNames: ['button', 'div'],
      fuzzy: false
    });
    
    if (sendBtn.length > 0) {
      await page.evaluate((index) => {
        const elements = document.querySelectorAll('button, div');
        if (elements[index]) elements[index].click();
      }, sendBtn[0].index);
    } else {
      // Fallback to Enter key
      await page.keyboard.press('Enter');
    }
    
    await minimalDelay(500);
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
    await page.evaluate((index) => {
      const elements = document.querySelectorAll('button, svg, span');
      if (elements[index]) elements[index].click();
    }, likeElement.index);
    
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
    await page.evaluate((index) => {
      const elements = document.querySelectorAll('textarea, div[contenteditable="true"]');
      if (elements[index]) {
        elements[index].click();
        elements[index].focus();
      }
    }, commentBox[0].index);
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
    await page.evaluate((index) => {
      const elements = document.querySelectorAll('button, div');
      if (elements[index]) elements[index].click();
    }, postBtn[0].index);
    
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
      await page.evaluate((index) => {
        const elements = document.querySelectorAll('input, div, button');
        if (elements[index]) elements[index].click();
      }, searchElements[0].index);
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
      const { username } = args;
      if (!username) throw new Error('Instagram open_target requires a username');
      
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
      const { username, messageGoal, tone, query } = args;
      
      // Get profile context for better message generation
      await navigateToProfileViaSearch(page, username);
      const context = await getInstagramProfileContext(page, username);
      
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
      const { username, messageGoal, tone, query, requireManualReview, attachmentPath } = args;
      
      console.log(`[Instagram] Starting DM to @${username}`);
      
      // STEP 1: Get profile context FIRST
      await navigateToProfileViaSearch(page, username);
      const profileContext = await getInstagramProfileContext(page, username);
      
      // STEP 2: Try 3 messaging methods
      let chatOpened = null;
      let methodUsed = null;
      
      // Method 1: Inbox
      chatOpened = await messageViaInbox(page, username);
      if (chatOpened) {
        methodUsed = 'inbox';
      }
      
      // Method 2: Profile (if inbox failed or not suitable)
      if (!chatOpened && profileContext.canMessage) {
        chatOpened = await messageViaProfile(page, username);
        if (chatOpened) methodUsed = 'profile';
      }
      
      // Method 3: Explore
      if (!chatOpened) {
        chatOpened = await messageViaExplore(page, username);
        if (chatOpened) methodUsed = 'explore';
      }
      
      if (!chatOpened) {
        throw new Error(`Could not open chat with @${username}. They may have restricted messaging.`);
      }
      
      console.log(`[Instagram] Chat opened via: ${methodUsed}`);
      
      // STEP 3: Extract chat history if existing conversation
      const chatHistory = await extractInstagramChatHistory(page, 6);
      
      // STEP 4: Generate personalized message
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'instagram',
        chatContext: chatHistory,
        profileInfo: profileContext
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
        await page.evaluate((index) => {
          document.querySelectorAll('button')[index]?.click();
        }, followBtn[0].index);
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
        await likeInstagramPost(page, null);
      },
      async sendComment(page) {
        const postBtn = await findElementsByText(page, 'Post', { tagNames: ['button', 'div'], fuzzy: false });
        if (postBtn.length > 0) {
          await page.evaluate((index) => {
            const elements = document.querySelectorAll('button, div');
            if (elements[index]) elements[index].click();
          }, postBtn[0].index);
          await minimalDelay(500);
          return true;
        }
        await page.keyboard.press('Enter');
        return true;
      },
      commentSelectors: ['textarea[aria-label="Add a comment…"]', 'textarea[placeholder="Add a comment…"]', 'textarea', 'div[role="textbox"][contenteditable="true"]'],
      commentSubmitSelectors: ['button:has-text("Post")', 'div:has-text("Post")'],
      commentSubmitLabels: ['Post'],
      async openPostComposer(page) {
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
      },
      postComposerSelectors: ['div[role="textbox"][contenteditable="true"]', 'textarea[aria-label="Write a caption..."]'],
      publishPostSelectors: ['button:has-text("Share")'],
      publishPostLabels: ['Share'],
      async attachMedia(page, filePath) {
        try {
          const fileInput = await page.locator('input[type="file"]').first();
          if (await fileInput.count() > 0) {
            await fileInput.setInputFiles(filePath);
            await minimalDelay(2000);
            let nextBtn = page.locator('button:has-text("Next"), div[role="button"]:has-text("Next")').first();
            if (await nextBtn.isVisible()) {
              await nextBtn.click();
              await minimalDelay(1000);
              nextBtn = page.locator('button:has-text("Next"), div[role="button"]:has-text("Next")').first();
              if (await nextBtn.isVisible()) {
                await nextBtn.click();
                await minimalDelay(1000);
              }
            }
            return true;
          }
        } catch (e) {
          console.warn('[Instagram] Media upload failed:', e.message);
        }
        return false;
      }
    });
    return baseHandler.execute({ step, attachedBrowser });
  }
};
