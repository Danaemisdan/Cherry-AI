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
 * LinkedIn Handler - Simplified messaging flow
 * Key principle: Go to messaging, search, select first match, send message
 */

// Simple function to open LinkedIn messaging and find a person
async function openLinkedInChat(page, searchName) {
  console.log(`[LinkedIn] Opening chat with "${searchName}"...`);
  
  // Navigate directly to messaging
  await navigate(page, 'https://www.linkedin.com/messaging/', 'linkedin');
  await waitForAppShell(page, 'linkedin');
  await minimalDelay(800);
  
  // Click "New message" or compose button
  const newMsgClicked = await tryClick(page, [
    'button:has-text("New message")',
    'button[aria-label*="New message"]',
    '.msg-new-conversation-compose__trigger',
    'button:has-text("Compose")',
  ]);
  
  if (!newMsgClicked) {
    // Try finding by text
    const composeBtn = await findElementsByText(page, 'New message', {
      tagNames: ['button'],
      fuzzy: true
    });
    if (composeBtn.length > 0) {
      await page.evaluate((idx) => {
        document.querySelectorAll('button')[idx]?.click();
      }, composeBtn[0].index);
    }
  }
  
  await minimalDelay(500);
  
  // Type the name in search
  await page.keyboard.type(searchName, { delay: 20 });
  await minimalDelay(1500); // Wait for suggestions
  
  // Extract page to see search results
  const content = await extractPageContent(page);
  
  // Find the first matching result - look for elements containing the search name
  // LinkedIn shows: Name, headline/connection info, profile pic
  const matches = content.interactiveElements.filter(e => 
    e.text.toLowerCase().includes(searchName.toLowerCase()) &&
    e.visible !== false &&
    e.text.length > searchName.length // Should have more info than just name
  );
  
  if (matches.length === 0) {
    console.log(`[LinkedIn] No matches found for "${searchName}"`);
    return false;
  }
  
  // Click the first good match
  const bestMatch = matches[0];
  console.log(`[LinkedIn] Clicking: ${bestMatch.text.slice(0, 60)}`);
  
  await page.evaluate((idx) => {
    const elements = document.querySelectorAll('div, button, li');
    if (elements[idx]) elements[idx].click();
  }, bestMatch.index);
  
  await minimalDelay(1000);
  
  // Check if chat opened (composer visible)
  const composerCheck = await findElementsByText(page, '', {
    tagNames: ['textarea', 'div[contenteditable="true"]'],
    fuzzy: true
  });
  
  if (composerCheck.length > 0) {
    console.log('[LinkedIn] Chat opened successfully');
    return { success: true, selectedMatch: bestMatch.text };
  }
  
  // Alternative: check if we're in a conversation view
  const currentContent = await extractPageContent(page);
  if (currentContent.fullText.includes('Press Enter to Send') || 
      currentContent.fullText.toLowerCase().includes('message')) {
    console.log('[LinkedIn] Chat detected via page text');
    return { success: true, selectedMatch: bestMatch.text };
  }
  
  return false;
}

// Extract basic context from current page
async function getBasicContext(page) {
  const content = await extractPageContent(page);
  const profile = parseProfileFromContent(content, 'linkedin');
  
  return {
    name: profile.name,
    headline: profile.headline,
    jobTitle: profile.jobTitle,
    company: profile.company,
    bio: profile.bio,
    rawText: content.fullText?.slice(0, 800) || ''
  };
}

