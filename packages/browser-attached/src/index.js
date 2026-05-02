import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

function defaultChromeUserDataDir() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  }
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
  }
  return path.join(home, '.config', 'google-chrome');
}

function defaultCherryDebugUserDataDir() {
  return path.join(os.homedir(), '.cherry-agent', 'chrome-debug');
}

import { existsSync } from 'node:fs';

function findWindowsChrome() {
  // Check multiple common Chrome installation paths on Windows
  const possiblePaths = [
    // Standard install locations
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    // User-level install (local app data)
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // Other possible locations
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // Microsoft Edge as fallback (also Chromium-based)
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  for (const chromePath of possiblePaths) {
    if (existsSync(chromePath)) {
      return chromePath;
    }
  }

  // Default fallback if none found (will likely fail but we try)
  return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}

function defaultChromeExecutable() {
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  if (process.platform === 'win32') {
    return findWindowsChrome();
  }
  return 'google-chrome';
}

function portFromCdpUrl(cdpUrl) {
  try {
    const parsed = new URL(cdpUrl);
    return Number(parsed.port || 9222);
  } catch {
    return 9222;
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let stderr = '';

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function normalizePath(targetPath) {
  if (!targetPath) return '';
  return path.resolve(targetPath).replace(/[\\/]+$/, '');
}

export class AttachedBrowserController {
  constructor(options = {}) {
    this.options = {
      cdpUrl: process.env.CHERRY_ATTACHED_CDP_URL || 'http://127.0.0.1:9222',
      userDataDir: process.env.CHERRY_CHROME_USER_DATA_DIR || defaultCherryDebugUserDataDir(),
      profileDirectory: process.env.CHERRY_CHROME_PROFILE_DIRECTORY || 'Default',
      chromePath: process.env.CHERRY_CHROME_PATH || defaultChromeExecutable(),
      extensionPath: process.env.CHERRY_EXTENSION_PATH || '',
      autoLaunch: process.env.CHERRY_ATTACHED_AUTO_LAUNCH === 'true',
      takeOverRunning: process.env.CHERRY_ATTACHED_TAKEOVER_RUNNING === 'true',
      restoreLastSession: process.env.CHERRY_RESTORE_LAST_SESSION !== 'false',
      launchTimeoutMs: Number(process.env.CHERRY_ATTACHED_LAUNCH_TIMEOUT_MS || 45000),
      ...options,
    };
    this.browser = null;
    this.launchInFlight = null;
  }

  usesDefaultChromeDataDir() {
    return normalizePath(this.options.userDataDir) === normalizePath(defaultChromeUserDataDir());
  }

  launchConstraintError() {
    if (!this.usesDefaultChromeDataDir()) {
      return '';
    }
    return [
      'Chrome 136+ blocks remote debugging for the default Chrome data directory.',
      `Configured user data dir "${this.options.userDataDir}" is the real Chrome profile root, so Chrome will ignore --remote-debugging-port and ${this.options.cdpUrl} will never open.`,
      `Use a non-standard profile directory instead, for example CHERRY_CHROME_USER_DATA_DIR="${defaultCherryDebugUserDataDir()}".`,
      'If you need Cherry to drive your everyday logged-in Chrome profile, use the extension bridge path instead of CDP.',
    ].join(' ');
  }

  async connect({ allowLaunch = true } = {}) {
    if (this.browser?.isConnected()) return this.browser;
    try {
      this.browser = await chromium.connectOverCDP(this.options.cdpUrl);
    } catch (error) {
      const constraintError = this.launchConstraintError();
      if (constraintError) {
        throw new Error(constraintError);
      }
      if (!allowLaunch || !this.options.autoLaunch) {
        throw new Error(`${error.message}. ${this.launchHint()}`);
      }
      await this.launchChrome();
      this.browser = await chromium.connectOverCDP(this.options.cdpUrl);
    }
    return this.browser;
  }

  launchHint() {
    const extensionFlag = this.options.extensionPath ? ` --load-extension="${this.options.extensionPath}"` : '';
    const restoreFlag = this.options.restoreLastSession ? ' --restore-last-session' : '';
    const constraintError = this.launchConstraintError();
    const suffix = constraintError ? ` ${constraintError}` : '';
    return `Start Chrome with remote debugging on profile "${this.options.profileDirectory}", or set CHERRY_ATTACHED_AUTO_LAUNCH=true. Suggested launch: "${this.options.chromePath}" --remote-debugging-port=${portFromCdpUrl(this.options.cdpUrl)} --user-data-dir="${this.options.userDataDir}" --profile-directory="${this.options.profileDirectory}"${restoreFlag}${extensionFlag}.${suffix}`;
  }

  async debuggerReady() {
    try {
      const response = await fetch(`${this.options.cdpUrl}/json/version`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async waitForDebugger(timeoutMs = this.options.launchTimeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.debuggerReady()) return true;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return false;
  }

  async launchChrome() {
    if (this.launchInFlight) return this.launchInFlight;

    const constraintError = this.launchConstraintError();
    if (constraintError) {
      throw new Error(constraintError);
    }

    const port = portFromCdpUrl(this.options.cdpUrl);
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${this.options.userDataDir}`,
      `--profile-directory=${this.options.profileDirectory}`,
    ];

    if (this.options.restoreLastSession) {
      args.push('--restore-last-session');
    }

    if (this.options.extensionPath) {
      args.push(`--load-extension=${this.options.extensionPath}`);
    }

    this.launchInFlight = (async () => {
      if (this.options.takeOverRunning) {
        await this.restartChromeForDebug();
      }

      const child = spawn(this.options.chromePath, args, {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      const ready = await this.waitForDebugger();
      if (!ready) {
        throw new Error(`Timed out waiting for Chrome debugger at ${this.options.cdpUrl}. ${this.launchHint()}`);
      }
    })();

    try {
      await this.launchInFlight;
    } finally {
      this.launchInFlight = null;
    }
  }

  async restartChromeForDebug() {
    await this.closeRunningChromeGracefully().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  async closeRunningChromeGracefully() {
    if (process.platform === 'darwin') {
      await runCommand('osascript', ['-e', 'tell application "Google Chrome" to quit']).catch(() => {});
      return;
    }

    if (process.platform === 'win32') {
      await runCommand('powershell', [
        '-NoProfile',
        '-Command',
        '$procs = Get-Process chrome -ErrorAction SilentlyContinue; foreach ($p in $procs) { if ($p.MainWindowHandle -ne 0) { $null = $p.CloseMainWindow() } }; Start-Sleep -Seconds 3',
      ]).catch(() => {});
      return;
    }

    await runCommand('sh', ['-lc', 'pkill -TERM -f "(google-chrome|chrome|chromium)" || true']).catch(() => {});
  }

  async listContexts() {
    const browser = await this.connect();
    return browser.contexts();
  }

  async listPages() {
    const contexts = await this.listContexts();
    return contexts.flatMap((context) => context.pages());
  }

  async getPrimaryContext() {
    const [context] = await this.listContexts();
    if (!context) throw new Error('No attached Chrome context found. Start Chrome with remote debugging enabled.');
    return context;
  }

  async listTabs() {
    const pages = await this.listPages();
    return Promise.all(
      pages.map(async (page) => ({
        id: page.guid,
        title: await page.title().catch(() => ''),
        url: page.url(),
      })),
    );
  }

  async openUrls(urls = []) {
    const pages = [];
    for (const url of urls) {
      pages.push(await this.getOrCreatePage({ url }));
    }
    return pages;
  }

  async findPage(predicate) {
    const pages = await this.listPages();
    return pages.find(predicate) || null;
  }

  async getOrCreatePage({ url }) {
    const pages = await this.listPages();
    const existing = pages.find((page) => page.url().includes(url));
    if (existing) {
      // Work in background - do not bring to front
      return existing;
    }

    const context = await this.getPrimaryContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // Work in background - do not focus the new tab
    return page;
  }

  async snapshot({ url }) {
    const page = await this.getOrCreatePage({ url });
    const title = await page.title().catch(() => '');
    const text = await page.locator('body').innerText().catch(() => '');
    return {
      title,
      url: page.url(),
      text: text.slice(0, 12000),
    };
  }

  async status() {
    const ready = await this.debuggerReady();
    if (!ready) {
      return {
        connected: false,
        mode: 'cdp',
        cdpUrl: this.options.cdpUrl,
        profileDirectory: this.options.profileDirectory,
        extensionLoaded: Boolean(this.options.extensionPath),
        tabs: [],
      };
    }

    try {
      const browser = await this.connect({ allowLaunch: false });
      const contexts = browser.contexts();
      const pages = contexts.flatMap((context) => context.pages());
      const tabs = await Promise.all(
        pages.map(async (page) => ({
          id: page.guid,
          title: await page.title().catch(() => ''),
          url: page.url(),
        })),
      );
      return {
        connected: true,
        mode: 'cdp',
        cdpUrl: this.options.cdpUrl,
        profileDirectory: this.options.profileDirectory,
        extensionLoaded: Boolean(this.options.extensionPath),
        tabs,
      };
    } catch {
      return {
        connected: false,
        mode: 'cdp',
        cdpUrl: this.options.cdpUrl,
        profileDirectory: this.options.profileDirectory,
        extensionLoaded: Boolean(this.options.extensionPath),
        tabs: [],
      };
    }
  }

  async close() {
    if (this.browser?.isConnected()) {
      await this.browser.close();
    }
    this.browser = null;
  }
}
