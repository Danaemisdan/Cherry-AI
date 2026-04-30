import CDPController from '../../background/cdp-controller.js';
import StealthEngine from '../../background/stealth-engine.js';
import LLMClient from '../../background/llm-client.js';

export const TwitterStealthEngine = {
  async executeCommand(tabId, commandType, payload) {
    await StealthEngine.applySpoofing(tabId);
    
    const urlEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: 'window.location.hostname',
      returnByValue: true
    });
    
    if (!urlEval.result.value || (!urlEval.result.value.includes('x.com') && !urlEval.result.value.includes('twitter.com'))) {
      await CDPController.sendCommand(tabId, 'Page.navigate', { url: 'https://x.com/home' });
      await StealthEngine.waitForPageLoad(tabId);
      await StealthEngine.sleep(4000);
    }

    StealthEngine.checkAbort();

    if (commandType === 'twitter_scrape') {
      const results = await this.scrapeSearch(tabId, payload.hashtag, 10);
      return { status: "Scraped " + results.length + " profiles.", type: 'csv', data: results };
    } else if (commandType === 'twitter_engage') {
      return await this.engageWithUser(tabId, payload.username, payload.userGoal, payload.tonePrompt);
    } else if (commandType === 'twitter_dm') {
      return await this.sendDM(tabId, payload.username, payload.userGoal, payload.tonePrompt);
    } else if (commandType === 'twitter_follow') {
      return await this.followUser(tabId, payload.username);
    } else if (commandType === 'twitter_post') {
      return await this.createPost(tabId, payload.tonePrompt);
    }
    
    return { status: 'Unknown Twitter Command.' };
  },

  async _extractCurrentProfile(tabId) {
    const profileData = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const username = window.location.pathname.replace(/\//g, '');
          const nameEl = document.querySelector('div[data-testid="UserName"] span:first-child');
          const bioEl = document.querySelector('div[data-testid="UserDescription"]');
          const followerEl = document.querySelector('a[href$="/verified_followers"] span') ||
                             document.querySelector('a[href*="followers"] span');
          const linkEl = document.querySelector('div[data-testid="UserUrl"] a');

          const bio = bioEl ? bioEl.textContent.trim() : '';
          const emailMatch = bio.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi);

          return {
            username,
            displayName: nameEl ? nameEl.textContent.trim() : username,
            profileUrl: window.location.href,
            email: emailMatch ? emailMatch[0] : '',
            bio,
            followers: followerEl ? followerEl.textContent.trim() : '',
            bioLinks: linkEl ? linkEl.href : ''
          };
        })();
      `,
      returnByValue: true
    });
    return profileData.result.value;
  },

  async scrapeSearch(tabId, targetQuery, maxResults) {
    let results = [];
    StealthEngine.checkAbort();

    // Must go to /explore — that's where X's search input actually lives
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: 'https://x.com/explore' });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(3500);

    // Organically click the search box and type
    await StealthEngine.organicSearch(tabId, 'input[data-testid="SearchBox_Search_Input"]', targetQuery);
    await StealthEngine.sleep(2000);

    // Click the "People" tab in search results
    const peopleTabEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const tabs = Array.from(document.querySelectorAll('a[role="tab"]'));
          const tab = tabs.find(t => t.textContent.trim() === 'People');
          if (!tab) return null;
          tab.scrollIntoView({ block: 'center' });
          const rect = tab.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
        })();
      `,
      returnByValue: true
    });
    if (peopleTabEval.result.value) {
      await StealthEngine.organicClick(tabId, peopleTabEval.result.value.x, peopleTabEval.result.value.y);
      await StealthEngine.sleep(2500);
    }

    let profileLinks = [];
    let scrolls = 0;

    while (profileLinks.length < maxResults && scrolls < 8) {
      StealthEngine.checkAbort();
      const linksEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            const links = Array.from(document.querySelectorAll('a[href^="/"]'));
            const handles = links
              .filter(a => {
                const parts = a.pathname.split('/');
                return parts.length === 2 && parts[1].length > 0 &&
                       !['home','explore','notifications','messages','search','settings','i'].includes(parts[1]);
              })
              .map(a => 'https://x.com' + a.pathname);
            return [...new Set(handles)];
          })();
        `,
        returnByValue: true
      });

      const found = linksEval.result.value || [];
      for (const url of found) {
        if (!profileLinks.includes(url) && profileLinks.length < maxResults) profileLinks.push(url);
      }
      if (profileLinks.length >= maxResults) break;
      await StealthEngine.simulateScroll(tabId, 'down');
      scrolls++;
    }

    // Visit each profile - click on it from the results page
    for (let i = 0; i < profileLinks.length; i++) {
      StealthEngine.checkAbort();

      // Try click on the link if visible
      const handle = profileLinks[i].replace('https://x.com', '');
      const clicked = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            const links = Array.from(document.querySelectorAll('a[href="${handle}"]'));
            // Find a visible one (not a tiny icon link)
            const match = links.find(a => {
              const rect = a.getBoundingClientRect();
              return rect.width > 30 && rect.height > 20;
            });
            if (!match) return null;
            match.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const rect = match.getBoundingClientRect();
            return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
          })();
        `,
        returnByValue: true
      });

      await StealthEngine.sleep(Math.floor(Math.random() * 800) + 400);

      if (clicked.result.value) {
        const { x, y } = clicked.result.value;
        await StealthEngine.organicClick(tabId, x, y);
      } else {
        await CDPController.sendCommand(tabId, 'Page.navigate', { url: profileLinks[i] });
      }

      await StealthEngine.waitForPageLoad(tabId);
      await StealthEngine.sleep(Math.floor(Math.random() * 2000) + 3000);

      // Scroll down profile
      await StealthEngine.simulateScroll(tabId, 'down', 2);
      await StealthEngine.sleep(1000);

      const profile = await this._extractCurrentProfile(tabId);
      if (profile && profile.username) results.push(profile);

      // Go back to search results
      await StealthEngine.goBack(tabId);
      await StealthEngine.sleep(Math.floor(Math.random() * 1000) + 1500);
    }

    return results;
  },

  async sendDM(tabId, username, userGoal, tonePrompt) {
    StealthEngine.checkAbort();

    // Search for the user
    await StealthEngine.organicSearch(tabId, 'input[data-testid="SearchBox_Search_Input"]', username);
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(1500);

    // Click "People" tab
    try {
      await StealthEngine.clickByText(tabId, 'a', 'People');
      await StealthEngine.sleep(2000);
    } catch(e) {}

    // Click first result's name/avatar to go to their profile
    const firstResult = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const links = Array.from(document.querySelectorAll('a[href^="/"]')).filter(a => {
            const parts = a.pathname.split('/');
            return parts.length === 2 && parts[1].length > 0 &&
                   !['home','explore','notifications','messages','search'].includes(parts[1]);
          });
          if (!links.length) return null;
          links[0].scrollIntoView({ block: 'center' });
          const rect = links[0].getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
        })();
      `,
      returnByValue: true
    });

    if (firstResult.result.value) {
      await StealthEngine.organicClick(tabId, firstResult.result.value.x, firstResult.result.value.y);
    } else {
      await CDPController.sendCommand(tabId, 'Page.navigate', { url: "https://x.com/" + username });
    }

    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(4000);

    // Read their bio for context
    const bioEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const b = document.querySelector('div[data-testid="UserDescription"]');
          return b ? b.textContent.trim() : '';
        })();
      `,
      returnByValue: true
    });

    const prompt = `
<start_of_turn>user
Write a short, casual Twitter DM (max 3 sentences). Sound like a real person, not marketing.
Their bio: ${bioEval.result.value}
My goal: ${userGoal}
My tone: ${tonePrompt}
<end_of_turn>
<start_of_turn>model
`;
    let messageText = await LLMClient.generate(prompt);
    messageText = messageText.trim().replace(/^['"]|['"]$/g, '');

    // Click the message (DM) button on their profile
    await StealthEngine.clickElement(tabId, 'div[data-testid="sendDMFromProfile"]');
    await StealthEngine.sleep(4000);

    // Focus DM input
    await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (()=>{
          const box = document.querySelector('div[data-testid="dmComposerTextInput"]');
          if (box) box.focus();
        })();
      `
    });
    await StealthEngine.sleep(700);
    await StealthEngine.simulateTyping(tabId, messageText);
    await StealthEngine.sleep(1000);

    // Send with Enter
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, code: 'Enter' });
    await StealthEngine.sleep(60);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, code: 'Enter' });

    return { status: 'DM sent via X.' };
  },

  async engageWithUser(tabId, username, userGoal, tonePrompt) {
    StealthEngine.checkAbort();

    // Go to their profile
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: "https://x.com/" + username });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(4000);

    // Scroll down a bit to reveal tweets
    await StealthEngine.simulateScroll(tabId, 'down');
    await StealthEngine.sleep(1500);

    const tweetEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const tweets = document.querySelectorAll('article[data-testid="tweet"]');
          if (!tweets.length) return null;
          
          let target = null;
          for (const t of tweets) {
            if (t.querySelector('div[data-testid="tweetText"]')) { target = t; break; }
          }
          if (!target) return null;
          
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const textNode = target.querySelector('div[data-testid="tweetText"]');
          const likeBtn = target.querySelector('button[data-testid="like"]');
          const replyBtn = target.querySelector('button[data-testid="reply"]');
          
          if (!likeBtn || !replyBtn) return null;

          const likeRect = likeBtn.getBoundingClientRect();
          const replyRect = replyBtn.getBoundingClientRect();

          return { 
             text: textNode ? textNode.textContent.substring(0, 400) : '',
             likeX: Math.round(likeRect.x + likeRect.width/2),
             likeY: Math.round(likeRect.y + likeRect.height/2),
             replyX: Math.round(replyRect.x + replyRect.width/2),
             replyY: Math.round(replyRect.y + replyRect.height/2)
          };
        })();
      `,
      returnByValue: true
    });

    if (!tweetEval.result.value) throw new Error("No tweets found on @" + username + "'s profile.");

    const { text, likeX, likeY, replyX, replyY } = tweetEval.result.value;

    // Read the tweet (natural pause)
    await StealthEngine.sleep(Math.floor(Math.random() * 2000) + 1000);

    // Click Like
    await StealthEngine.organicClick(tabId, likeX, likeY);
    await StealthEngine.sleep(1500);

    const prompt = `
<start_of_turn>user
Write a short, witty Twitter reply (max 2 sentences) to this tweet:
"${text}".
Don't sound like a bot. Be casual, engaging.
My tone: ${tonePrompt || 'Casual and witty'}
<end_of_turn>
<start_of_turn>model
`;
    let replyText = await LLMClient.generate(prompt);
    replyText = replyText.trim().replace(/^['"]|['"]$/g, '');

    // Click Reply
    await StealthEngine.organicClick(tabId, replyX, replyY);
    await StealthEngine.sleep(2500);

    // Focus the reply modal textarea
    await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (()=>{
          const box = document.querySelector('div[role="dialog"] div[data-testid="tweetTextarea_0"]');
          if (box) box.focus();
        })();
      `
    });
    await StealthEngine.sleep(500);
    await StealthEngine.simulateTyping(tabId, replyText);
    await StealthEngine.sleep(1000);

    // Submit the reply
    await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (()=>{
          const btns = document.querySelectorAll('div[data-testid="tweetButton"]');
          if (btns.length > 0) btns[btns.length-1].click();
        })();
      `
    });

    await StealthEngine.sleep(3000);
    return { status: 'Liked and replied: "' + replyText + '"' };
  },

  async followUser(tabId, username) {
    StealthEngine.checkAbort();
    
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: "https://x.com/" + username });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(4000);

    // Scroll a little
    await StealthEngine.simulateScroll(tabId, 'down');

    const followEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const btn = document.querySelector('div[data-testid$="-follow"]');
          if (!btn) return null;
          btn.scrollIntoView({ block: 'center' });
          const rect = btn.getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
        })();
      `,
      returnByValue: true
    });

    if (!followEval.result.value) {
      return { status: "Already following @" + username + " or button not found." };
    }

    const { x, y } = followEval.result.value;
    await StealthEngine.organicClick(tabId, x, y);

    return { status: "Followed @" + username };
  },

  async createPost(tabId, tonePrompt) {
    StealthEngine.checkAbort();
    
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: "https://x.com/home" });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(4000);

    const prompt = `
