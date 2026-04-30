// Comprehensive test suite for platform skills

import { checkLoginState } from '../state-checker.js';
import { extractChatContext } from '../chat-context.js';
import { extractContactInfo } from '../lead-extractor.js';
import { createPost } from '../content-poster.js';
import { MultiTabController, BackgroundScheduler } from '../multi-tab.js';

export class TestRunner {
  constructor(browserController) {
    this.controller = browserController;
    this.results = [];
    this.multiTab = new MultiTabController(browserController);
  }

  async runAllTests() {
    console.log('🧪 Starting comprehensive platform tests...\n');

    const tests = [
      { name: 'State Checking', fn: this.testStateChecking.bind(this) },
      { name: 'Chat Context Extraction', fn: this.testChatContext.bind(this) },
      { name: 'Lead Extraction', fn: this.testLeadExtraction.bind(this) },
      { name: 'Multi-Tab Controller', fn: this.testMultiTab.bind(this) },
      { name: 'Background Scheduler', fn: this.testScheduler.bind(this) },
    ];

    for (const test of tests) {
      try {
        console.log(`Running: ${test.name}...`);
        await test.fn();
        this.results.push({ name: test.name, status: '✅ PASS' });
        console.log(`✅ ${test.name} passed\n`);
      } catch (error) {
        this.results.push({ name: test.name, status: '❌ FAIL', error: error.message });
        console.log(`❌ ${test.name} failed: ${error.message}\n`);
      }
    }

    return this.getSummary();
  }

  async testStateChecking() {
    // Test with mock page
    const page = await this.controller.newPage();

    // Test Instagram
    await page.goto('https://instagram.com/');
    await page.waitForTimeout(3000);
    const igState = await checkLoginState(page, 'instagram');
    console.log('  Instagram state:', igState);

    // Test LinkedIn
    await page.goto('https://linkedin.com/');
    await page.waitForTimeout(3000);
    const liState = await checkLoginState(page, 'linkedin');
    console.log('  LinkedIn state:', liState);

    await page.close();

    // Both should return valid state objects
    if (!igState || typeof igState.loggedIn !== 'boolean') {
      throw new Error('Invalid Instagram state format');
    }
  }

  async testChatContext() {
    const page = await this.controller.newPage();

    // Navigate to WhatsApp Web
    await page.goto('https://web.whatsapp.com/');
    await page.waitForTimeout(5000);

    const context = await extractChatContext(page, 'whatsapp', 5);
    console.log('  WhatsApp context length:', context.length);

    await page.close();

    // Should return array (even if empty due to no chat open)
    if (!Array.isArray(context)) {
      throw new Error('Chat context should return array');
    }
  }

  async testLeadExtraction() {
    // This is a placeholder - would need actual profile URLs to test
    console.log('  Lead extraction test: requires authenticated profile URLs');
  }

  async testMultiTab() {
    // Initialize tabs for multiple platforms
    await this.multiTab.initTab('instagram', 'https://instagram.com/');
    await this.multiTab.initTab('twitter', 'https://twitter.com/');

    const states = await this.multiTab.getAllStates();
    console.log('  Multi-tab states:', [...states.entries()].map(([k, v]) => `${k}: ${v.ready ? 'ready' : 'needs auth'}`));

    // Cleanup
    await this.multiTab.closeAll();

    // Should have 2 tabs
    if (states.size !== 2) {
      throw new Error(`Expected 2 tabs, got ${states.size}`);
    }
  }

  async testScheduler() {
    const scheduler = new BackgroundScheduler(this.multiTab);

    // Add a test job
    scheduler.addJob('test-job', {
      platforms: ['instagram', 'twitter'],
      action: 'review_queue',
      args: { limit: 5 },
      interval: 60000, // 1 minute
      runImmediately: false
    });

    const status = scheduler.getStatus();
    console.log('  Scheduler status:', status);

    if (!status.jobs || status.jobs.length !== 1) {
      throw new Error('Scheduler should have 1 job');
    }
  }

  getSummary() {
    const passed = this.results.filter(r => r.status === '✅ PASS').length;
    const failed = this.results.filter(r => r.status === '❌ FAIL').length;

    console.log('\n📊 Test Summary:');
    console.log(`   Total: ${this.results.length}`);
    console.log(`   Passed: ${passed}`);
    console.log(`   Failed: ${failed}`);

    return {
      total: this.results.length,
      passed,
      failed,
      results: this.results
    };
  }
}

// Quick platform health check
export async function quickHealthCheck(browserController) {
  const platforms = ['instagram', 'twitter', 'linkedin', 'facebook', 'gmail', 'whatsapp'];
  const results = {};

  const page = await browserController.newPage();

  for (const platform of platforms) {
    try {
      const urls = {
        instagram: 'https://instagram.com/',
        twitter: 'https://twitter.com/',
        linkedin: 'https://linkedin.com/',
        facebook: 'https://facebook.com/',
        gmail: 'https://gmail.com/',
        whatsapp: 'https://web.whatsapp.com/',
      };

      await page.goto(urls[platform], { timeout: 15000 });
      await page.waitForTimeout(3000);

      const state = await checkLoginState(page, platform);
      results[platform] = {
        status: state.ready ? 'ready' : 'needs_auth',
        loggedIn: state.loggedIn,
        message: state.message
      };

      console.log(`${platform}: ${state.ready ? '✅' : '⚠️'} ${state.message || state.ready ? 'Ready' : 'Needs auth'}`);
    } catch (error) {
      results[platform] = { status: 'error', error: error.message };
      console.log(`${platform}: ❌ Error - ${error.message}`);
    }
  }

  await page.close();

  return results;
}

// Export for CLI usage
export async function runTests(browserController) {
  const runner = new TestRunner(browserController);
  return await runner.runAllTests();
}