// Send a LinkedIn message
async function sendLinkedInMessage(page, message, options = {}) {
  const { attachmentPath, requireManualReview } = options;
  
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
  if (attachmentPath) {
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
  
  // Send
  if (!requireManualReview) {
    await page.keyboard.press('Enter');
    await minimalDelay(500);
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
      const { username, messageGoal, tone, query, requireManualReview, attachmentPath } = args;
      
      console.log(`[LinkedIn] Starting DM to "${username}"`);
      
      // Step 1: Open chat via messaging
      const chatOpened = await openLinkedInChat(page, username);
      
      if (!chatOpened) {
        throw new Error(`Could not find "${username}" in LinkedIn messaging. You may need to connect with them first.`);
      }
      
      console.log(`[LinkedIn] Chat opened with: ${chatOpened.selectedMatch.slice(0, 60)}`);
      
      // Step 2: Get basic context from the page
      const context = await getBasicContext(page);
      console.log(`[LinkedIn] Context: ${context.name || username}, ${context.headline?.slice(0, 50) || 'no headline'}`);
      
      // Step 3: Extract any existing chat history
      const chatHistory = await extractChatContext(page, 'linkedin', 6);
      
      // Step 4: Generate message
      const message = await generateOutreachMessage({
        username,
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
        requireManualReview
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
    
    // ACTION: Open target (simple - just navigate to messaging)
    if (action === 'open_target') {
      const { username } = args;
      
      await navigate(page, 'https://www.linkedin.com/messaging/', 'linkedin');
      await waitForAppShell(page, 'linkedin');
      
      return {
        status: 'ready',
        summary: summarizeAction('linkedin', step),
        data: await pageSnapshot(page)
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
    
    // ACTION: Connect user (without note)
    if (action === 'connect_user') {
      const { username } = args;
      console.log(`[LinkedIn] Connecting with ${username}...`);
      
      // Navigate to profile
      await navigate(page, `https://www.linkedin.com/in/${username}/`, 'linkedin');
      await waitForAppShell(page, 'linkedin');
      await minimalDelay(500);
      
      // Find and click Connect button
      const connectBtn = await findElementsByText(page, 'Connect', {
        tagNames: ['button'],
        fuzzy: false
      });
      
      if (connectBtn.length > 0) {
        await page.evaluate((index) => {
          document.querySelectorAll('button')[index]?.click();
        }, connectBtn[0].index);
        await minimalDelay(800);
        
        // Check if "Add a note" dialog appeared - if so, click Send without note
        const sendBtn = await findElementsByText(page, 'Send', {
          tagNames: ['button'],
          fuzzy: false
        });
        
        if (sendBtn.length > 0) {
          await page.evaluate((index) => {
            document.querySelectorAll('button')[index]?.click();
          }, sendBtn[0].index);
          await minimalDelay(500);
        }
        
        return {
          status: 'completed',
          summary: `Sent connection request to ${username}`,
          data: { username, action: 'connected', withNote: false }
        };
      }
      
      throw new Error(`Could not find Connect button for ${username}. You may already be connected.`);
    }
    
    // ACTION: Connect with note
    if (action === 'connect_with_note') {
      const { username, messageGoal, tone, query } = args;
      console.log(`[LinkedIn] Connecting with ${username} + note...`);
      
      // Navigate to profile
      await navigate(page, `https://www.linkedin.com/in/${username}/`, 'linkedin');
      await waitForAppShell(page, 'linkedin');
      await minimalDelay(500);
      
      // Get context for personalization
      const context = await getBasicContext(page);
      
      // Generate personalized note
      const note = await generateOutreachMessage({
        username,
        goal: messageGoal || 'connect professionally',
        tone,
        query,
        platform: 'linkedin',
        chatContext: [],
        profileInfo: context
      });
      
      // Truncate to LinkedIn's 300 character limit for connection notes
      const truncatedNote = note.slice(0, 300);
      
      // Find and click Connect button
      const connectBtn = await findElementsByText(page, 'Connect', {
        tagNames: ['button'],
        fuzzy: false
      });
      
      if (connectBtn.length === 0) {
        throw new Error(`Could not find Connect button for ${username}`);
      }
      
      await page.evaluate((index) => {
        document.querySelectorAll('button')[index]?.click();
      }, connectBtn[0].index);
      await minimalDelay(800);
      
      // Click "Add a note"
      const addNoteBtn = await findElementsByText(page, 'Add a note', {
        tagNames: ['button', 'span'],
        fuzzy: true
      });
      
      if (addNoteBtn.length === 0) {
        throw new Error('Could not find "Add a note" button');
      }
      
      await page.evaluate((index) => {
        document.querySelectorAll('button, span')[index]?.click();
      }, addNoteBtn[0].index);
      await minimalDelay(500);
      
      // Find note textarea and type message
      const noteField = await findElementsByText(page, '', {
        tagNames: ['textarea'],
        fuzzy: true
      });
      
      if (noteField.length > 0) {
        await page.evaluate((index) => {
          const el = document.querySelectorAll('textarea')[index];
          el?.click();
          el?.focus();
        }, noteField[0].index);
        
        await page.keyboard.type(truncatedNote, { delay: 5 });
        await minimalDelay(300);
      }
      
      // Click Send
      const sendBtn = await findElementsByText(page, 'Send', {
        tagNames: ['button'],
        fuzzy: false
      });
      
      if (sendBtn.length > 0) {
        await page.evaluate((index) => {
          document.querySelectorAll('button')[index]?.click();
        }, sendBtn[0].index);
        await minimalDelay(500);
      }
      
      return {
        status: 'completed',
        summary: `Sent connection request with note to ${username}`,
        data: { username, action: 'connected', withNote: true, note: truncatedNote }
      };
    }
    
    // Delegate other actions to base handler
    const baseHandler = createSocialHandler('linkedin', {});
    return baseHandler.execute({ step, attachedBrowser });
  }
};
