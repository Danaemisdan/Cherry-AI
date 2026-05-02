#!/usr/bin/env node
// Comprehensive platform test - verifies all DM and posting fixes

import { chromium } from 'playwright';
import { instagramHandler } from './packages/platform-skills/src/handlers/instagram.js';
import { twitterHandler } from './packages/platform-skills/src/handlers/twitter.js';
import { linkedinHandler } from './packages/platform-skills/src/handlers/linkedin.js';
import { facebookHandler } from './packages/platform-skills/src/handlers/facebook.js';
import { whatsappHandler } from './packages/platform-skills/src/handlers/whatsapp.js';
import { gmailHandler } from './packages/platform-skills/src/handlers/gmail.js';

const TEST_RESULTS = {
  instagram: { dm: false, post: false, comment: false },
  twitter: { dm: false, post: false, comment: false },
  linkedin: { dm: false, post: false, comment: false },
  facebook: { dm: false, post: false, comment: false },
  whatsapp: { dm: false },
  gmail: { send: false },
};

async function testPlatform(handler, platform, testUsername) {
  console.log(`\n=== Testing ${platform.toUpperCase()} ===`);
  
  const mockBrowser = {
    page: null,
    wsEndpoint: () => 'ws://localhost:9222',
  };
  
  // Test DM
  try {
    console.log(`[${platform}] Testing DM to ${testUsername}...`);
    const dmResult = await handler.execute({
      step: {
        action: 'draft_message',
        platform,
        args: { username: testUsername, messageGoal: 'Test message', tone: 'friendly' }
      },
      attachedBrowser: mockBrowser
    });
    
    if (dmResult.status === 'ready' && dmResult.data?.preview) {
      console.log(`✅ ${platform} DM: PASS - Generated: "${dmResult.data.preview.slice(0, 50)}..."`);
      TEST_RESULTS[platform].dm = true;
    } else {
      console.log(`❌ ${platform} DM: FAIL - No preview generated`);
    }
  } catch (error) {
    console.log(`❌ ${platform} DM: FAIL - ${error.message}`);
  }
  
  // Test Post (if applicable)
  if (platform !== 'whatsapp' && platform !== 'gmail') {
    try {
      console.log(`[${platform}] Testing post composition...`);
      const postResult = await handler.execute({
        step: {
          action: 'compose_post',
          platform,
          args: { messageGoal: 'Test post about AI', tone: 'professional' }
        },
        attachedBrowser: mockBrowser
      });
      
      if (postResult.status === 'completed' && postResult.data?.postText) {
        console.log(`✅ ${platform} Post: PASS - Generated: "${postResult.data.postText.slice(0, 50)}..."`);
        TEST_RESULTS[platform].post = true;
      } else {
        console.log(`❌ ${platform} Post: FAIL - No post text generated`);
      }
    } catch (error) {
      console.log(`❌ ${platform} Post: FAIL - ${error.message}`);
    }
  }
  
  // Test Gmail send capability
  if (platform === 'gmail') {
    try {
      console.log(`[${platform}] Testing email composition...`);
      const emailResult = await handler.execute({
        step: {
          action: 'draft_message',
          platform: 'gmail',
          args: { username: 'test@example.com', messageGoal: 'Test email', tone: 'professional' }
        },
        attachedBrowser: mockBrowser
      });
      
      if (emailResult.status === 'ready' && emailResult.data?.preview) {
        console.log(`✅ ${platform} Email: PASS - Generated: "${emailResult.data.preview.slice(0, 50)}..."`);
        TEST_RESULTS[platform].send = true;
      } else {
        console.log(`❌ ${platform} Email: FAIL - No email generated`);
      }
    } catch (error) {
      console.log(`❌ ${platform} Email: FAIL - ${error.message}`);
    }
  }
}

async function runTests() {
  console.log('================================');
  console.log('CHERRY AI - PLATFORM TEST SUITE');
  console.log('================================');
  console.log('Testing all platform fixes...\n');
  
  // Test each platform with a dummy username (tests code paths, not actual sending)
  await testPlatform(instagramHandler, 'instagram', 'test_user_123');
  await testPlatform(twitterHandler, 'twitter', 'testuser');
  await testPlatform(linkedinHandler, 'linkedin', 'Test User');
  await testPlatform(facebookHandler, 'facebook', 'test.user');
  await testPlatform(whatsappHandler, 'whatsapp', 'Test Contact');
  await testPlatform(gmailHandler, 'gmail', 'test@example.com');
  
  // Summary
  console.log('\n================================');
  console.log('TEST SUMMARY');
  console.log('================================');
  
  let passed = 0;
  let total = 0;
  
  for (const [platform, results] of Object.entries(TEST_RESULTS)) {
    for (const [test, status] of Object.entries(results)) {
      total++;
      if (status) passed++;
      console.log(`${status ? '✅' : '❌'} ${platform}.${test}`);
    }
  }
  
  console.log(`\n${passed}/${total} tests passed (${Math.round(passed/total*100)}%)`);
  
  if (passed === total) {
    console.log('\n🎉 All platform fixes are working correctly!');
    process.exit(0);
  } else {
    console.log('\n⚠️ Some tests failed. Check logs above.');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
