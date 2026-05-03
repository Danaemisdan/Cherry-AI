import {
  PLATFORM_URLS,
  clickByText,
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
import { extractPageContent, findElementsByText, parseProfileFromContent, detectRelationshipStatus } from '../page-extractor.js';
import { createSocialHandler } from '../social-base.js';

/**
 * LinkedIn Handler - Smart UI-based automation with job role matching
 * Uses full page extraction + intelligent parsing for name disambiguation
 */

// Navigate to LinkedIn home via UI
async function navigateToLinkedInHome(page) {
  console.log('[LinkedIn] Navigating to home via UI...');
  
  // Method 1: Click LinkedIn logo
  const logoFound = await tryClick(page, [
    'svg[aria-label="LinkedIn"]',
    'a[href="/feed/"] svg',
    '.global-nav__logo',
  ]);
  
  if (logoFound) {
    await waitForAppShell(page, 'linkedin');
    await minimalDelay(500);
    return true;
  }
  
  // Method 2: Navigate to base URL
  await navigate(page, PLATFORM_URLS.linkedin, 'linkedin');
  await waitForAppShell(page, 'linkedin');
  return true;
}

// Search for person via UI with job role matching for disambiguation
async function linkedinSearchPeople(page, query, roleHint = '') {
  console.log(`[LinkedIn] Searching for "${query}"${roleHint ? ` with role hint: "${roleHint}"` : ''}`);
  
  await navigateToLinkedInHome(page);
  
  // Click search bar
  const searchClicked = await tryClick(page, [
    'input[placeholder*="Search"]',
    '.search-global-typeahead__input',
    'input[role="combobox"]',
  ]);
  
  if (!searchClicked) {
    // Try via text
    const searchEl = await findElementsByText(page, 'Search', {
      tagNames: ['input', 'div'],
      fuzzy: true
    });
    if (searchEl.length > 0) {
      await page.evaluate((idx) => {
        document.querySelectorAll('input, div')[idx]?.click();
      }, searchEl[0].index);
    }
  }
  
  await minimalDelay(300);
  await page.keyboard.type(query, { delay: 20 });
  await minimalDelay(800);
  await page.keyboard.press('Enter');
  await minimalDelay(1500);
  
  // Extract search results
  const content = await extractPageContent(page);
  
  // Parse people results
  const people = [];
  const lines = content.fullText.split('\n').filter(l => l.trim());
  
  // LinkedIn search results have pattern: Name, Headline, Location
  for (let i = 0; i < lines.length - 2; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];
    const thirdLine = lines[i + 2];
    
    // Name usually doesn't contain special chars and is followed by headline
    if (line.length < 40 && !line.includes('|') && !line.includes('@')) {
      // Check if next line looks like a headline (contains job words)
      const jobKeywords = ['engineer', 'manager', 'director', 'ceo', 'founder', 'lead', 'head', 'scientist', 'developer', 'analyst', 'consultant', 'specialist', 'coordinator', 'at', 'with'];
      const isHeadline = jobKeywords.some(kw => nextLine.toLowerCase().includes(kw));
      
      if (isHeadline || thirdLine?.includes('connection') || thirdLine?.includes('connections')) {
        people.push({
          name: line,
          headline: nextLine,
          location: thirdLine,
          index: i
        });
      }
    }
  }
  
  console.log(`[LinkedIn] Found ${people.length} people results`);
  
  // If role hint provided, score and rank matches
  if (roleHint && people.length > 0) {
    const hintWords = roleHint.toLowerCase().split(/\s+/);
    
    people.forEach(p => {
      p.score = 0;
      const headlineLower = p.headline.toLowerCase();
      
      hintWords.forEach(word => {
        if (headlineLower.includes(word)) p.score += 10;
      });
      
      // Boost exact name match
      if (p.name.toLowerCase().includes(query.toLowerCase())) p.score += 5;
    });
    
    people.sort((a, b) => b.score - a.score);
    console.log(`[LinkedIn] Ranked by role match. Best: ${people[0].name} - ${people[0].headline}`);
  }
  
  return people;
}

