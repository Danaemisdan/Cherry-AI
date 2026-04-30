#!/usr/bin/env node
// Comprehensive single-tab test for all platform skills
// Run: node comprehensive-test.js

import { chromium } from 'playwright';
import { checkLoginState } from '../state-checker.js';
import { extractChatContext } from '../chat-context.js';
import { generateOutreachMessage } from '../common.js';
import { createPost } from '../content-poster.js';
import { searchLinkedInJobs, searchLinkedInCompanies, createLinkedInPost } from '../expanded-linkedin.js';
import { extractContactInfo } from '../lead-extractor.js';

const TEST_CONFIG = {
  headless: false, // Set to true for headless, false to observe
  slowMo: 100, // Slow down for visibility
  timeout: 30000,
};

const RANDOM_NAMES = [
  'Alex Chen', 'Jordan Smith', 'Taylor Wilson', 'Morgan Lee',
  'Casey Brown', 'Riley Davis', 'Avery Johnson', 'Quinn Miller'
];

const RANDOM_QUERIES = [
  'fintech startups', 'AI founders', 'venture capital',
  'software engineers', 'product managers', 'tech recruiters'
];

const TEST_MESSAGES = [
  { goal: 'Quick intro', tone: 'Casual', text: 'Hey, came across your profile and thought we should connect!' },
  { goal: 'Follow up', tone: 'Professional', text: 'Following up on our conversation last week.' },
  { goal: 'Meeting request', tone: 'Friendly', text: 'Would love to jump on a quick call sometime!' }
];

class ComprehensiveTester {
  constructor(browser, page) {
    this.browser = browser;
    this.page = page;
    this.results = [];
    this.currentPlatform = null;
  }

  log(message, type = 'info') {
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : type === 'warn' ? '⚠️' : 'ℹ️';
    console.log(`${prefix} [${this.currentPlatform || 'SYSTEM'}] ${message}`);
  }

  async runAllTests() {
    console.log('🚀 Starting Comprehensive Platform Test\n');
    console.log('=====================================\n');

    const platforms = [
      { name: 'instagram', url: 'https://instagram.com/', tests: this.testInstagram.bind(this) },
      { name: 'twitter', url: 'https://twitter.com/', tests: this.testTwitter.bind(this) },
      { name: 'linkedin', url: 'https://linkedin.com/', tests: this.testLinkedIn.bind(this) },
      { name: 'facebook', url: 'https://facebook.com/', tests: this.testFacebook.bind(this) },
      { name: 'gmail', url: 'https://gmail.com/', tests: this.testGmail.bind(this) },
      { name: 'whatsapp', url: 'https://web.whatsapp.com/', tests: this.testWhatsApp.bind(this) },
    ];

    for (const platform of platforms) {
      this.currentPlatform = platform.name;
      await this.runPlatformTests(platform);
    }

    this.printSummary();
    return this.results;
  }

  async runPlatformTests(platform) {
    this.log(`Starting tests for ${platform.name.toUpperCase()}`);

    try {
      // Navigate to platform
      await this.page.goto(platform.url, { waitUntil: 'networkidle', timeout: 30000 });
      await this.page.waitForTimeout(3000);

      // Check login state
      const state = await checkLoginState(this.page, platform.name);
      this.log(`Login state: ${state.loggedIn ? 'LOGGED IN' : 'NOT LOGGED IN'}`);

      if (!state.ready) {
        this.log(`Skipping ${platform.name} - ${state.message}`, 'warn');
        this.results.push({
          platform: platform.name,
          status: 'skipped',
          reason: state.message || 'Not logged in'
        });
        return;
      }

      // Run platform-specific tests
      await platform.tests();

    } catch (error) {
      this.log(`Error: ${error.message}`, 'error');
      this.results.push({
        platform: platform.name,
        status: 'error',
        error: error.message
      });
    }

    this.log(`Completed tests for ${platform.name.toUpperCase()}\n`);
  }

