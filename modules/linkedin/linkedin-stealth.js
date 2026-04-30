import CDPController from '../../background/cdp-controller.js';
import StealthEngine from '../../background/stealth-engine.js';
import LLMClient from '../../background/llm-client.js';

export const LinkedInStealthEngine = {
  async executeCommand(tabId, commandType, payload) {
    await StealthEngine.applySpoofing(tabId);

    const urlEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: 'window.location.hostname',
      returnByValue: true
    });

    if (!urlEval.result.value || !urlEval.result.value.includes('linkedin.com')) {
      await CDPController.sendCommand(tabId, 'Page.navigate', { url: 'https://www.linkedin.com/feed/' });
      await StealthEngine.waitForPageLoad(tabId);
      await StealthEngine.sleep(3000);
    }

    StealthEngine.checkAbort();

    if (commandType === 'li_scrape') {
      const results = await this.scrapeSearch(tabId, payload.hashtag, 10);
      return { status: "Scraped " + results.length + " profiles.", type: 'csv', data: results };
    } else if (commandType === 'li_engage') {
      return await this.engageWithUser(tabId, payload.username, payload.userGoal, payload.tonePrompt);
    } else if (commandType === 'li_dm') {
      return await this.sendDM(tabId, payload.username, payload.userGoal, payload.tonePrompt);
    } else if (commandType === 'li_follow') {
      return await this.followUser(tabId, payload.username);
    } else if (commandType === 'li_post') {
      return await this.createPost(tabId, payload.tonePrompt);
    }

    return { status: 'Unknown LinkedIn Command.' };
  },

  // ── Click the search bar (top nav), type the query, press Enter ──────────────
  async _doSearch(tabId, query) {
    // LinkedIn search input is always visible in the top nav bar
    // Selector: the input inside the search typeahead form
    const searchInput = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          // Try multiple known selectors for LinkedIn's search bar
          const selectors = [
            'input.search-global-typeahead__input',
            'input[placeholder="Search"]',
            'input[type="text"][role="combobox"]',
            'form[action*="/search"] input'
          ];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
              el.scrollIntoView({ block: 'center' });
              const rect = el.getBoundingClientRect();
              if (rect.width > 0) {
                return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
              }
            }
          }
          return null;
        })();
      `,
      returnByValue: true
    });

    if (!searchInput.result.value) throw new Error('LinkedIn search bar not found. Are you logged in?');

    const { x, y } = searchInput.result.value;
    await StealthEngine.organicClick(tabId, x, y);
    await StealthEngine.sleep(700);

    // Clear any existing text
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA' });
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA' });
    await StealthEngine.sleep(200);

    await StealthEngine.simulateTyping(tabId, query);
    await StealthEngine.sleep(1500);

    // Press Enter
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, code: 'Enter' });
    await StealthEngine.sleep(60);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, code: 'Enter' });
    await StealthEngine.sleep(4000); // Wait for search results page
  },

  // ── Scrape profiles from People search results ────────────────────────────────
  async scrapeSearch(tabId, targetQuery, maxResults) {
    let results = [];
    StealthEngine.checkAbort();

    await this._doSearch(tabId, targetQuery);

    // Click "People" filter if visible
    const peopleFilterEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent.trim() === 'People');
          if (!btn) return null;
          const rect = btn.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
        })();
      `,
      returnByValue: true
    });

    if (peopleFilterEval.result.value) {
      const { x, y } = peopleFilterEval.result.value;
      await StealthEngine.organicClick(tabId, x, y);
      await StealthEngine.sleep(3000);
    }

    // Gather profile links from the results page
    let profileUrls = [];
    let scrolls = 0;

    while (profileUrls.length < maxResults && scrolls < 6) {
      StealthEngine.checkAbort();
      const linksEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
            return [...new Set(links.map(a => a.href.split('?')[0]).filter(h => h.includes('/in/')))];
          })();
        `,
        returnByValue: true
      });
      const found = linksEval.result.value || [];
      for (const url of found) {
        if (!profileUrls.includes(url) && profileUrls.length < maxResults) profileUrls.push(url);
      }
      if (profileUrls.length >= maxResults) break;
      await StealthEngine.simulateScroll(tabId, 'down');
      scrolls++;
    }

    // Visit each profile by clicking on it
    for (let i = 0; i < profileUrls.length; i++) {
      StealthEngine.checkAbort();

      // Find the link on screen and click it
      const targetUrl = profileUrls[i];
      const linkCoords = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            const url = '${targetUrl.replace(/'/g, "\\'")}';
            const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
            const match = links.find(a => a.href.startsWith(url));
            if (!match) return null;
            match.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const rect = match.getBoundingClientRect();
            return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
          })();
        `,
        returnByValue: true
      });

      await StealthEngine.sleep(600);

      if (linkCoords.result.value) {
        const { x, y } = linkCoords.result.value;
        await StealthEngine.organicClick(tabId, x, y);
      } else {
        await CDPController.sendCommand(tabId, 'Page.navigate', { url: targetUrl });
      }

      await StealthEngine.waitForPageLoad(tabId);
      await StealthEngine.sleep(Math.floor(Math.random() * 2000) + 3000);
      await StealthEngine.simulateScroll(tabId, 'down', 2);
      await StealthEngine.sleep(1000);

      const profile = await this._extractProfile(tabId);
      if (profile && profile.displayName) results.push(profile);

      await StealthEngine.goBack(tabId);
      await StealthEngine.sleep(2000);
    }

    return results;
  },

  async _extractProfile(tabId) {
    const r = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const nameEl = document.querySelector('h1.text-heading-xlarge');
          const headlineEl = document.querySelector('div.text-body-medium');
          const aboutEl = document.querySelector('#about ~ div span[aria-hidden="true"]');
          const locationEl = document.querySelector('.pv-text-details__left-panel .text-body-small');

          const name = nameEl ? nameEl.textContent.trim() : '';
          const headline = headlineEl ? headlineEl.textContent.trim() : '';
          const bio = aboutEl ? aboutEl.textContent.trim() : headline;
          const location = locationEl ? locationEl.textContent.trim() : '';
          const emailMatch = (bio + ' ' + headline).match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi);

          return {
            username: window.location.pathname.split('/')[2] || '',
            displayName: name,
            profileUrl: window.location.href,
            email: emailMatch ? emailMatch[0] : '',
            bio: bio || headline,
            headline,
            location,
            followers: ''
          };
        })();
      `,
      returnByValue: true
    });
    return r.result.value || null;
  },

  async sendDM(tabId, username, userGoal, tonePrompt) {
    StealthEngine.checkAbort();

    // Search for user by name then click first People result
    await this._doSearch(tabId, username);
    await StealthEngine.sleep(1000);

    // Click People filter
    try {
      const peopleEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'People');
            if (!btn) return null;
            const rect = btn.getBoundingClientRect();
            return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
          })();
        `,
        returnByValue: true
      });
      if (peopleEval.result.value) {
        await StealthEngine.organicClick(tabId, peopleEval.result.value.x, peopleEval.result.value.y);
        await StealthEngine.sleep(2500);
      }
    } catch(e) {}

    // Click first profile result
    const firstLinkEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
          if (!links.length) return null;
          links[0].scrollIntoView({ block: 'center' });
          const rect = links[0].getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
        })();
      `,
      returnByValue: true
    });

    if (firstLinkEval.result.value) {
      await StealthEngine.organicClick(tabId, firstLinkEval.result.value.x, firstLinkEval.result.value.y);
    } else {
      await CDPController.sendCommand(tabId, 'Page.navigate', { url: "https://www.linkedin.com/in/" + username });
    }

    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(3500);
    await StealthEngine.simulateScroll(tabId, 'down', 2);
    await StealthEngine.sleep(1000);

    const bioEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `(() => { const h = document.querySelector('div.text-body-medium'); return h ? h.textContent.trim() : ''; })();`,
      returnByValue: true
    });

    const prompt = `