// Get comprehensive LinkedIn profile context
async function getLinkedInProfileContext(page, identifier) {
  console.log(`[LinkedIn] Extracting full profile context for ${identifier}...`);
  
  const content = await extractPageContent(page);
  const profile = parseProfileFromContent(content, 'linkedin');
  const relationship = await detectRelationshipStatus(page, 'linkedin');
  
  // Extract experience and skills from text
  const experiences = [];
  const lines = content.fullText.split('\n');
  let inExperience = false;
  
  for (const line of lines) {
    if (line.includes('Experience') || line.includes('Work')) {
      inExperience = true;
      continue;
    }
    if (line.includes('Education') || line.includes('Skills')) {
      inExperience = false;
    }
    if (inExperience && line.length > 5 && line.length < 50) {
      experiences.push(line);
    }
  }
  
  const context = {
    identifier,
    name: profile.name,
    headline: profile.headline,
    jobTitle: profile.jobTitle,
    company: profile.company,
    location: profile.location,
    bio: profile.bio,
    followers: profile.followers,
    relationship: relationship.relationship,
    isConnected: relationship.isConnected,
    canConnect: relationship.canFollow,
    isPending: relationship.requestPending,
    experiences: experiences.slice(0, 5),
    openToWork: profile.openToWork,
    hiring: profile.hiring,
    rawText: content.fullText?.slice(0, 1500) || ''
  };
  
  console.log(`[LinkedIn] Context: ${context.name}, ${context.jobTitle} at ${context.company}, ${context.relationship}`);
  return context;
}

// Method 1: Message via LinkedIn Messaging (existing conversations)
async function messageViaMessaging(page, username) {
  console.log(`[LinkedIn] Method 1: Messaging via LinkedIn Messaging...`);
  
  // Navigate to messaging
  const msgClicked = await tryClick(page, [
    'svg[aria-label="Messaging"]',
    'a[href="/messaging/"]',
    '.global-nav__nav-item--jobs + .global-nav__nav-item', // Messaging icon near Jobs
  ]);
  
  if (!msgClicked) {
    await navigate(page, 'https://www.linkedin.com/messaging/', 'linkedin');
  }
  
  await waitForAppShell(page, 'linkedin');
  await minimalDelay(800);
  
  // Click "New message"
  const newMsgClicked = await tryClick(page, [
    'button:has-text("New message")',
    'button[aria-label*="New message"]',
    '.msg-new-conversation-compose__trigger',
  ]);
  
  if (!newMsgClicked) {
    // Try via text
    const newMsgBtn = await findElementsByText(page, 'New message', {
      tagNames: ['button', 'div'],
      fuzzy: true
    });
    if (newMsgBtn.length > 0) {
      await page.evaluate((idx) => {
        document.querySelectorAll('button, div')[idx]?.click();
      }, newMsgBtn[0].index);
    }
  }
  
  await minimalDelay(500);
  
  // Type username in search
  await page.keyboard.type(username, { delay: 20 });
  await minimalDelay(1000);
  
  // Find and click result
  const results = await findElementsByText(page, username, {
    tagNames: ['div', 'li', 'button'],
    fuzzy: true
  });
  
  for (const result of results) {
    if (result.text.toLowerCase().includes(username.toLowerCase())) {
      await page.evaluate((idx) => {
        document.querySelectorAll('div, li, button')[idx]?.click();
      }, result.index);
      
      await minimalDelay(800);
      
      // Check if composer opened
      const composer = await findElementsByText(page, '', {
        tagNames: ['textarea', 'div[contenteditable="true"]'],
        fuzzy: true
      });
      
      if (composer.length > 0) {
        console.log('[LinkedIn] Chat opened via messaging');
        return { success: true, method: 'messaging' };
      }
    }
  }
  
  return false;
}

