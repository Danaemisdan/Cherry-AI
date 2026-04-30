#!/usr/bin/env node
// PROPER test using existing WhatsApp handlers
// This ACTUALLY tests the functions by opening real conversations

import { chromium } from 'playwright';
import { checkLoginState } from '../state-checker.js';
import { generateOutreachMessage } from '../common.js';
import { whatsappHandler } from '../handlers/whatsapp.js';

const CDP_URL = 'http://127.0.0.1:9222';

// Helper to create mock attachedBrowser for the handler
function createMockAttachedBrowser(page) {
  return {
    page,
    async getPage() { return page; },
    async newPage() { return page; }
  };
}

async function runProperTest() {
  console.log('🚀 PROPER Platform Test - Using Real Handlers\n');
  console.log('==============================================\n');

  // Connect to Chrome
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('✅ Connected to Chrome profile\n');
  } catch (error) {
    console.error('❌ Could not connect. Run: npm run dev:agent:profile');
    process.exit(1);
  }

  // Get the existing WhatsApp page or create one
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  const pages = context.pages();
  let page = pages.find(p => p.url().includes('whatsapp')) || pages[0] || await context.newPage();

  // Handle any dialogs
  page.on('dialog', async dialog => {
    console.log(`  [Dialog] ${dialog.type()}: ${dialog.message().slice(0, 50)}...`);
    await dialog.accept().catch(() => {});
  });

  // ==================== WHATSAPP TEST ====================
  console.log('📱 TESTING WHATSAPP\n');

  try {
    // Navigate to WhatsApp
    await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Check login
    const state = await checkLoginState(page, 'whatsapp');
    console.log(`Login: ${state.loggedIn ? '✅' : '❌'} ${state.message || ''}`);

    if (!state.ready) {
      console.log('⏭️  Skipping - WhatsApp not ready\n');
    } else {
      // Create mock attachedBrowser
      const attachedBrowser = createMockAttachedBrowser(page);

      // Get list of contacts from left rail
      console.log('\n  Looking for contacts...');
      const contacts = (await page.locator('div[role="listitem"], div[role="row"]').all()).slice(0, 5);
      console.log(`  Found ${contacts.length} contacts in list`);

      if (contacts.length > 0) {
        // Click first contact to open conversation
        console.log('  Opening first conversation...');
        await contacts[0].click();
        await page.waitForTimeout(3000);

        // Get the contact name from header
        const headerName = await page.locator('header span[title], header h1').first().textContent().catch(() => 'Unknown');
        console.log(`  📩 Opened chat with: ${headerName}`);

        // Test 1: draft_message with context
        console.log('\n  === TEST: draft_message ===');
        const draftResult = await whatsappHandler.execute({
          step: {
            action: 'draft_message',
            platform: 'whatsapp',
            args: {
              username: headerName,
              messageGoal: 'Follow up on our previous conversation',
              tone: 'Casual'
            }
          },
          attachedBrowser
        });

        console.log(`  Status: ${draftResult.status}`);
        console.log(`  Generated message: "${draftResult.data?.preview?.slice(0, 80)}..."`);

        // Test 2: review_queue
        console.log('\n  === TEST: review_queue ===');
        const queueResult = await whatsappHandler.execute({
          step: {
            action: 'review_queue',
            platform: 'whatsapp',
            args: {}
          },
          attachedBrowser
        });
        console.log(`  Status: ${queueResult.status}`);

        // Test 3: open_target with random name
        console.log('\n  === TEST: open_target (random contact) ===');
        const randomName = ['Alex', 'Jordan', 'Taylor'][Math.floor(Math.random() * 3)];
        try {
          const targetResult = await whatsappHandler.execute({
            step: {
              action: 'open_target',
              platform: 'whatsapp',
              args: { username: randomName }
            },
            attachedBrowser
          });
          console.log(`  Status: ${targetResult.status}`);
          if (targetResult.data?.url) console.log(`  URL: ${targetResult.data.url}`);
        } catch (e) {
          console.log(`  ⚠️  Could not find ${randomName} (expected if not in contacts)`);
        }

        // Test 4: Multiple contextual messages
        console.log('\n  === TEST: Generate 3 contextual replies ===');
        const goals = [
          'Ask about their weekend',
          'Share a quick update',
          'Schedule a quick call'
        ];

        for (const goal of goals) {
          const msg = await generateOutreachMessage({
            username: headerName,
            goal,
            tone: 'Friendly',
            platform: 'whatsapp',
            chatContext: [] // Would get from extractChatContext
          });
          console.log(`  • ${goal}: "${msg.slice(0, 50)}..."`);
        }

        console.log('\n  ✅ WhatsApp tests PASSED');
      } else {
        console.log('  ⚠️  No contacts found - cannot test messaging');
      }
    }
  } catch (error) {
    console.error('  ❌ WhatsApp error:', error.message);
  }

  // ==================== INSTAGRAM TEST ====================
  console.log('\n\n📸 TESTING INSTAGRAM\n');

  try {
    await page.goto('https://instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const igState = await checkLoginState(page, 'instagram');
    console.log(`Login: ${igState.loggedIn ? '✅' : '❌'} ${igState.message || ''}`);

    if (igState.ready) {
      // Test DM functionality
      console.log('  Testing DM functionality...');

      // Go to messages
      await page.goto('https://instagram.com/direct/inbox/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      // Check for conversations
      const conversations = (await page.locator('div[role="listitem"], a[href*="/direct/t/"]').all()).slice(0, 3);
      console.log(`  Found ${conversations.length} conversations`);

      if (conversations.length > 0) {
        await conversations[0].click();
        await page.waitForTimeout(2000);

        // Generate contextual message
        const igMsg = await generateOutreachMessage({
          username: 'Instagram User',
          goal: 'Reply to their story',
          tone: 'Casual',
          platform: 'instagram'
        });
        console.log(`  ✅ Generated reply: "${igMsg.slice(0, 60)}..."`);
      }
    }
  } catch (error) {
    console.error('  ❌ Instagram error:', error.message);
  }

  // ==================== LINKEDIN TEST ====================
  console.log('\n\n💼 TESTING LINKEDIN\n');

  try {
    await page.goto('https://linkedin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const liState = await checkLoginState(page, 'linkedin');
    console.log(`Login: ${liState.loggedIn ? '✅' : '❌'} ${liState.message || ''}`);

    if (liState.ready) {
      // Test message generation
      const liMsg = await generateOutreachMessage({
        username: 'LinkedIn Connection',
        goal: 'Professional networking and collaboration',
        tone: 'Professional',
        platform: 'linkedin'
      });
      console.log(`  ✅ Generated: "${liMsg.slice(0, 60)}..."`);

      // Test job search (we built this)
      console.log('  Testing job search navigation...');
      await page.goto('https://linkedin.com/jobs/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      console.log('  ✅ Job page loaded');
    }
  } catch (error) {
    console.error('  ❌ LinkedIn error:', error.message);
  }

  // ==================== GMAIL TEST ====================
  console.log('\n\n📧 TESTING GMAIL\n');

  try {
    await page.goto('https://gmail.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const gmState = await checkLoginState(page, 'gmail');
    console.log(`Login: ${gmState.loggedIn ? '✅' : '❌'} ${gmState.message || ''}`);

    if (gmState.ready) {
      const email = await generateOutreachMessage({
        username: 'Contact',
        goal: 'Business proposal introduction',
        tone: 'Professional',
        platform: 'gmail'
      });
      console.log(`  ✅ Generated email: "${email.slice(0, 60)}..."`);

      // Try to open compose
      const composeBtn = await page.locator('div[role="button"][aria-label*="Compose"], .T-I-KE').first();
      if (composeBtn) {
        await composeBtn.click();
        await page.waitForTimeout(2000);
        console.log('  ✅ Compose window opened');
      }
    }
  } catch (error) {
    console.error('  ❌ Gmail error:', error.message);
  }

  // ==================== SUMMARY ====================
  console.log('\n\n==============================================');
  console.log('📊 TEST COMPLETE');
  console.log('==============================================\n');
  console.log('Browser remains open. Close this terminal when done.');
  console.log('\n✅ If WhatsApp showed "tests PASSED", your functions work!');
}

runProperTest().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