<start_of_turn>user
Write a short Tweet (max 2 sentences + 2 hashtags).
Tone: ${tonePrompt || 'Inspirational tech'}
<end_of_turn>
<start_of_turn>model
`;
    let captionText = await LLMClient.generate(prompt);
    captionText = captionText.trim().replace(/^['"]|['"]$/g, '');

    // Click on the "What is happening" compose box
    await StealthEngine.clickElement(tabId, 'div[data-testid="tweetTextarea_0"]');
    await StealthEngine.sleep(800);
    await StealthEngine.simulateTyping(tabId, captionText);
    await StealthEngine.sleep(1500);

    // Inject image file
    const fileInputEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const input = document.querySelector('input[data-testid="fileInput"]');
          if (!input) return null;
          input.id = 'cherry_uploader';
          return true;
        })();
      `,
      returnByValue: true
    });

    if (fileInputEval.result.value) {
      try {
        const docDom = await CDPController.sendCommand(tabId, 'DOM.getDocument', {});
        const nodeData = await CDPController.sendCommand(tabId, 'DOM.querySelector', {
          nodeId: docDom.root.nodeId,
          selector: 'input#cherry_uploader'
        });
        if (nodeData.nodeId) {
          await CDPController.sendCommand(tabId, 'DOM.setFileInputFiles', {
            files: ['/Users/sanjeevn/Downloads/post.jpg'],
            nodeId: nodeData.nodeId
          });
          await StealthEngine.sleep(2000);
        }
      } catch(e) {}
    }

    // Click the Tweet/Post button
    await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (()=>{
          const btn = document.querySelector('div[data-testid="tweetButtonInline"]') ||
                      document.querySelector('div[data-testid="tweetButton"]');
          if (btn) btn.click();
        })();
      `
    });

    await StealthEngine.sleep(5000);
    return { status: 'Tweet posted: "' + captionText + '"' };
  }
};
