import CDPController from '../../background/cdp-controller.js';
import StealthEngine from '../../background/stealth-engine.js';

async function loadHistory() {
  const d = await chrome.storage.local.get(['cherry_ig_profiles', 'cherry_ig_posts']);
  return {
    profiles: new Set(d.cherry_ig_profiles || []),
    posts:    new Set(d.cherry_ig_posts    || [])
  };
}
async function saveHistory(profiles, posts) {
  await chrome.storage.local.set({
    cherry_ig_profiles: [...profiles],
    cherry_ig_posts:    [...posts]
  });
}

async function detectNoResultsState(tabId) {
  const evalResult = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
    expression: `
      (() => {
        const text = document.body?.innerText || '';
        return /\\bNo results\\b/i.test(text) && /couldn['’]t find anything for that search/i.test(text);
      })();
    `,
    returnByValue: true
  });

  return Boolean(evalResult.result?.value);
}

// ─── Extract Instagram @username from a loaded post page via JSON-LD, title, or DOM ──
async function extractUsernameFromPostPage(tabId) {
  const result = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
    expression: `
      (() => {
        let postDescription = '';
        try {
          const ogDesc = document.querySelector('meta[property="og:description"]');
          if (ogDesc) postDescription = ogDesc.content;
          if (!postDescription) {
            const mDesc = document.querySelector('meta[name="description"]');
            if (mDesc) postDescription = mDesc.content;
          }
          if (!postDescription) {
             const h1 = document.querySelector('h1[dir="auto"]');
             if (h1) postDescription = h1.textContent;
          }
        } catch(e) {}

        const bad = new Set([
          'p','reel','reels','explore','stories','direct','accounts','i','ss','aj','si',
          'share','tv','igtv','checkout','challenge','oauth','legal','about','help',
          'blog','jobs','api','privacy','terms','graphql','static','media','embed',
          'login','signup','home','hashtag',''
        ]);
        const ok = s => /^[A-Za-z0-9._]{2,30}$/.test(s) && !s.startsWith('.') && !s.endsWith('.');

        const ret = (username, pdOverride) => ({ username, postDescription: pdOverride || postDescription });

        // ① JSON-LD structured data — Instagram embeds this server-side
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const data = JSON.parse(script.textContent);
            const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
            for (const item of items) {
              const author = item.author;
              if (!author) continue;
              const handle = author.alternateName || author.identifier || author.name;
              if (handle && ok(handle) && !bad.has(handle.toLowerCase())) {
                const pd = item.caption || item.text || item.description || postDescription;
                return ret(handle, pd);
              }
            }
          } catch(e) {}
        }

        // ② document.title  e.g. "techtokwithdee on Instagram: '...'"
        const titleM = (document.title || '').match(/^([A-Za-z0-9._]{2,30})\\s+on Instagram/i);
        if (titleM && ok(titleM[1]) && !bad.has(titleM[1].toLowerCase())) return ret(titleM[1]);

        // ③ og:title meta  e.g. "techtokwithdee (@techtokwithdee) on Instagram..."
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) {
          const m = (ogTitle.content || '').match(/@([A-Za-z0-9._]{2,30})/);
          if (m && ok(m[1]) && !bad.has(m[1].toLowerCase())) return ret(m[1]);
          const m2 = (ogTitle.content || '').match(/^([A-Za-z0-9._]{2,30})\\s+[(@]/i);
          if (m2 && ok(m2[1]) && !bad.has(m2[1].toLowerCase())) return ret(m2[1]);
        }

        // ④ meta[name="description"] @handle
        const desc = document.querySelector('meta[name="description"]');
        if (desc) {
          const m = (desc.content || '').match(/@([A-Za-z0-9._]{2,30})/);
          if (m && ok(m[1]) && !bad.has(m[1].toLowerCase())) return ret(m[1]);
        }

        // ⑤ "More posts from username" text — rendered at bottom of post page
        for (const el of document.querySelectorAll('span,p,h2,h3,div')) {
          if (el.children.length > 0) continue;
          const m = el.textContent.trim().match(/^More posts? from ([A-Za-z0-9._]{2,30})$/i);
          if (m && ok(m[1]) && !bad.has(m[1].toLowerCase())) return ret(m[1]);
        }

        // ⑥ Link whose visible text literally is the username (author name link in post header)
        for (const a of document.querySelectorAll('a[href]')) {
          const parts = a.pathname.split('/').filter(Boolean);
          if (parts.length !== 1 || bad.has(parts[0]) || !ok(parts[0])) continue;
          const txt = a.textContent.trim().replace(/^@/, '');
          if (txt.toLowerCase() === parts[0].toLowerCase()) return ret(parts[0]);
        }

        // ⑦ Fallback: find author link in page, excluding the logged-in user's nav link
        const candidates = {};
        const allLinks = Array.from(document.querySelectorAll('a[href]'));
        for (const a of allLinks) {
          const parts = a.pathname.split('/').filter(Boolean);
          if (parts.length !== 1 || bad.has(parts[0]) || !ok(parts[0])) continue;
          candidates[parts[0]] = (candidates[parts[0]] || 0) + 1;
        }
        let best = null, bestCount = 1;
        for (const [handle, count] of Object.entries(candidates)) {
          if (count > bestCount) { bestCount = count; best = handle; }
        }
        return best ? ret(best) : null;
      })();
    `,
    returnByValue: true
  });
  return result.result?.value || null;
}

