import CDPController from '../../background/cdp-controller.js';
import StealthEngine from '../../background/stealth-engine.js';
import LLMClient from '../../background/llm-client.js';

const INSTAGRAM_HOME_URL = 'https://www.instagram.com/';
const INSTAGRAM_SEARCH_URL = 'https://www.instagram.com/explore/search/';

function normalizeUsername(username) {
  return String(username || '').trim().replace(/^@+/, '');
}

async function evalOnPage(tabId, expression) {
  return CDPController.sendCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true
  });
}

async function openInstagramProfile(tabId, username) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error('Username is required.');
  }

  await StealthEngine.applySpoofing(tabId);
  await CDPController.sendCommand(tabId, 'Page.navigate', { url: `https://www.instagram.com/${normalizedUsername}/` });
  await StealthEngine.waitForPageLoad(tabId);
  await StealthEngine.sleep(5000);

  const pageCheck = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
    expression: `
      (() => {
        const text = document.body?.innerText || '';
        const notAvailable = /Sorry, this page isn't available|user not found|page you requested could not be found/i.test(text);
        const hasProfileHeader = !!document.querySelector('header');
        return { notAvailable, hasProfileHeader };
      })();
    `,
    returnByValue: true
  });

  if (pageCheck.result?.value?.notAvailable || !pageCheck.result?.value?.hasProfileHeader) {
    throw new Error(`Instagram profile not available for @${normalizedUsername}`);
  }

  return normalizedUsername;
}

async function openInstagramHome(tabId) {
  await StealthEngine.applySpoofing(tabId);
  await CDPController.sendCommand(tabId, 'Page.navigate', { url: INSTAGRAM_HOME_URL });
  await StealthEngine.waitForPageLoad(tabId);
  await StealthEngine.sleep(4000);
}

async function searchAndOpenProfile(tabId, username) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    throw new Error('Username is required.');
  }

  await openInstagramHome(tabId);

  const searchIconEval = await evalOnPage(tabId, `
    (() => {
      const candidates = Array.from(document.querySelectorAll('a[href], div[role="button"], button'));
      const scored = [];

      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 16 || rect.height < 16) continue;
        const style = window.getComputedStyle(el);
        if (!style || style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;

        const descendantLabels = Array.from(el.querySelectorAll('[aria-label], svg[aria-label]'))
          .map((node) => node.getAttribute('aria-label') || '')
          .join(' ');
        const meta = [
          el.getAttribute('aria-label') || '',
          el.textContent || '',
          el.getAttribute('href') || '',
          descendantLabels
        ].join(' ').toLowerCase();

        let score = 0;
        if (meta.includes('search')) score += 100;
        if (meta.includes('/explore/search') || meta.includes('/explore/')) score += 70;
        if (rect.x < 140) score += 15;
        if (rect.y > 120 && rect.y < 520) score += 10;
        if (score <= 0) continue;

        scored.push({
          score,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2)
        });
      }

      scored.sort((a, b) => b.score - a.score);
      return scored[0] || null;
    })();
  `);

  if (searchIconEval.result?.value) {
    await StealthEngine.organicClick(tabId, searchIconEval.result.value.x, searchIconEval.result.value.y);
    await StealthEngine.sleep(2000);
  } else {
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: INSTAGRAM_SEARCH_URL });
    await StealthEngine.waitForPageLoad(tabId);
    await StealthEngine.sleep(2500);
  }

  const focusEval = await evalOnPage(tabId, `
    (() => {
      const selectors = [
        'input[placeholder="Search"]',
        'input[aria-label*="Search"]',
        'input[type="text"]'
      ];
      for (const selector of selectors) {
        const input = document.querySelector(selector);
        if (!input) continue;
        const rect = input.getBoundingClientRect();
        if (rect.width < 8 || rect.height < 8) continue;
        input.focus();
        input.select?.();
        return true;
      }
      return false;
    })();
  `);

  if (!focusEval.result?.value) {
    throw new Error('Instagram search input not found.');
  }

  await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA' });
  await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA' });
  await StealthEngine.sleep(120);
  await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8, code: 'Backspace' });
  await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8, code: 'Backspace' });
  await StealthEngine.sleep(150);
  await StealthEngine.simulateTyping(tabId, `@${normalizedUsername}`);
  await StealthEngine.sleep(3000);

  const candidateEval = await evalOnPage(tabId, `
    (() => {
      const target = ${JSON.stringify(normalizedUsername.toLowerCase())};
      const text = document.body?.innerText || '';
      const noResults = /no results|couldn't find anything for that search|no account found/i.test(text);
      const bad = new Set(['explore', 'reels', 'direct', 'stories', 'p', 'reel', 'accounts', '']);
      const score = (value) => {
        if (!value) return 0;
        const clean = value.toLowerCase().replace(/^@/, '').trim();
        if (!clean || bad.has(clean)) return 0;
        if (clean === target) return 100;
        if (clean.startsWith(target)) return 85;
        if (target.startsWith(clean)) return 70;
        if (clean.includes(target) || target.includes(clean)) return 55;
        return 0;
      };

      const candidates = [];
      for (const anchor of document.querySelectorAll('a[href]')) {
        const rect = anchor.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) continue;
        const parts = anchor.pathname.split('/').filter(Boolean);
        if (parts.length !== 1) continue;
        const handle = parts[0];
        const handleScore = score(handle);
        const textScore = Math.max(...(anchor.innerText || anchor.textContent || '').split('\\n').map(score), 0);
        const finalScore = Math.max(handleScore, textScore);
        if (finalScore <= 0) continue;
        candidates.push({
          score: finalScore,
          username: handle,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2)
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      return { noResults, best: candidates[0] || null };
    })();
  `);

  const payload = candidateEval.result?.value;
  if (!payload?.best) {
    if (payload?.noResults) {
      return null;
    }
    return null;
  }

  await StealthEngine.organicClick(tabId, payload.best.x, payload.best.y);
  await StealthEngine.sleep(4500);

  return payload.best.username;
}

