import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

export class ManagedBrowserController {
  constructor(options = {}) {
    this.options = {
      profileRoot: path.resolve(process.cwd(), '.cherry-agent/profiles'),
      headless: process.env.CHERRY_MANAGED_HEADLESS !== 'false',
      ...options,
    };
    this.contexts = new Map();
  }

  ensureProfileDir(profileId = 'default') {
    const profileDir = path.join(this.options.profileRoot, profileId);
    fs.mkdirSync(profileDir, { recursive: true });
    return profileDir;
  }

  async getContext(profileId = 'default') {
    if (this.contexts.has(profileId)) {
      return this.contexts.get(profileId);
    }

    const profileDir = this.ensureProfileDir(profileId);
    const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless: this.options.headless,
    });

    this.contexts.set(profileId, context);
    return context;
  }

  async openTabs({ profileId = 'default', urls = [] }) {
    const context = await this.getContext(profileId);
    const pages = [];

    for (const url of urls) {
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      pages.push(page);
    }

    return pages;
  }

  async scrapePages({ profileId = 'default', urls = [] }) {
    const pages = await this.openTabs({ profileId, urls });
    const results = [];

    for (const page of pages) {
      const text = await page.locator('body').innerText().catch(() => '');
      results.push({
        title: await page.title().catch(() => ''),
        url: page.url(),
        text: text.slice(0, 12000),
      });
    }

    return results;
  }

  async closeAll() {
    for (const context of this.contexts.values()) {
      await context.close();
    }
    this.contexts.clear();
  }
}
