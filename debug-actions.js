#!/usr/bin/env node
// Debug script to trace why actions aren't executing

import { chromium } from 'playwright';

const DEBUG = true;

async function debugAction(platform, action, username) {
  console.log(`\n========================================`);
  console.log(`DEBUGGING: ${platform} - ${action} - ${username}`);
  console.log(`========================================\n`);
  
  // Connect to browser
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const context = browser.contexts()[0] || await browser.newContext();
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  
  console.log(`[1] Connected to browser`);
  console.log(`[2] Current URL: ${page.url()}`);
  
  // Navigate to platform
  const urls = {
    instagram: 'https://www.instagram.com/',
    twitter: 'https://x.com/home',
    linkedin: 'https://www.linkedin.com/feed/',
    facebook: 'https://www.facebook.com/',
    whatsapp: 'https://web.whatsapp.com/',
  };
  
  await page.goto(urls[platform]);
  await page.waitForTimeout(3000);
  console.log(`[3] Navigated to ${platform}: ${page.url()}`);
  
  // Check if logged in
  const loginChecks = {
    instagram: async () => {
      const loginBtn = await page.locator('input[name="username"]').count();
      return loginBtn === 0;
    },
    twitter: async () => {
      const loginBtn = await page.locator('input[autocomplete="username"]').count();
      return loginBtn === 0;
    },
    linkedin: async () => {
      const loginBtn = await page.locator('input#username').count();
      return loginBtn === 0;
    },
    facebook: async () => {
      const loginBtn = await page.locator('input[name="email"]').count();
      return loginBtn === 0;
    },
    whatsapp: async () => {
      const qr = await page.locator('canvas[aria-label*="Scan"]').count();
      return qr === 0;
    },
  };
  
  const isLoggedIn = await loginChecks[platform]();
  console.log(`[4] Logged in: ${isLoggedIn}`);
  
  if (!isLoggedIn) {
    console.log(`❌ NOT LOGGED IN TO ${platform.toUpperCase()} - Please log in first`);
    await browser.close();
    return;
  }
  
  // Debug specific actions
  if (action === 'follow' || action === 'open_profile') {
    // Navigate to profile
    const profileUrl = platform === 'twitter' ? `https://x.com/${username}` :
                       platform === 'instagram' ? `https://www.instagram.com/${username}/` :
                       platform === 'linkedin' ? `https://www.linkedin.com/in/${username}/` :
                       `https://www.facebook.com/${username}`;
    
    console.log(`[5] Navigating to profile: ${profileUrl}`);
    await page.goto(profileUrl);
    await page.waitForTimeout(3000);
    console.log(`[6] Current URL after navigation: ${page.url()}`);
    
    // Check what buttons are available
    const buttons = await page.locator('button, div[role="button"]').all();
    console.log(`[7] Found ${buttons.length} buttons on page`);
    
    for (let i = 0; i < Math.min(10, buttons.length); i++) {
      const text = await buttons[i].textContent().catch(() => '');
      const ariaLabel = await buttons[i].getAttribute('aria-label').catch(() => '');
      if (text.trim() || ariaLabel) {
        console.log(`    Button ${i}: text="${text.trim().slice(0, 30)}" aria-label="${ariaLabel.slice(0, 30)}"`);
      }
    }
  }
  
  if (action === 'send_message') {
    if (platform === 'whatsapp') {
      // Search for contact
      console.log(`[5] Searching for contact: ${username}`);
      const searchBox = await page.locator('div[contenteditable="true"][data-tab="3"], div[role="textbox"]').first();
      if (await searchBox.count() > 0) {
        await searchBox.click();
        await searchBox.type(username);
        await page.waitForTimeout(1000);
        console.log(`[6] Typed username in search`);
        
        // Click on result
        const result = await page.locator('div[role="listitem"]').first();
        if (await result.count() > 0) {
          await result.click();
          console.log(`[7] Clicked on search result`);
          await page.waitForTimeout(2000);
        }
      }
      
      // Check for composer
      const composer = await page.locator('div[contenteditable="true"][data-tab="10"], footer div[contenteditable="true"]').first();
      console.log(`[8] Composer found: ${await composer.count() > 0}`);
      if (await composer.count() > 0) {
        const isVisible = await composer.isVisible();
        console.log(`[9] Composer visible: ${isVisible}`);
      }
    }
  }
  
  console.log(`\n========================================`);
  console.log(`DEBUG COMPLETE`);
  console.log(`========================================\n`);
  
  await browser.close();
}

// Run debug for specific platform/action
const platform = process.argv[2] || 'instagram';
const action = process.argv[3] || 'follow';
const username = process.argv[4] || 'testuser';

debugAction(platform, action, username).catch(console.error);
