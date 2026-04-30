#!/usr/bin/env node
// Test using existing Chrome profile via CDP
// This connects to your already-logged-in Chrome

import { chromium } from 'playwright';
import { checkLoginState } from '../state-checker.js';
import { extractChatContext } from '../chat-context.js';
import { generateOutreachMessage } from '../common.js';

const CDP_URL = 'http://127.0.0.1:9222';

const RANDOM_NAMES = [
  'Alex Chen', 'Jordan Smith', 'Taylor Wilson', 'Morgan Lee',
  'Casey Brown', 'Riley Davis', 'Avery Johnson', 'Quinn Miller'
];

const RANDOM_QUERIES = [
  'fintech startups', 'AI founders', 'venture capital',
  'software engineers', 'product managers', 'tech recruiters'
];

async function testWithProfile() {
  console.log('🚀 Testing with your Chrome profile via CDP\n');
  console.log('Connecting to Chrome on port 9222...\n');

  let browser;
  try {
    // Connect to existing Chrome via CDP
    browser = await chromium.connectOverCDP(CDP_URL);
    console.log('✅ Connected to Chrome profile\n');
  } catch (error) {
    console.error('❌ Could not connect to Chrome. Make sure Chrome is running with --remote-debugging-port=9222');
    console.error('   Run: npm run dev:agent:profile');
    process.exit(1);
  }

  // Get existing context or create new
  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();

  // Use existing page or create new
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  console.log(`📱 Found ${pages.length} existing tabs\n`);

  const platforms = [
    { name: 'whatsapp', url: 'https://web.whatsapp.com/', priority: 1 },
    { name: 'instagram', url: 'https://instagram.com/', priority: 2 },
    { name: 'linkedin', url: 'https://linkedin.com/', priority: 3 },
    { name: 'twitter', url: 'https://twitter.com/', priority: 4 },
    { name: 'gmail', url: 'https://gmail.com/', priority: 5 },
    { name: 'facebook', url: 'https://facebook.com/', priority: 6 },
  ];

  const results = [];

  for (const platform of platforms) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Testing ${platform.name.toUpperCase()}`);
    console.log('='.repeat(50));

    try {
      // Navigate in existing tab
      await page.goto(platform.url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(5000);

      // Check login state
      const state = await checkLoginState(page, platform.name);
      console.log(`Login state: ${state.loggedIn ? '✅ LOGGED IN' : '❌ NOT LOGGED IN'}`);

      if (!state.ready) {
        console.log(`⚠️  Skipping - ${state.message}`);
        results.push({ platform: platform.name, status: 'skipped', reason: state.message });
        continue;
      }

      // Run platform tests
      const tests = await runPlatformTests(page, platform.name);
      results.push({ platform: platform.name, status: 'passed', tests });

    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
      results.push({ platform: platform.name, status: 'error', error: error.message });
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(50));

  results.forEach(r => {
    const icon = r.status === 'passed' ? '✅' : r.status === 'skipped' ? '⏭️' : '❌';
    console.log(`${icon} ${r.platform.toUpperCase()}: ${r.status}`);
    if (r.tests) console.log(`   Tests: ${r.tests.join(', ')}`);
    if (r.reason) console.log(`   Reason: ${r.reason}`);
  });

  const passed = results.filter(r => r.status === 'passed').length;
  const loggedIn = results.filter(r => r.status === 'passed' || (r.status === 'skipped' && !r.reason?.includes('Not logged'))).length;

  console.log(`\n✅ Platforms working: ${passed}/${platforms.length}`);
  console.log(`🔐 Platforms logged in: ${loggedIn}/${platforms.length}`);

  // Keep browser open
  console.log('\n🔚 Test complete. Browser remains open.');
  console.log('Close this terminal when done observing.');
}

async function runPlatformTests(page, platform) {
  const tests = [];
  const randomName = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];

  switch (platform) {
    case 'whatsapp':
      // Test chat context
      console.log('  Testing chat context extraction...');
      const waContext = await extractChatContext(page, 'whatsapp', 8);
      console.log(`  ✅ Found ${waContext.length} messages`);

      if (waContext.length > 0) {
        console.log('  Recent messages:');
        waContext.slice(-3).forEach((msg, i) => {
          console.log(`    ${i + 1}. ${msg.role}: ${msg.text.slice(0, 60)}...`);
        });
      }

      // Test message generation with context
      console.log('  Testing contextual message generation...');
      const waMsg = await generateOutreachMessage({
        username: randomName,
        goal: 'Follow up conversation',
        tone: 'Casual',
        platform: 'whatsapp',
        chatContext: waContext.slice(-5)
      });
      console.log(`  ✅ Generated: "${waMsg}"`);

      // Try to find a contact
      console.log('  Testing contact search...');
      try {
        const searchBox = await page.waitForSelector('[data-testid="chat-list-search"], [title="Search or start new chat"]', { timeout: 5000 });
        if (searchBox) {
          await searchBox.click();
          await searchBox.fill(randomName);
          await page.waitForTimeout(2000);
          console.log(`  ✅ Searched for: ${randomName}`);
        }
      } catch {
        console.log('  ⚠️  Search box not found');
      }

      tests.push('context_extraction', 'message_gen', 'contact_search');
      break;

    case 'instagram':
      console.log('  Testing chat context...');
      const igContext = await extractChatContext(page, 'instagram', 5);
      console.log(`  ✅ Found ${igContext.length} messages`);

      console.log('  Testing message generation...');
      const igMsg = await generateOutreachMessage({
        username: randomName,
        goal: 'Connect and network',
        tone: 'Casual',
        platform: 'instagram',
        chatContext: igContext.slice(-3)
      });
      console.log(`  ✅ Generated: "${igMsg.slice(0, 60)}..."`);

      tests.push('context', 'message_gen');
      break;

    case 'linkedin':
      console.log('  Testing professional message...');
      const liMsg = await generateOutreachMessage({
        username: randomName,
        goal: 'Professional networking opportunity',
        tone: 'Professional',
        platform: 'linkedin'
      });
      console.log(`  ✅ Generated: "${liMsg.slice(0, 60)}..."`);

      tests.push('message_gen');
      break;

    case 'twitter':
      console.log('  Testing tweet/DM generation...');
      const twMsg = await generateOutreachMessage({
        username: randomName,
        goal: 'Engage with their content',
        tone: 'Casual',
        platform: 'twitter'
      });
      console.log(`  ✅ Generated: "${twMsg.slice(0, 60)}..."`);

      tests.push('message_gen');
      break;

    case 'gmail':
      console.log('  Testing email composition...');
      const email = await generateOutreachMessage({
        username: randomName,
        goal: 'Introduction and collaboration proposal',
        tone: 'Professional',
        platform: 'gmail'
      });
      console.log(`  ✅ Generated: "${email.slice(0, 60)}..."`);

      // Try to open compose
      console.log('  Testing compose window...');
      const composeBtn = await page.locator('div[role="button"][aria-label*="Compose"]').first();
      if (composeBtn) {
        await composeBtn.click();
        await page.waitForTimeout(2000);
        console.log('  ✅ Opened compose');
        tests.push('email_gen', 'compose');
      } else {
        tests.push('email_gen');
      }
      break;

    case 'facebook':
      console.log('  Testing Messenger...');
      await page.goto('https://facebook.com/messages');
      await page.waitForTimeout(3000);

      const fbContext = await extractChatContext(page, 'facebook', 5);
      console.log(`  ✅ Found ${fbContext.length} messages`);

      const fbMsg = await generateOutreachMessage({
        username: randomName,
        goal: 'Catch up and say hi',
        tone: 'Friendly',
        platform: 'facebook'
      });
      console.log(`  ✅ Generated: "${fbMsg.slice(0, 60)}..."`);

      tests.push('context', 'message_gen');
      break;
  }

  return tests;
}

// Run test
testWithProfile().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