// Method 2: Message via Connections
async function messageViaConnections(page, username) {
  console.log(`[LinkedIn] Method 2: Messaging via Connections...`);
  
  // Navigate to connections
  const connClicked = await tryClick(page, [
    'svg[aria-label="My Network"]',
    'a[href*="/mynetwork/"]',
  ]);
  
  if (!connClicked) {
    await navigate(page, 'https://www.linkedin.com/mynetwork/invite-connect/connections/', 'linkedin');
  }
  
  await waitForAppShell(page, 'linkedin');
  await minimalDelay(800);
  
  // Search in connections
  const searchEl = await findElementsByText(page, 'Search', {
    tagNames: ['input'],
    fuzzy: true
  });
  
  if (searchEl.length > 0) {
    await page.evaluate((idx) => {
      const el = document.querySelectorAll('input')[idx];
      el?.click();
      el?.focus();
    }, searchEl[0].index);
    
    await page.keyboard.type(username, { delay: 20 });
    await minimalDelay(1000);
    
    // Find connection card
    const content = await extractPageContent(page);
    const matchingCards = content.interactiveElements.filter(e => 
      e.text.toLowerCase().includes(username.toLowerCase()) &&
      (e.text.includes('Message') || e.ariaLabel?.includes('Message'))
    );
    
    for (const card of matchingCards) {
      if (card.text.includes('Message')) {
        await page.evaluate((idx) => {
          document.querySelectorAll('button')[idx]?.click();
        }, card.index);
        
        await minimalDelay(800);
        
        const composer = await findElementsByText(page, '', {
          tagNames: ['textarea', 'div[contenteditable="true"]'],
          fuzzy: true
        });
        
        if (composer.length > 0) {
          console.log('[LinkedIn] Chat opened via connections');
          return { success: true, method: 'connections' };
        }
      }
    }
  }
  
  return false;
}

// Method 3: Message via profile (Connect -> Message)
async function messageViaProfile(page, personInfo) {
  console.log(`[LinkedIn] Method 3: Messaging via profile...`);
  
  const { name, headline, roleHint } = personInfo;
  
  // Search for person first
  const searchResults = await linkedinSearchPeople(page, name, roleHint);
  
  if (searchResults.length === 0) {
    return false;
  }
  
  // Get best match
  const bestMatch = searchResults[0];
  
  // Click on their name to go to profile
  const nameElements = await findElementsByText(page, bestMatch.name, {
    tagNames: ['a', 'span'],
    fuzzy: false
  });
  
  if (nameElements.length > 0) {
    await page.evaluate((idx) => {
      document.querySelectorAll('a, span')[idx]?.click();
    }, nameElements[0].index);
    
    await minimalDelay(1500);
    
    // Check connection status and act accordingly
    const content = await extractPageContent(page);
    const relationship = await detectRelationshipStatus(page, 'linkedin');
    
    if (relationship.isConnected || relationship.canMessage) {
      // Click Message button
      const msgBtn = await findElementsByText(page, 'Message', {
        tagNames: ['button', 'a'],
        fuzzy: false
      });
      
      if (msgBtn.length > 0) {
        await page.evaluate((idx) => {
          document.querySelectorAll('button, a')[idx]?.click();
        }, msgBtn[0].index);
        
        await minimalDelay(1000);
        
        const composer = await findElementsByText(page, '', {
          tagNames: ['textarea', 'div[contenteditable="true"]'],
          fuzzy: true
        });
        
        if (composer.length > 0) {
          console.log('[LinkedIn] Chat opened via profile (Message)');
          return { success: true, method: 'profile_message', relationship };
        }
      }
    } else if (relationship.canConnect) {
      // Click Connect and then Add note
      const connectBtn = await findElementsByText(page, 'Connect', {
        tagNames: ['button'],
        fuzzy: false
      });
      
      if (connectBtn.length > 0) {
        await page.evaluate((idx) => {
          document.querySelectorAll('button')[idx]?.click();
        }, connectBtn[0].index);
        
        await minimalDelay(500);
        
        // Click "Add a note"
        const addNoteBtn = await findElementsByText(page, 'Add a note', {
          tagNames: ['button', 'span'],
          fuzzy: true
        });
        
        if (addNoteBtn.length > 0) {
          await page.evaluate((idx) => {
            document.querySelectorAll('button, span')[idx]?.click();
          }, addNoteBtn[0].index);
          
          await minimalDelay(500);
          
          const composer = await findElementsByText(page, '', {
            tagNames: ['textarea'],
            fuzzy: true
          });
          
          if (composer.length > 0) {
            console.log('[LinkedIn] Connection request with note opened');
            return { success: true, method: 'profile_connect_note', relationship };
          }
        }
        
        // Simple connect (no note)
        return { success: true, method: 'profile_connect', relationship, noteAvailable: false };
      }
    }
  }
  
  return false;
}

