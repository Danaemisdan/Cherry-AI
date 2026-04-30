#!/usr/bin/env node
// CLI test runner for platform skills

import { chromium } from 'playwright';
import { TestRunner, quickHealthCheck } from './runner.js';

const args = process.argv.slice(2);
const command = args[0] || 'help';

async function main() {
  const browser = await chromium.launch({ headless: false });

  try {
    switch (command) {
      case 'health':
        console.log('🏥 Running health check on all platforms...\n');
        const context = await browser.newContext();
        const page = await context.newPage();

        // Mock browser controller for health check
        const controller = {
          newPage: async () => page,
        };

        const results = await quickHealthCheck(controller);
        console.log('\n📊 Results:', JSON.stringify(results, null, 2));
        break;

      case 'full':
        console.log('🧪 Running full test suite...\n');
        const runnerContext = await browser.newContext();
        const runnerController = {
          newPage: async () => runnerContext.newPage(),
        };

        const runner = new TestRunner(runnerController);
        const summary = await runner.runAllTests();
        console.log('\n' + JSON.stringify(summary, null, 2));
        break;

      case 'help':
      default:
        console.log(`
🍒 Cherry AI Platform Skills Test CLI

Usage: node cli.js [command]

Commands:
  health    Quick health check - checks login state on all platforms
  full      Full test suite - runs all platform skill tests
  help      Show this help message

Examples:
  node cli.js health
  node cli.js full
        `);
        break;
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
