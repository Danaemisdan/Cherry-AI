// Platform state checking utilities
export async function checkLoginState(page, platform) {
  const checks = {
    instagram: async () => {
      try {
        await page.waitForSelector('[data-testid="user-avatar"], a[href*="/direct/inbox"], nav a[href*="/accounts/edit"]', { timeout: 5000 });
        return { loggedIn: true, ready: true };
      } catch {
        const hasLoginBtn = await page.locator('button:has-text("Log in"), a:has-text("Log in"), input[name="username"]').count() > 0;
        return { loggedIn: false, ready: false, needsLogin: hasLoginBtn, message: 'Please log in to Instagram' };
      }
    },
    twitter: async () => {
      try {
        await page.waitForSelector('[data-testid="SideNav_AccountSwitcher_Button"], a[href="/compose/tweet"], [data-testid="AppTabBar_DirectMessage_Link"]', { timeout: 5000 });
        return { loggedIn: true, ready: true };
      } catch {
        const hasLoginBtn = await page.locator('a[href="/login"], button:has-text("Sign in")').count() > 0;
        return { loggedIn: false, ready: false, needsLogin: hasLoginBtn, message: 'Please log in to Twitter/X' };
      }
    },
    linkedin: async () => {
      try {
        // Multiple checks for logged-in state - some may fail due to lazy loading
        const checks = await Promise.allSettled([
          page.waitForSelector('.global-nav__me, .feed-identity-module, #global-nav, nav.global-nav', { timeout: 3000 }),
          page.waitForSelector('[data-testid="global-nav__me"], .profile-rail-card, .identity-hub', { timeout: 3000 }),
          page.waitForSelector('a[href*="/in/"], button[aria-label*="profile"]', { timeout: 3000 }),
        ]);
        const anySuccess = checks.some(c => c.status === 'fulfilled');
        if (anySuccess) return { loggedIn: true, ready: true };

        // Fallback: check if we're on a feed/profile page without login prompts
        const url = page.url();
        const bodyText = await page.locator('body').innerText().catch(() => '');
        const hasFeedContent = bodyText.includes('feed') || bodyText.includes('LinkedIn') || url.includes('/feed/') || url.includes('/in/');
        const hasLoginPrompt = bodyText.includes('Sign in') || bodyText.includes('Join now') || await page.locator('.nav__button-secondary, a:has-text("Sign in"), button:has-text("Sign in")').count() > 0;

        if (hasFeedContent && !hasLoginPrompt) {
          return { loggedIn: true, ready: true };
        }

        return { loggedIn: false, ready: false, needsLogin: hasLoginPrompt, message: 'Please log in to LinkedIn' };
      } catch {
        return { loggedIn: false, ready: false, needsLogin: true, message: 'Please log in to LinkedIn' };
      }
    },
    facebook: async () => {
      try {
        await page.waitForSelector('[aria-label="Facebook"], [aria-label="Home"], a[href="/messages/"]', { timeout: 5000 });
        return { loggedIn: true, ready: true };
      } catch {
        const hasLoginBtn = await page.locator('#email, #pass, button[name="login"]').count() > 0;
        return { loggedIn: false, ready: false, needsLogin: hasLoginBtn, message: 'Please log in to Facebook' };
      }
    },
    gmail: async () => {
      try {
        await page.waitForSelector('div[role="button"][aria-label="Compose"], a[href="#inbox"], .gb_ea, [data-testid="compose-button"]', { timeout: 5000 });
        return { loggedIn: true, ready: true };
      } catch {
        const hasLoginBtn = await page.locator('#identifierId, input[type="email"], button:has-text("Sign in")').count() > 0;
        return { loggedIn: false, ready: false, needsLogin: hasLoginBtn, message: 'Please log in to Gmail' };
      }
    },
    whatsapp: async () => {
      try {
        await page.waitForSelector('[data-testid="chat-list"], [data-testid="menu-bar-menu"], ._3XTHr', { timeout: 5000 });
        return { loggedIn: true, ready: true };
      } catch {
        const hasQr = await page.locator('[data-testid="qr-code"], ._2EZ_m, canvas').count() > 0;
        return { loggedIn: false, ready: false, needsLogin: hasQr, needsQR: hasQr, message: hasQr ? 'Scan QR code with your phone' : 'Please open WhatsApp Web' };
      }
    },
  };

  const checker = checks[platform];
  if (!checker) return { loggedIn: false, ready: false, message: 'Unknown platform' };

  return await checker();
}

export async function ensurePlatformReadyWithState(page, platform) {
  const state = await checkLoginState(page, platform);

  if (!state.loggedIn) {
    throw new Error(`Platform ${platform} not ready: ${state.message}`);
  }

  return state;
}