<start_of_turn>user
Write a short LinkedIn connection note (max 280 characters). Sound human, no fluff.
Their headline: ${bioEval.result.value}
My goal: ${userGoal}
My tone: ${tonePrompt}
<end_of_turn>
<start_of_turn>model
`;
    let messageText = await LLMClient.generate(prompt);
    messageText = messageText.trim().replace(/^['"]|['"]$/g, '').substring(0, 290);

    // Click Connect
    const connectEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent.trim() === 'Connect');
          if (!btn) return null;
          const rect = btn.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
        })();
      `,
      returnByValue: true
    });

    if (!connectEval.result.value) throw new Error('"Connect" button not found. May already be connected or hidden in More menu.');
    await StealthEngine.organicClick(tabId, connectEval.result.value.x, connectEval.result.value.y);
    await StealthEngine.sleep(2000);

    // Click "Add a note"
    await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const btn = document.querySelector('button[aria-label="Add a note"]');
          if (btn) btn.click();
        })();
      `
    });
    await StealthEngine.sleep(1500);

    const focusBox = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const box = document.querySelector('textarea[name="message"]');
          if (box) { box.focus(); return true; }
          return false;
        })();
      `,
      returnByValue: true
    });

    if (!focusBox.result.value) throw new Error('Note textarea did not open. May already be connected.');
    await StealthEngine.sleep(500);
    await StealthEngine.simulateTyping(tabId, messageText);
    await StealthEngine.sleep(1000);

    await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `(() => { const btn = document.querySelector('button[aria-label="Send now"]'); if (btn) btn.click(); })();`
    });
    await StealthEngine.sleep(3000);
    return { status: 'Connection note sent.' };
  },

  async engageWithUser(tabId, username, userGoal, tonePrompt) {
    StealthEngine.checkAbort();
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: "https://www.linkedin.com/in/" + username + "/recent-activity/all/" });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(4000);
    await StealthEngine.simulateScroll(tabId, 'down', 2);
    await StealthEngine.sleep(1500);

    const postEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const posts = document.querySelectorAll('div[data-urn]');
          if (!posts.length) return null;
          const target = posts[0];
          const textNode = target.querySelector('.update-components-text');
          const likeBtn = target.querySelector('button[aria-label*="Like"], button[aria-label*="React"]');
          const commentBtn = target.querySelector('button[aria-label*="Comment"]');
          if (!likeBtn || !commentBtn) return null;
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const likeRect = likeBtn.getBoundingClientRect();
          const commentRect = commentBtn.getBoundingClientRect();
          return {
            text: textNode ? textNode.textContent.substring(0, 500) : '',
            likeX: Math.round(likeRect.x + likeRect.width/2),
            likeY: Math.round(likeRect.y + likeRect.height/2),
            comX: Math.round(commentRect.x + commentRect.width/2),
            comY: Math.round(commentRect.y + commentRect.height/2)
          };
        })();
      `,
      returnByValue: true
    });

    if (!postEval.result.value) throw new Error('No posts found to engage with.');
    const { text, likeX, likeY, comX, comY } = postEval.result.value;

    await StealthEngine.sleep(Math.floor(Math.random() * 1500) + 800);
    await StealthEngine.organicClick(tabId, likeX, likeY);
    await StealthEngine.sleep(1500);

    const prompt = `