export const InstagramEngagementSuite = {

  // ============================================
  // AUTO LIKE & COMMENT (ig_engage)
  // ============================================
  async engageWithUser(tabId, username, userGoal, tonePrompt) {
    StealthEngine.checkAbort();
    const normalizedUsername = await openInstagramProfile(tabId, username);
    console.log(`Starting Like & Comment flow for @${normalizedUsername}`);

    // 2. Find their first post on the grid
    const firstPostEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const posts = Array.from(document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]'));
          if (!posts.length) return null;
          const rect = posts[0].getBoundingClientRect();
          return { href: posts[0].href, x: rect.x + (rect.width/2), y: rect.y + (rect.height/2) };
        })();
      `,
      returnByValue: true
    });

    if (!firstPostEval.result.value) throw new Error(`User @${username} has no posts to engage with.`);

    // 3. Click the first post
    let { x, y } = firstPostEval.result.value;
    await StealthEngine.simulateMouseMove(tabId, 0, 0, x, y);
    await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await StealthEngine.sleep(50);
    await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await StealthEngine.sleep(4000);

    // 4. Like the Post
    const likeBtnEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const svgs = Array.from(document.querySelectorAll('svg[aria-label="Like"]'));
          const target = svgs.find(s => s.closest('div[role="button"]'));
          if (!target) return null;
          const rect = target.closest('div[role="button"]').getBoundingClientRect();
          return { x: rect.x + (rect.width/2), y: rect.y + (rect.height/2) };
        })();
      `,
      returnByValue: true
    });

    if (likeBtnEval.result.value) {
      x = likeBtnEval.result.value.x;
      y = likeBtnEval.result.value.y;
      await StealthEngine.simulateMouseMove(tabId, 0, 0, x, y);
      await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await StealthEngine.sleep(50);
      await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      console.log('Post Liked.');
    } else {
      console.log('Post already liked or like button blocked.');
    }

    await StealthEngine.sleep(2000);

    // 5. Read the caption for AI Context
    const captionEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const h1 = document.querySelector('h1');
          return h1 ? h1.textContent : 'Beautiful post';
        })();
      `,
      returnByValue: true
    });
    
    const caption = captionEval.result.value || 'Awesome!';

    // 6. Generate the AI Comment
    const prompt = `