export const InstagramScraper = {

  async scrapeHashtag(tabId, targetQuery, maxResults, onProgress) {
    await StealthEngine.applySpoofing(tabId);
    const { profiles: visitedProfiles, posts: visitedPosts } = await loadHistory();
    const results = [];

    try {
      const tag = targetQuery.replace(/^#/, '').trim();
      // Instagram now redirects /explore/tags/X/ → /explore/search/keyword/?q=%23X
      // Navigate directly to the actual URL to avoid a double page load
      const tagUrl = 'https://www.instagram.com/explore/search/keyword/?q=' + encodeURIComponent('#' + tag);

      console.log('[Cherry IG] → search page:', tagUrl);
      await CDPController.sendCommand(tabId, 'Page.navigate', { url: tagUrl });
      await StealthEngine.waitForPageLoad(tabId);
      await StealthEngine.sleep(5000);

      // Scroll a couple times to trigger lazy loading
      await StealthEngine.simulateScroll(tabId, 'down', 3);
      await StealthEngine.sleep(2000);
      await StealthEngine.simulateScroll(tabId, 'up', 1);
      await StealthEngine.sleep(1000);

      if (await detectNoResultsState(tabId)) {
        console.log('[Cherry IG] Search returned no results for:', tag);
        await saveHistory(visitedProfiles, visitedPosts);
        return [];
      }

      // Build a large candidate pool before leaving search. A single viewport can
      // expose only a handful of posts, which made large scrapes stop at 2-3 rows.
      const targetPostPoolSize = Math.max(maxResults * 8, maxResults + 20);
      const maxScrollAttempts = Math.min(90, Math.max(18, Math.ceil(maxResults / 2)));
      let scrollAttempts = 0;
      let stagnantAttempts = 0;
      const postUrlSet = new Set();

      while (scrollAttempts < maxScrollAttempts && postUrlSet.size < targetPostPoolSize && stagnantAttempts < 8) {
        if (await detectNoResultsState(tabId)) {
          console.log('[Cherry IG] Search returned no results while collecting posts for:', tag);
          await saveHistory(visitedProfiles, visitedPosts);
          return [];
        }

        const beforeCount = postUrlSet.size;
        const postsEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
          expression: `
            (() => {
              const links = Array.from(document.querySelectorAll('a[href]'))
                .filter(a => a.href && (a.href.includes('/p/') || a.href.includes('/reel/')));
              return [...new Set(links.map(a => a.href))];
            })();
          `,
          returnByValue: true
        });

        for (const url of postsEval.result.value || []) {
          if (!visitedPosts.has(url)) {
            postUrlSet.add(url);
          }
        }

        if (postUrlSet.size === beforeCount) {
          stagnantAttempts++;
        } else {
          stagnantAttempts = 0;
          console.log('[Cherry IG] Collected post candidates:', postUrlSet.size, '/', targetPostPoolSize);
        }

        if (postUrlSet.size >= targetPostPoolSize) break;

        await StealthEngine.simulateScroll(tabId, 'down', 3);
        await StealthEngine.sleep(1800);
        scrollAttempts++;
      }

      let postUrls = [...postUrlSet];
      console.log('[Cherry IG] Found', postUrls.length, 'new posts');

      if (!postUrls.length) {
        throw new Error('Still no posts found for #' + tag + ' after waiting. Check that Instagram is open and logged in.');
      }

      postUrls = postUrls.slice(0, targetPostPoolSize); // grab extra for dedup/history headroom
      const authorsSeen = new Set();

      for (const postUrl of postUrls) {
        if (results.length >= maxResults) break;
        StealthEngine.checkAbort();
        visitedPosts.add(postUrl);

        try {
          console.log('[Cherry IG] Post:', postUrl);
          await CDPController.sendCommand(tabId, 'Page.navigate', { url: postUrl });
          await StealthEngine.waitForPageLoad(tabId);
          await StealthEngine.sleep(5000); // wait for full hydration + JSON-LD injection

          const extractedData = await extractUsernameFromPostPage(tabId);
          console.log('[Cherry IG] Extracted data:', extractedData);

          let username = '';
          let postDescription = '';

          if (typeof extractedData === 'string') {
            username = extractedData;
          } else if (extractedData && extractedData.username) {
            username = extractedData.username;
            postDescription = extractedData.postDescription || '';
          }

          if (!username) { console.log('[Cherry IG] No username found, skipping'); continue; }

          const authorUrl = 'https://www.instagram.com/' + username + '/';
          if (authorsSeen.has(username) || visitedProfiles.has(authorUrl)) {
            console.log('[Cherry IG] Already seen:', username);
            continue;
          }
          authorsSeen.add(username);

          console.log('[Cherry IG] Profile:', authorUrl);
          await CDPController.sendCommand(tabId, 'Page.navigate', { url: authorUrl });
          await StealthEngine.waitForPageLoad(tabId);
          await StealthEngine.sleep(5000);
          await StealthEngine.simulateScroll(tabId, 'down', 2);
          await StealthEngine.sleep(1500);

          const profile = await this._extractProfile(tabId);
          if (profile && profile.username && !['explore','p','reel'].includes(profile.username)) {
            profile.postUrl = postUrl;
            profile.postDescription = postDescription;
            results.push(profile);
            visitedProfiles.add(authorUrl);
            console.log('[Cherry IG] ✓ Scraped:', profile.username, '| bio:', profile.bio.slice(0,40));
            onProgress && onProgress(results.length, maxResults);
          } else {
            console.log('[Cherry IG] Profile extraction returned empty for:', username);
          }

          await StealthEngine.sleep(Math.floor(Math.random() * 2000) + 2000);

        } catch (postErr) {
          if (postErr.message === 'USER_ABORTED') throw postErr;
          console.log('[Cherry IG] Skipping post due to error:', postErr.message);
        }
      }

    } catch (err) {
      if (err.message !== 'USER_ABORTED') throw err;
      console.log('[Cherry IG] User aborted. Partial results:', results.length);
    }

    await saveHistory(visitedProfiles, visitedPosts);
    console.log('[Cherry IG] Done. Total scraped:', results.length);
    return results;
  },

  async scrapeByKeyword(tabId, targetQuery, maxResults, onProgress) {
    await StealthEngine.applySpoofing(tabId);
    const { profiles: visitedProfiles } = await loadHistory();
    const results = [];

    try {
      const hostEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
        expression: 'window.location.hostname', returnByValue: true
      });
      if (!hostEval.result.value?.includes('instagram.com')) {
        await CDPController.sendCommand(tabId, 'Page.navigate', { url: 'https://www.instagram.com/' });
        await StealthEngine.waitForPageLoad(tabId);
        await StealthEngine.sleep(4000);
      }

      // Click search icon
      const iconEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            for (const svg of document.querySelectorAll('svg[aria-label="Search"]')) {
              const btn = svg.closest('a, div[role="button"]');
              if (!btn) continue;
              const r = btn.getBoundingClientRect();
              if (r.width > 0 && r.height > 0)
                return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2) };
            }
            return null;
          })();
        `,
        returnByValue: true
      });
      if (!iconEval.result.value) throw new Error('Search icon not found.');
      await StealthEngine.organicClick(tabId, iconEval.result.value.x, iconEval.result.value.y);
      await StealthEngine.sleep(2000);

      await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
        expression: `(() => { const i = document.querySelector('input[placeholder="Search"]'); if(i) i.focus(); })();`
      });
      await StealthEngine.sleep(500);
      await StealthEngine.simulateTyping(tabId, targetQuery);
      await StealthEngine.sleep(4000);

      if (await detectNoResultsState(tabId)) {
        console.log('[Cherry IG] Keyword search returned no results for:', targetQuery);
        await saveHistory(visitedProfiles, new Set());
        return [];
      }

      const linksEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            const bad = new Set(['explore','reels','direct','stories','p','reel','accounts','']);
            const seen = new Set();
            return Array.from(document.querySelectorAll('a[href]')).filter(a => {
              const parts = a.pathname.split('/').filter(Boolean);
              if (parts.length !== 1 || bad.has(parts[0])) return false;
              if (seen.has(a.href)) return false;
              const r = a.getBoundingClientRect();
              if (r.width < 5 || r.height < 5) return false;
              seen.add(a.href);
              return true;
            }).map(a => ({ href: a.href }));
          })();
        `,
        returnByValue: true
      });

      const newLinks = (linksEval.result.value || []).filter(l => !visitedProfiles.has(l.href));
      if (!newLinks.length) {
        console.log('[Cherry IG] No visible accounts found for:', targetQuery);
        await saveHistory(visitedProfiles, new Set());
        return [];
      }

      for (const link of newLinks.slice(0, maxResults)) {
        StealthEngine.checkAbort();
        if (results.length >= maxResults) break;
        try {
          await CDPController.sendCommand(tabId, 'Page.navigate', { url: link.href });
          await StealthEngine.waitForPageLoad(tabId);
          await StealthEngine.sleep(5000);
          await StealthEngine.simulateScroll(tabId, 'down', 2);
          await StealthEngine.sleep(1500);
          const profile = await this._extractProfile(tabId);
          if (profile?.username) {
            results.push(profile);
            visitedProfiles.add(link.href);
            onProgress && onProgress(results.length, maxResults);
          }
          await StealthEngine.sleep(Math.floor(Math.random() * 1500) + 1000);
        } catch (e) {
          if (e.message === 'USER_ABORTED') throw e;
        }
      }
    } catch (err) {
      if (err.message !== 'USER_ABORTED') throw err;
    }

    await saveHistory(visitedProfiles, new Set());
    return results;
  },

  async _extractProfile(tabId) {
    const r = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          try {
            const pathParts = window.location.pathname.split('/').filter(Boolean);
            const username = pathParts.length > 0 ? pathParts[0] : window.location.hostname;

            let descText = '';
            let titleText = document.title || '';
            try {
              const metaDesc = document.querySelector('meta[name="description"]');
              if (metaDesc) descText = metaDesc.content || '';
              const metaTitle = document.querySelector('meta[property="og:title"]');
              if (metaTitle) titleText = metaTitle.content || titleText;
            } catch(e) {}

            let displayName = username;
            try {
              const nameM = titleText.match(/^(.+?)\\s*[(@•]/);
              if (nameM) displayName = nameM[1].trim();
            } catch(e) {}

            let followers = '';
            try {
              const followerM = descText.match(/([\\d,.]+[KkMm]?)\\s*Followers/i);
              if (followerM) followers = followerM[1];
            } catch(e) {}

            let bio = '';
            try {
              const bioSelectors = [
                'header section > div > span',
                'header section span._aacl',
                'header section div > span',
                'header section p',
                'section > div > span'
              ];
              for (const sel of bioSelectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim().length > 2) { 
                  bio = el.textContent.trim(); 
                  break; 
                }
              }
              if (!bio && descText) {
                bio = descText.split(' - See Instagram')[0].trim();
              }
            } catch(e) {}

            let bioLinks = '';
            try {
              const linkEls = document.querySelectorAll('header section a[target="_blank"]');
              bioLinks = Array.from(linkEls).map(a => a.href).join(' | ');
            } catch(e) {}

            let email = '';
            try {
              const emailM = bio.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\\.[a-zA-Z0-9_-]+)/gi);
              if (emailM) email = emailM[0];
            } catch(e) {}

            return {
              username,
              displayName,
              profileUrl: window.location.href,
              email,
              bio: bio ? bio.substring(0, 500) : '',
              followers,
              bioLinks
            };
          } catch(globalErr) {
            return {
              username: window.location.pathname.replace(/\\//g, ''),
              displayName: 'Unknown',
              profileUrl: window.location.href,
              email: '',
              bio: 'Extraction failed: ' + String(globalErr),
              followers: '',
              bioLinks: ''
            };
          }
        })();
      `,
      returnByValue: true
    });
    return r.result?.value || null;
  }
};