<start_of_turn>user
Write a professional LinkedIn comment (max 2 sentences) on this post:
"${text}"
Tone: ${tonePrompt || 'Professional and supportive'}
<end_of_turn>
<start_of_turn>model
`;
    let replyText = await LLMClient.generate(prompt);
    replyText = replyText.trim().replace(/^['"]|['"]$/g, '');

    await StealthEngine.organicClick(tabId, comX, comY);
    await StealthEngine.sleep(2500);
    await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `(() => { const box = document.querySelector('div.ql-editor[contenteditable="true"]') || document.querySelector('div[role="textbox"]'); if (box) box.focus(); })();`
    });
    await StealthEngine.sleep(500);
    await StealthEngine.simulateTyping(tabId, replyText);
    await StealthEngine.sleep(1000);
    await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `(() => { const btn = document.querySelector('button.comments-comment-box__submit-button'); if (btn) btn.click(); })();`
    });
    await StealthEngine.sleep(3000);
    return { status: 'Liked and commented.' };
  },

  async followUser(tabId, username) {
    StealthEngine.checkAbort();
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: "https://www.linkedin.com/in/" + username });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(3500);
    await StealthEngine.simulateScroll(tabId, 'down');

    const followEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent.trim() === 'Follow');
          if (!btn) return null;
          const rect = btn.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
        })();
      `,
      returnByValue: true
    });

    if (!followEval.result.value) return { status: "Already following or Follow button not found." };
    await StealthEngine.organicClick(tabId, followEval.result.value.x, followEval.result.value.y);
    await StealthEngine.sleep(2000);
    return { status: "Followed " + username };
  },

  async createPost(tabId, tonePrompt) {
    StealthEngine.checkAbort();
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: "https://www.linkedin.com/feed/" });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(3000);

    const prompt = `
<start_of_turn>user
Write a professional LinkedIn post (2 sentences + 2 hashtags).
Tone: ${tonePrompt || 'Inspirational tech'}
<end_of_turn>
<start_of_turn>model
`;
    let captionText = await LLMClient.generate(prompt);
    captionText = captionText.trim().replace(/^['"]|['"]$/g, '');

    // Click Start a post
    const startPostEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button'));
          const btn = btns.find(b => b.textContent.includes('Start a post'));
          if (!btn) return null;
          const rect = btn.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
        })();
      `,
      returnByValue: true
    });
    if (!startPostEval.result.value) throw new Error('"Start a post" button not found on feed.');
    await StealthEngine.organicClick(tabId, startPostEval.result.value.x, startPostEval.result.value.y);
    await StealthEngine.sleep(2500);

    await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `(() => { const box = document.querySelector('div.ql-editor[contenteditable="true"]') || document.querySelector('div[role="textbox"]'); if (box) box.focus(); })();`
    });
    await StealthEngine.sleep(500);
    await StealthEngine.simulateTyping(tabId, captionText);
    await StealthEngine.sleep(1500);

    await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `(() => { const btns = Array.from(document.querySelectorAll('button')); const btn = btns.find(b => b.textContent.trim() === 'Post'); if (btn) btn.click(); })();`
    });
    await StealthEngine.sleep(5000);
    return { status: 'Posted!' };
  }
};