<start_of_turn>user
Write a short, casual Instagram comment (max 2 sentences) for a post.
The post caption is: "${caption}".
Never sound like a marketing bot. Be human, casual, and relatable. 
My tone: ${tonePrompt || 'Casual and supportive'}
<end_of_turn>
<start_of_turn>model
`;
    console.log('Asking Gemma for a comment...');
    let commentText = await LLMClient.generate(prompt);
    commentText = commentText.trim().replace(/^['"]|['"]$/g, '');
    console.log(`Generated Comment: "${commentText}"`);

    // 7. Click Add Comment textarea
    const commentBoxFocus = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const textarea = document.querySelector('textarea[placeholder*="Add a comment"]');
          if (textarea) { 
             textarea.focus(); 
             return true; 
          }
          return false;
        })();
      `,
      returnByValue: true
    });

    if (!commentBoxFocus.result.value) throw new Error('Comment box could not be located.');

    // 8. Type Comment and Post
    await StealthEngine.sleep(1000);
    await StealthEngine.simulateTyping(tabId, commentText);
    await StealthEngine.sleep(800);
    
    // Hit Post Button 
    await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('div[role="button"]'));
          const postBtn = btns.find(b => b.textContent === 'Post');
          if (postBtn) postBtn.click();
        })();
      `
    });

    await StealthEngine.sleep(2000);
    return { status: `Success: Liked post and commented "${commentText}"` };
  },

  // ============================================
  // AUTO FOLLOW (ig_follow)
  // ============================================
  async followUser(tabId, username) {
    StealthEngine.checkAbort();
    const normalizedUsername = await searchAndOpenProfile(tabId, username);
    if (!normalizedUsername) {
      return { status: `No matching user found for @${normalizeUsername(username)}.` };
    }
    console.log(`Starting Fast Follow flow for @${normalizedUsername}`);

    const actionEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
          const followBtn = btns.find(b => b.textContent && b.textContent.toLowerCase() === 'follow');
          if (followBtn) {
            const rect = followBtn.getBoundingClientRect();
            return { action: 'follow', x: rect.x + (rect.width / 2), y: rect.y + (rect.height / 2) };
          }
          return null; // Already following or blocked
        })();
      `,
      returnByValue: true
    });

	    if (!actionEval.result.value) {
	       return { status: `Skipped: Already following @${normalizedUsername} or blocked.` };
	    }

    const { x, y } = actionEval.result.value;
    await StealthEngine.simulateMouseMove(tabId, 0, 0, x, y);
    await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await StealthEngine.sleep(50);
    await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });

	    return { status: `Success: Followed user @${normalizedUsername}` };
  },

  // ============================================
  // AUTO POSTING (ig_post)
  // ============================================
  async createPost(tabId, tonePrompt) {
    StealthEngine.checkAbort();
    console.log(`Starting Auto-Post flow.`);
    
    await StealthEngine.applySpoofing(tabId);
    await CDPController.sendCommand(tabId, 'Page.navigate', { url: `https://www.instagram.com/` });
    await StealthEngine.sleep(5000); 

    // Generate Caption
    const prompt = `
<start_of_turn>user
Write a short, engaging Instagram caption for my new post. Max 2 sentences + 3 hashtags.
My guidance/tone: ${tonePrompt || 'Inspirational'}
<end_of_turn>
<start_of_turn>model
`;
    console.log('Asking Gemma for caption...');
    let captionText = await LLMClient.generate(prompt);
    captionText = captionText.trim().replace(/^['"]|['"]$/g, '');

    // 1. Find and click Create (+) SVG
    const createBtnEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const svgs = Array.from(document.querySelectorAll('svg[aria-label="New post"]'));
          const target = svgs.find(s => s.closest('a, div[role="button"]'));
          if (!target) return null;
          const rect = target.closest('a, div[role="button"]').getBoundingClientRect();
          return { x: rect.x + (rect.width/2), y: rect.y + (rect.height/2) };
        })();
      `,
      returnByValue: true
    });

    if (!createBtnEval.result.value) throw new Error('Create (+) button not found on sidebar.');
    let { x, y } = createBtnEval.result.value;
    await StealthEngine.simulateMouseMove(tabId, 0, 0, x, y);
    await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await StealthEngine.sleep(50);
    await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await StealthEngine.sleep(3000);

    // 2. Locate the File Input hidden in the DOM and bypass the Select from computer button
    const fileInputEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const input = document.querySelector('input[type="file"]');
          if (!input) return null;
          // Assign an ID so CDP can attach to it via objectId logic later if needed
          input.id = 'cherry_uploader';
          return true;
        })();
      `,
      returnByValue: true
    });

    if (!fileInputEval.result.value) throw new Error('File input node not rendered. Did modal fail?');

    // 3. Inject file locally via CDP to bypass OS window dialogs
    // Chrome requires a root DOM Node ID to inject files
    const docDom = await CDPController.sendCommand(tabId, 'DOM.getDocument', {});
    const nodeData = await CDPController.sendCommand(tabId, 'DOM.querySelector', {
       nodeId: docDom.root.nodeId,
       selector: 'input[type="file"]#cherry_uploader'
    });

    if (!nodeData.nodeId) throw new Error('CDP could not grab File Node ID.');

    // Inject the hardcoded user payload path
    const filePath = '/Users/sanjeevn/Downloads/post.jpg';
    await CDPController.sendCommand(tabId, 'DOM.setFileInputFiles', {
      files: [filePath],
      nodeId: nodeData.nodeId
    });

    await StealthEngine.sleep(4000); // Wait for image crop screen

    // 4. Click 'Next' button (Twice)
    for (let loop = 0; loop < 2; loop++) {
       await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
          expression: `
            (() => {
              const btns = Array.from(document.querySelectorAll('div[role="button"]'));
              const nextBtn = btns.find(b => b.textContent && b.textContent.includes('Next'));
              if (nextBtn) nextBtn.click();
            })();
          `
       });
       await StealthEngine.sleep(3000);
    }

    // 5. Wait for Caption Screen and focus text area
    const captionFocusBtn = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
       expression: `
         (() => {
           const box = document.querySelector('div[role="textbox"]');
           if (box) { box.focus(); return true; }
           return false;
         })();
       `,
       returnByValue: true
    });

    if (captionFocusBtn.result.value) {
       await StealthEngine.sleep(1000);
       await StealthEngine.simulateTyping(tabId, captionText);
       await StealthEngine.sleep(2000);
    }

    // 6. Click 'Share'
    await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('div[role="button"]'));
          const shareBtn = btns.find(b => b.textContent && b.textContent.includes('Share'));
          if (shareBtn) shareBtn.click();
        })();
      `
    });

    console.log('Post dispatched!');
    await StealthEngine.sleep(5000); // Upload takes a second
    return { status: `Successfully posted image with AI Caption: "${captionText}"` };
  }

};
