// Multi-tab automation without focus stealing

import { checkLoginState } from './state-checker.js';

export class MultiTabController {
  constructor(browserController) {
    this.controller = browserController;
    this.tabs = new Map(); // platform -> page
    this.states = new Map(); // platform -> { loggedIn, ready, lastCheck }
  }

  async initTab(platform, url) {
    // Create new tab in background
    const page = await this.controller.newPage({
      viewport: { width: 1280, height: 800 }
    });

    // Navigate to platform
    await page.goto(url, { waitUntil: 'networkidle' });

    // Check state without stealing focus
    const state = await this.quickStateCheck(page, platform);
    this.tabs.set(platform, page);
    this.states.set(platform, { ...state, lastCheck: Date.now() });

    return { page, state };
  }

  async quickStateCheck(page, platform) {
    // Minimal check - just see if logged in indicators exist
    try {
      const checks = {
        instagram: '[data-testid="user-avatar"], a[href*="/direct/inbox"]',
        twitter: '[data-testid="SideNav_AccountSwitcher_Button"], a[href="/compose/tweet"]',
        linkedin: '.global-nav__me, .feed-identity-module',
        facebook: '[aria-label="Facebook"], [aria-label="Home"]',
        gmail: 'div[role="button"][aria-label="Compose"], a[href="#inbox"]',
        whatsapp: '[data-testid="chat-list"], [data-testid="menu-bar-menu"]',
      };

      const selector = checks[platform];
      if (!selector) return { loggedIn: false, ready: false };

      const hasElement = await page.locator(selector).first().isVisible().catch(() => false);

      return {
        loggedIn: hasElement,
        ready: hasElement,
        lastCheck: Date.now()
      };
    } catch (error) {
      return { loggedIn: false, ready: false, error: error.message };
    }
  }

  async runInBackground(platform, action, args = {}) {
    let page = this.tabs.get(platform);

    // Init if not exists
    if (!page) {
      const urls = {
        instagram: 'https://instagram.com/',
        twitter: 'https://twitter.com/',
        linkedin: 'https://linkedin.com/',
        facebook: 'https://facebook.com/',
        gmail: 'https://gmail.com/',
        whatsapp: 'https://web.whatsapp.com/',
      };

      const result = await this.initTab(platform, urls[platform]);
      page = result.page;

      if (!result.state.ready) {
        return {
          success: false,
          needsAuth: true,
          message: `Please log in to ${platform} in the opened tab`
        };
      }
    }

    // Run action without bringing to foreground
    try {
      // Keep page in background - don't focus
      const result = await this.executeAction(page, platform, action, args);

      // Update state
      this.states.set(platform, {
        ...this.states.get(platform),
        lastAction: action,
        lastActionTime: Date.now()
      });

      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async executeAction(page, platform, action, args) {
    // Dynamic import to avoid circular deps
    const handlers = await import('./index.js');
    const handler = handlers.default[platform];

    if (!handler) {
      throw new Error(`No handler for platform: ${platform}`);
    }

    // Execute action in background context
    const step = {
      action,
      args,
      platform
    };

    return await handler(page, step);
  }

  async runParallel(actions) {
    // Run multiple actions across platforms in parallel
    const promises = actions.map(({ platform, action, args }) =>
      this.runInBackground(platform, action, args)
    );

    return await Promise.allSettled(promises);
  }

  async getAllStates() {
    const results = new Map();

    for (const [platform, page] of this.tabs) {
      const state = await this.quickStateCheck(page, platform);
      this.states.set(platform, { ...state, lastCheck: Date.now() });
      results.set(platform, state);
    }

    return results;
  }

  async closeTab(platform) {
    const page = this.tabs.get(platform);
    if (page) {
      await page.close();
      this.tabs.delete(platform);
      this.states.delete(platform);
    }
  }

  async closeAll() {
    for (const [platform, page] of this.tabs) {
      await page.close();
    }
    this.tabs.clear();
    this.states.clear();
  }
}

// Background automation scheduler
export class BackgroundScheduler {
  constructor(multiTabController) {
    this.controller = multiTabController;
    this.jobs = new Map();
    this.running = false;
  }

  addJob(id, { platforms, action, args, interval, runImmediately = false }) {
    this.jobs.set(id, {
      id,
      platforms,
      action,
      args,
      interval, // milliseconds
      lastRun: 0,
      runCount: 0,
      enabled: true
    });

    if (runImmediately) {
      this.runJob(id);
    }
  }

  removeJob(id) {
    this.jobs.delete(id);
  }

  async runJob(id) {
    const job = this.jobs.get(id);
    if (!job || !job.enabled) return;

    const actions = job.platforms.map(platform => ({
      platform,
      action: job.action,
      args: job.args
    }));

    const results = await this.controller.runParallel(actions);

    job.lastRun = Date.now();
    job.runCount++;

    return results;
  }

  start() {
    if (this.running) return;
    this.running = true;

    this.intervalId = setInterval(() => {
      const now = Date.now();

      for (const [id, job] of this.jobs) {
        if (job.enabled && (now - job.lastRun) >= job.interval) {
          this.runJob(id);
        }
      }
    }, 5000); // Check every 5 seconds
  }

  stop() {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getStatus() {
    return {
      running: this.running,
      jobs: [...this.jobs.values()].map(j => ({
        id: j.id,
        enabled: j.enabled,
        runCount: j.runCount,
        lastRun: j.lastRun,
        platforms: j.platforms
      }))
    };
  }
}