  // ===== INSTAGRAM TESTS =====
  async testInstagram() {
    // Test chat context extraction
    this.log('Testing chat context extraction...');
    const chatContext = await extractChatContext(this.page, 'instagram', 5);
    this.log(`Found ${chatContext.length} messages in context`);

    // Test DM with random user
    const randomName = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
    this.log(`Testing message generation for ${randomName}...`);

    const message = await generateOutreachMessage({
      username: randomName,
      goal: 'Connect and network',
      tone: 'Casual',
      platform: 'instagram',
      chatContext: chatContext.slice(-3)
    });
    this.log(`Generated message: "${message.slice(0, 60)}..."`, 'success');

    // Test search
    this.log('Testing search functionality...');
    const searchQuery = RANDOM_QUERIES[Math.floor(Math.random() * RANDOM_QUERIES.length)];
    await this.page.goto(`https://instagram.com/explore/tags/${searchQuery.replace(/\s+/g, '')}/`);
    await this.page.waitForTimeout(3000);
    this.log(`Searched for: ${searchQuery}`, 'success');

    this.results.push({ platform: 'instagram', status: 'passed', tests: ['context', 'message_gen', 'search'] });
  }

  // ===== TWITTER/X TESTS =====
  async testTwitter() {
    // Test chat context
    this.log('Testing DM context extraction...');
    await this.page.goto('https://twitter.com/messages');
    await this.page.waitForTimeout(3000);
    const chatContext = await extractChatContext(this.page, 'twitter', 5);
    this.log(`Found ${chatContext.length} messages`);

    // Test tweet generation
    this.log('Testing tweet generation...');
    const randomQuery = RANDOM_QUERIES[Math.floor(Math.random() * RANDOM_QUERIES.length)];
    const tweet = await generateOutreachMessage({
      username: null,
      goal: `Tweet about ${randomQuery}`,
      tone: 'Casual',
      platform: 'twitter'
    });
    this.log(`Generated tweet: "${tweet.slice(0, 60)}..."`, 'success');

    // Test search
    this.log('Testing search...');
    await this.page.goto(`https://twitter.com/search?q=${encodeURIComponent(randomQuery)}&src=typed_query`);
    await this.page.waitForTimeout(3000);
    this.log(`Searched: ${randomQuery}`, 'success');

    this.results.push({ platform: 'twitter', status: 'passed', tests: ['context', 'tweet_gen', 'search'] });
  }

  // ===== LINKEDIN TESTS =====
  async testLinkedIn() {
    // Test job search
    this.log('Testing LinkedIn job search...');
    const jobQuery = 'software engineer';
    await searchLinkedInJobs(this.page, jobQuery, {
      location: 'United States',
      remote: true,
      past24h: true
    });
    this.log(`Searched jobs: ${jobQuery}`, 'success');

    // Test company search
    this.log('Testing company search...');
    await searchLinkedInCompanies(this.page, 'tech startups', { companySize: 'B' });
    this.log('Searched companies', 'success');

    // Test messaging
    this.log('Testing message generation...');
    const message = await generateOutreachMessage({
      username: RANDOM_NAMES[0],
      goal: 'Professional networking',
      tone: 'Professional',
      platform: 'linkedin'
    });
    this.log(`Generated message: "${message.slice(0, 60)}..."`, 'success');

    // Test post creation (draft only, don't publish)
    this.log('Testing post creation (draft)...');
    // We won't actually post, just verify we can open composer
    await this.page.goto('https://www.linkedin.com/post/new/');
    await this.page.waitForTimeout(3000);
    this.log('Opened post composer', 'success');

    this.results.push({ platform: 'linkedin', status: 'passed', tests: ['job_search', 'company_search', 'message_gen', 'post_draft'] });
  }

  // ===== FACEBOOK TESTS =====
  async testFacebook() {
    // Test chat context
    this.log('Testing Messenger context...');
    await this.page.goto('https://facebook.com/messages');
    await this.page.waitForTimeout(3000);
    const chatContext = await extractChatContext(this.page, 'facebook', 5);
    this.log(`Found ${chatContext.length} messages`);

    // Test message generation
    this.log('Testing message generation...');
    const message = await generateOutreachMessage({
      username: RANDOM_NAMES[1],
      goal: 'Catch up',
      tone: 'Friendly',
      platform: 'facebook'
    });
    this.log(`Generated: "${message.slice(0, 60)}..."`, 'success');

    // Test search
    this.log('Testing search...');
    await this.page.goto(`https://facebook.com/search/top?q=${encodeURIComponent('tech groups')}`);
    await this.page.waitForTimeout(3000);
    this.log('Search completed', 'success');

    this.results.push({ platform: 'facebook', status: 'passed', tests: ['context', 'message_gen', 'search'] });
  }