// Extract chat history from LinkedIn conversation
async function extractLinkedInChatHistory(page, limit = 10) {
  console.log('[LinkedIn] Extracting chat history...');
  
  const content = await extractPageContent(page);
  const messages = [];
  
  // LinkedIn messages appear in msg-s-event-listitem containers
  // Parse from page content
  const lines = content.fullText.split('\n').filter(l => l.trim());
  
  // Look for message patterns (sender name + message text pairs)
  let lastSender = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Skip UI elements
    if (line.includes('Seen') || line.includes('Delivered') || line.match(/^\d+:\d+$/)) {
      continue;
    }
    
    // Check if this looks like a sender name
    if (line.length < 30 && !line.includes(':') && i < lines.length - 1) {
      const nextLine = lines[i + 1];
      // If next line is longer, it's probably a message
      if (nextLine.length > 10 && nextLine.length < 500) {
        messages.push({
          sender: line,
          text: nextLine,
          role: line === 'You' ? 'me' : 'them'
        });
        i++; // Skip next line as we used it
      }
    }
  }
  
  console.log(`[LinkedIn] Found ${messages.length} messages in chat`);
  return messages.slice(-limit);
}

// Send LinkedIn message
async function sendLinkedInMessage(page, message, options = {}) {
  const { attachmentPath, requireManualReview, messageType = 'message' } = options;
  
  console.log('[LinkedIn] Sending message...');
  
  // Find composer
  const composer = await findElementsByText(page, '', {
    tagNames: ['textarea', 'div[contenteditable="true"]'],
    fuzzy: true
  });
  
  if (composer.length === 0) {
    throw new Error('Message composer not found');
  }
  
  // Click and type
  await page.evaluate((idx) => {
    const el = document.querySelectorAll('textarea, div[contenteditable="true"]')[idx];
    el?.click();
    el?.focus();
  }, composer[0].index);
  
  await minimalDelay(200);
  await page.keyboard.type(message, { delay: 10 });
  
  // Handle attachment
  if (attachmentPath && messageType !== 'connection_request') {
    try {
      const attachBtn = await findElementsByText(page, 'Attach', {
        tagNames: ['button', 'svg'],
        fuzzy: true
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
  
  // Send or review
  if (!requireManualReview) {
    if (messageType === 'connection_request') {
      // Click Send for connection request
      const sendBtn = await findElementsByText(page, 'Send', {
        tagNames: ['button'],
        fuzzy: false
      });
      
      if (sendBtn.length > 0) {
        await page.evaluate((idx) => {
          document.querySelectorAll('button')[idx]?.click();
        }, sendBtn[0].index);
      }
    } else {
      // Press Enter for regular message
      await page.keyboard.press('Enter');
    }
    
    await minimalDelay(500);
    console.log('[LinkedIn] Message sent');
    return { sent: true };
  }
  
  return { sent: false, waitingForReview: true };
}

// Like LinkedIn post
async function likeLinkedInPost(page, postUrl) {
  console.log('[LinkedIn] Liking post...');
  
  if (postUrl) {
    await navigate(page, postUrl, 'linkedin');
    await waitForAppShell(page, 'linkedin');
    await minimalDelay(800);
  }
  
  // Find like button
  const likeBtn = await findElementsByText(page, 'Like', {
    tagNames: ['button', 'span'],
    fuzzy: true
  });
  
  // Also check aria-label
  const content = await extractPageContent(page);
  const likeEl = content.interactiveElements.find(e => 
    e.ariaLabel?.includes('Like') || e.text === 'Like'
  );
  
  if (likeEl) {
    await page.evaluate((idx) => {
      document.querySelectorAll('button, span')[idx]?.click();
    }, likeEl.index);
    
    await minimalDelay(500);
    return { liked: true };
  }
  
  return { liked: false };
}

// Comment on LinkedIn post
async function commentOnLinkedInPost(page, comment, postUrl) {
  console.log('[LinkedIn] Commenting on post...');
  
  if (postUrl) {
    await navigate(page, postUrl, 'linkedin');
    await waitForAppShell(page, 'linkedin');
    await minimalDelay(800);
  }
  
  // Find comment box
  const commentBox = await findElementsByText(page, 'Add a comment', {
    tagNames: ['div[contenteditable="true"]'],
    fuzzy: true
  });
  
  if (commentBox.length === 0) {
    throw new Error('Comment box not found');
  }
  
  // Click and type
  await page.evaluate((idx) => {
    const el = document.querySelectorAll('div[contenteditable="true"]')[idx];
    el?.click();
    el?.focus();
  }, commentBox[0].index);
  
  await minimalDelay(200);
  await page.keyboard.type(comment, { delay: 10 });
  await minimalDelay(300);
  
  // Post comment
  await page.keyboard.press('Enter');
  await minimalDelay(500);
  
  return { commented: true };
}

// Main handler
export const linkedinHandler = {
  platform: 'linkedin',
  
  async execute({ step, attachedBrowser }) {
    const { action, args } = step;
    
    // Check login state
    if (['send_message', 'draft_message', 'open_target', 'message_batch', 'like_post', 'comment_post'].includes(action)) {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.linkedin, { platform: 'linkedin' });
      const state = await checkLoginState(page, 'linkedin');
      if (!state.ready) {
        throw new Error(state.message || 'Please log in to LinkedIn');
      }
    }
    
    const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.linkedin, { platform: 'linkedin' });
    
    // ACTION: Open profile with search
    if (action === 'open_target') {
      const { username, roleHint } = args;
      if (!username) throw new Error('LinkedIn open_target requires a username');
      
      const results = await linkedinSearchPeople(page, username, roleHint);
      
      if (results.length === 0) {
        throw new Error(`Could not find "${username}" on LinkedIn`);
      }
      
      // Click first result to open profile
      const nameEl = await findElementsByText(page, results[0].name, {
        tagNames: ['a', 'span'],
        fuzzy: false
      });
      
      if (nameEl.length > 0) {
        await page.evaluate((idx) => {
          document.querySelectorAll('a, span')[idx]?.click();
        }, nameEl[0].index);
        await minimalDelay(1000);
      }
      
      const context = await getLinkedInProfileContext(page, username);
      
      return {
        status: 'ready',
        summary: summarizeAction('linkedin', step),
        data: { profile: context, searchResults: results, snapshot: await pageSnapshot(page) }
      };
    }
    
    // ACTION: Draft message with profile context
    if (action === 'draft_message') {
      const { username, roleHint, messageGoal, tone, query } = args;
      
      // Search and get context
      const results = await linkedinSearchPeople(page, username, roleHint);
      let context = {};
      
      if (results.length > 0) {
        // Open first match to get detailed context
        const nameEl = await findElementsByText(page, results[0].name, {
          tagNames: ['a', 'span'],
          fuzzy: false
        });
        if (nameEl.length > 0) {
          await page.evaluate((idx) => {
            document.querySelectorAll('a, span')[idx]?.click();
          }, nameEl[0].index);
          await minimalDelay(1000);
          context = await getLinkedInProfileContext(page, username);
        }
      }
      
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'linkedin',
        chatContext: [],
        profileInfo: context
      });
      
      return {
        status: 'ready',
        summary: summarizeAction('linkedin', step),
        data: { preview: message, profile: context, searchResults: results }
      };
    }
    
    // ACTION: Send message (with 3 methods + role matching)
    if (action === 'send_message') {
      const { username, roleHint, messageGoal, tone, query, requireManualReview, attachmentPath } = args;
      
      console.log(`[LinkedIn] Starting DM to ${username}${roleHint ? ` (${roleHint})` : ''}`);
      
      // STEP 1: Search for person with role hint for disambiguation
      const searchResults = await linkedinSearchPeople(page, username, roleHint);
      
      if (searchResults.length === 0) {
        throw new Error(`Could not find "${username}" on LinkedIn`);
      }
      
      // Open best match profile
      const nameEl = await findElementsByText(page, searchResults[0].name, {
        tagNames: ['a', 'span'],
        fuzzy: false
      });
      
      if (nameEl.length > 0) {
        await page.evaluate((idx) => {
          document.querySelectorAll('a, span')[idx]?.click();
        }, nameEl[0].index);
        await minimalDelay(1000);
      }
      
      const profileContext = await getLinkedInProfileContext(page, username);
      
      // STEP 2: Try 3 messaging methods
      let chatOpened = null;
      let methodUsed = null;
      
      // Method 1: Messaging (for connected people)
      chatOpened = await messageViaMessaging(page, username);
      if (chatOpened) methodUsed = 'messaging';
      
      // Method 2: Connections
      if (!chatOpened && profileContext.isConnected) {
        chatOpened = await messageViaConnections(page, username);
        if (chatOpened) methodUsed = 'connections';
      }
      
      // Method 3: Profile (Connect/Message)
      if (!chatOpened) {
        chatOpened = await messageViaProfile(page, { name: username, roleHint });
        if (chatOpened) methodUsed = chatOpened.method;
      }
      
      if (!chatOpened || !chatOpened.success) {
        throw new Error(`Could not open chat with ${username}. You may need to connect first.`);
      }
      
      console.log(`[LinkedIn] Chat opened via: ${methodUsed}`);
      
      // STEP 3: Extract chat history
      const chatHistory = await extractLinkedInChatHistory(page, 6);
      
      // STEP 4: Generate personalized message
      const message = await generateOutreachMessage({
        username,
        goal: messageGoal,
        tone,
        query,
        platform: 'linkedin',
        chatContext: chatHistory,
        profileInfo: profileContext
      });
      
      // Truncate for LinkedIn connection note limit (280 chars)
      const isConnectionNote = methodUsed?.includes('connect');
      const finalMessage = isConnectionNote ? message.slice(0, 280) : message;
      
      console.log(`[LinkedIn] Message: "${finalMessage.slice(0, 50)}..."`);
      
      // STEP 5: Send
      const result = await sendLinkedInMessage(page, finalMessage, {
        attachmentPath,
        requireManualReview,
        messageType: isConnectionNote ? 'connection_request' : 'message'
      });
      
      return {
        status: 'completed',
        summary: summarizeAction('linkedin', step, { sent: result.sent }),
        data: {
          message: finalMessage,
          sent: result.sent,
          method: methodUsed,
          profile: profileContext,
          chatHistory: chatHistory.length > 0 ? chatHistory : undefined,
          searchResults
        }
      };
    }
    
    // ACTION: Message batch
    if (action === 'message_batch') {
      const people = (args.people || []).slice(0, 15); // Array of {name, roleHint}
      const results = [];
      
      for (const person of people) {
        try {
          const result = await this.execute({
            step: {
              action: 'send_message',
              platform: 'linkedin',
              args: { ...args, username: person.name, roleHint: person.roleHint }
            },
            attachedBrowser
          });
          results.push({ person, ...result });
          await minimalDelay(3000 + Math.random() * 2000);
        } catch (error) {
          results.push({ person, error: error.message, status: 'failed' });
        }
      }
      
      return {
        status: 'completed',
        summary: `Messaged ${people.length} LinkedIn contacts`,
        data: results
      };
    }
    
    // ACTION: Like post
    if (action === 'like_post') {
      const { postUrl } = args;
      const result = await likeLinkedInPost(page, postUrl);
      
      return {
        status: 'completed',
        summary: summarizeAction('linkedin', step),
        data: result
      };
    }
    
    // ACTION: Comment on post
    if (action === 'comment_post') {
      const { postUrl, comment, messageGoal, tone, query } = args;
      
      let finalComment = comment;
      if (!finalComment && messageGoal) {
        finalComment = await generateOutreachMessage({
          username: 'post',
          goal: messageGoal,
          tone,
          query,
          platform: 'linkedin',
          chatContext: [],
          profileInfo: {}
        });
      }
      
      const result = await commentOnLinkedInPost(page, finalComment, postUrl);
      
      return {
        status: 'completed',
        summary: summarizeAction('linkedin', step),
        data: { comment: finalComment, ...result }
      };
    }
    
    // ACTION: Search people
    if (action === 'search_people') {
      const { query, roleHint } = args;
      const results = await linkedinSearchPeople(page, query, roleHint);
      
      return {
        status: 'completed',
        summary: `Searched LinkedIn for "${query}"`,
        data: { results, query, roleHint }
      };
    }
    
    // Delegate other actions to base handler
    const baseHandler = createSocialHandler('linkedin', {});
    return baseHandler.execute({ step, attachedBrowser });
  }
};