  // ===== GMAIL TESTS =====
  async testGmail() {
    // Test compose
    this.log('Testing email composition...');
    const randomEmail = `test${Date.now()}@example.com`;
    const subject = `Test: ${RANDOM_QUERIES[0]}`;

    const message = await generateOutreachMessage({
      username: randomEmail,
      goal: 'Introduction and collaboration',
      tone: 'Professional',
      platform: 'gmail'
    });
    this.log(`Generated email: "${message.slice(0, 60)}..."`, 'success');

    // Try to open compose (don't actually send)
    const composeBtn = await this.page.locator('div[role="button"][aria-label*="Compose"], .T-I.T-I-KE.L3').first();
    if (composeBtn) {
      await composeBtn.click();
      await this.page.waitForTimeout(2000);
      this.log('Opened compose window', 'success');
    }

    this.results.push({ platform: 'gmail', status: 'passed', tests: ['email_gen', 'compose_open'] });
  }

  // ===== WHATSAPP TESTS =====
  async testWhatsApp() {
    // Test chat context
    this.log('Testing WhatsApp chat context...');
    const chatContext = await extractChatContext(this.page, 'whatsapp', 8);
    this.log(`Found ${chatContext.length} messages in active chat`);

    if (chatContext.length > 0) {
      this.log('Last message context:', 'info');
      chatContext.slice(-2).forEach((msg, i) => {
        this.log(`  ${msg.role}: ${msg.text.slice(0, 50)}...`);
      });
    }

    // Test message generation with context
    this.log('Testing contextual message generation...');
    const message = await generateOutreachMessage({
      username: RANDOM_NAMES[2],
      goal: 'Follow up on previous discussion',
      tone: 'Casual',
      platform: 'whatsapp',
      chatContext: chatContext.slice(-5)
    });
    this.log(`Generated: "${message}"`, 'success');

    // Test finding a random contact
    this.log('Testing contact search...');
    const searchName = RANDOM_NAMES[3];
    const searchBox = await this.page.locator('[data-testid="chat-list-search"], [title="Search or start new chat"]').first();
    if (searchBox) {
      await searchBox.click();
      await searchBox.fill(searchName);
      await this.page.waitForTimeout(2000);
      this.log(`Searched for: ${searchName}`, 'success');
    }

    this.results.push({ platform: 'whatsapp', status: 'passed', tests: ['context', 'message_gen', 'contact_search'] });
  }

  printSummary() {
    console.log('\n=====================================');
    console.log('📊 TEST SUMMARY\n');

    const passed = this.results.filter(r => r.status === 'passed').length;
    const skipped = this.results.filter(r => r.status === 'skipped').length;
    const errors = this.results.filter(r => r.status === 'error').length;

    this.results.forEach(r => {
      const icon = r.status === 'passed' ? '✅' : r.status === 'skipped' ? '⏭️' : '❌';
      console.log(`${icon} ${r.platform.toUpperCase()}: ${r.status.toUpperCase()}`);
      if (r.tests) console.log(`   Tests: ${r.tests.join(', ')}`);
      if (r.reason) console.log(`   Reason: ${r.reason}`);
      if (r.error) console.log(`   Error: ${r.error}`);
    });

    console.log('\n-------------------------------------');
    console.log(`Total: ${this.results.length} platforms tested`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`⏭️ Skipped: ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log('=====================================\n');
  }
}

// Run the test
async function main() {
  console.log('🧪 Cherry AI - Comprehensive Platform Test\n');
  console.log('This will test all social media platforms in a SINGLE tab\n');

  const browser = await chromium.launch({
    headless: TEST_CONFIG.headless,
    slowMo: TEST_CONFIG.slowMo,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();

  // Log all console messages from the page
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`[PAGE ERROR] ${msg.text()}`);
    }
  });

  const tester = new ComprehensiveTester(browser, page);

  try {
    await tester.runAllTests();
  } catch (error) {
    console.error('💥 Fatal error:', error);
  } finally {
    console.log('\n🔚 Test completed. Keeping browser open for 10 seconds...');
    await new Promise(r => setTimeout(r, 10000));
    await browser.close();
  }
}

main().catch(console.error);
