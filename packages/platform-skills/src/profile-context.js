// Profile context extraction - gets full profile info, posts, and bio
// Used for hyper-personalized message generation

import { minimalDelay } from './common.js';

export async function extractProfileContext(page, platform, username) {
  const extractors = {
    linkedin: async () => {
      try {
        // Extract comprehensive profile info
        const profileInfo = await page.evaluate(() => {
          const info = {
            name: '',
            headline: '',
            company: '',
            jobTitle: '',
            location: '',
            bio: '',
            recentPosts: [],
            connections: '',
            openToWork: false,
            hiring: false,
          };

          // Name
          const nameEl = document.querySelector('h1.text-heading-xlarge, h1.inline, .pv-top-card__name');
          info.name = nameEl?.textContent?.trim() || '';

          // Headline
          const headlineEl = document.querySelector('.text-body-medium, .pv-top-card__headline, [data-generated-reference="headline"]');
          info.headline = headlineEl?.textContent?.trim() || '';

          // Parse headline for job title and company
          if (info.headline) {
            // Common patterns: "Job Title at Company" or "Job Title | Company"
            const atMatch = info.headline.match(/^(.*?)\s+(?:at|@|with)\s+(.+)$/i);
            const pipeMatch = info.headline.match(/^(.*?)\s*\|\s*(.+)$/);
            
            if (atMatch) {
              info.jobTitle = atMatch[1].trim();
              info.company = atMatch[2].trim();
            } else if (pipeMatch) {
              info.jobTitle = pipeMatch[1].trim();
              info.company = pipeMatch[2].trim();
            } else {
              info.jobTitle = info.headline;
            }
          }

          // Current company from experience section
          const expEls = document.querySelectorAll('.experience-section .pv-entity__summary-info, [data-testid="experience-item"]');
          if (expEls.length > 0 && !info.company) {
            const firstExp = expEls[0];
            const companyEl = firstExp.querySelector('.pv-entity__company-name, .t-14.t-normal');
            if (companyEl) {
              info.company = companyEl.textContent?.trim() || '';
            }
          }

          // Location
          const locationEl = document.querySelector('.pv-top-card__list-item[data-testid="top-card__location"], .text-body-small.inline.t-black--light');
          info.location = locationEl?.textContent?.trim() || '';

          // About/Bio section
          const aboutEl = document.querySelector('.pv-about__summary-text, .pv-shared-text-with-see-more, .inline-show-more-text');
          if (aboutEl) {
            info.bio = aboutEl.textContent?.trim().slice(0, 500) || '';
          }

          // Open to Work badge
          info.openToWork = !!document.querySelector('[data-testid="open-to-work-badge"], .open-to-work');

          // Hiring badge
          info.hiring = !!document.querySelector('[data-testid="hiring-badge"], .hiring');

          // Recent posts/activity
          const postEls = document.querySelectorAll('.feed-shared-update-v2__description, .feed-shared-text, .fie-impression-container');
          for (let i = 0; i < Math.min(3, postEls.length); i++) {
            const text = postEls[i]?.textContent?.trim();
            if (text && text.length > 20) {
              info.recentPosts.push(text.slice(0, 200));
            }
          }

          return info;
        });

        return profileInfo;
      } catch (error) {
        console.error('[ProfileContext] LinkedIn extraction failed:', error.message);
        return { name: username, headline: '', company: '', bio: '' };
      }
    },

    instagram: async () => {
      try {
        const profileInfo = await page.evaluate(() => {
          const info = {
            name: '',
            username: '',
            bio: '',
            followers: '',
            following: '',
            posts: '',
            recentPosts: [],
            isPrivate: false,
            isBusiness: false,
            category: '',
          };

          // Bio
          const bioEl = document.querySelector('div._aa_c h1, div[data-testid="biography"] h1, ._aa_c div span');
          info.bio = bioEl?.textContent?.trim().slice(0, 500) || '';

          // Username
          const userEl = document.querySelector('h2, ._aa_c h2, [data-testid="username"]');
          info.username = userEl?.textContent?.trim() || '';

          // Stats
          const stats = document.querySelectorAll('span._aa_e span, .x1lliihq span');
          stats.forEach((el, i) => {
            const text = el.textContent?.trim() || '';
            if (text.includes('post')) info.posts = text;
            if (text.includes('follower')) info.followers = text;
            if (text.includes('following')) info.following = text;
          });

          // Private account check
          info.isPrivate = document.body?.innerText?.includes('This Account is Private') || false;

          // Business account
          const catEl = document.querySelector('[data-testid="business-category"], ._aa_c div:last-child');
          if (catEl) {
            info.category = catEl.textContent?.trim() || '';
            info.isBusiness = !!info.category;
          }

          // Recent posts from grid
          const postEls = document.querySelectorAll('div._aabd a img, article img');
          for (let i = 0; i < Math.min(3, postEls.length); i++) {
            const alt = postEls[i]?.alt || '';
            if (alt && alt.length > 10) {
              info.recentPosts.push(alt.slice(0, 150));
            }
          }

          return info;
        });

        return profileInfo;
      } catch (error) {
        console.error('[ProfileContext] Instagram extraction failed:', error.message);
        return { username, bio: '' };
      }
    },

    twitter: async () => {
      try {
        const profileInfo = await page.evaluate(() => {
          const info = {
            name: '',
            username: '',
            bio: '',
            location: '',
            website: '',
            followers: '',
            following: '',
            isVerified: false,
            recentTweets: [],
          };

          // Name
          const nameEl = document.querySelector('[data-testid="UserName"] h1, div[data-testid="UserName"] span:first-child');
          info.name = nameEl?.textContent?.trim() || '';

          // Bio
          const bioEl = document.querySelector('[data-testid="UserDescription"], .ProfileHeaderCard-bio');
          info.bio = bioEl?.textContent?.trim().slice(0, 500) || '';

          // Location
          const locEl = document.querySelector('[data-testid="UserLocation"], .ProfileHeaderCard-location');
          info.location = locEl?.textContent?.trim() || '';

          // Website
          const webEl = document.querySelector('[data-testid="UserUrl"], .ProfileHeaderCard-url a');
          info.website = webEl?.textContent?.trim() || '';

          // Verified
          info.isVerified = !!document.querySelector('[data-testid="verified-badge"], .verified');

          // Stats
          const followerEl = document.querySelector('a[href$="/followers"] span, [data-testid="followers"]');
          info.followers = followerEl?.textContent?.trim() || '';

          const followingEl = document.querySelector('a[href$="/following"] span, [data-testid="following"]');
          info.following = followingEl?.textContent?.trim() || '';

          // Recent tweets
          const tweetEls = document.querySelectorAll('article[data-testid="tweet"] div[data-testid="tweetText"], .tweet-text');
          for (let i = 0; i < Math.min(3, tweetEls.length); i++) {
            const text = tweetEls[i]?.textContent?.trim();
            if (text && text.length > 10) {
              info.recentTweets.push(text.slice(0, 200));
            }
          }

          return info;
        });

        return profileInfo;
      } catch (error) {
        console.error('[ProfileContext] Twitter extraction failed:', error.message);
        return { username, bio: '' };
      }
    },

    facebook: async () => {
      try {
        const profileInfo = await page.evaluate(() => {
          const info = {
            name: '',
            bio: '',
            work: '',
            education: '',
            location: '',
            relationship: '',
          };

          // Name
          const nameEl = document.querySelector('h1, .profile-name, [data-testid="profile_name"]');
          info.name = nameEl?.textContent?.trim() || '';

          // About section
          const aboutEls = document.querySelectorAll('.about-section-content span, .profile-intro span');
          aboutEls.forEach(el => {
            const text = el.textContent?.trim() || '';
            if (text.length > 20 && !info.bio) {
              info.bio = text;
            }
            if (text.includes('Works at') || text.includes('worked at')) {
              info.work = text;
            }
            if (text.includes('Studied at') || text.includes('studies')) {
              info.education = text;
            }
            if (text.includes('Lives in')) {
              info.location = text;
            }
          });

          return info;
        });

        return profileInfo;
      } catch (error) {
        console.error('[ProfileContext] Facebook extraction failed:', error.message);
        return { username, bio: '' };
      }
    },

    whatsapp: async () => {
      // WhatsApp doesn't have public profiles, but we can get chat context
      // which is handled separately in chat-context.js
      return { username, platform: 'whatsapp' };
    },

    gmail: async () => {
      // Gmail doesn't have profiles to extract
      return { username, platform: 'gmail' };
    },
  };

  const extractor = extractors[platform];
  if (!extractor) {
    return { username, platform, error: 'Platform not supported' };
  }

  return await extractor();
}

// Format profile info for message generation prompts
export function formatProfileContext(profileInfo, platform) {
  if (!profileInfo) return '';

  const sections = [];

  // LinkedIn specific
  if (platform === 'linkedin') {
    if (profileInfo.headline) {
      sections.push(`JOB: ${profileInfo.headline}`);
    }
    if (profileInfo.company) {
      sections.push(`COMPANY: ${profileInfo.company}`);
    }
    if (profileInfo.location) {
      sections.push(`LOCATION: ${profileInfo.location}`);
    }
    if (profileInfo.openToWork) {
      sections.push(`STATUS: Open to work opportunities`);
    }
    if (profileInfo.hiring) {
      sections.push(`STATUS: Currently hiring`);
    }
  }

  // Instagram specific
  if (platform === 'instagram') {
    if (profileInfo.category) {
      sections.push(`CATEGORY: ${profileInfo.category}`);
    }
    if (profileInfo.followers) {
      sections.push(`FOLLOWERS: ${profileInfo.followers}`);
    }
    if (profileInfo.isBusiness) {
      sections.push(`TYPE: Business account`);
    }
  }

  // Twitter specific
  if (platform === 'twitter') {
    if (profileInfo.isVerified) {
      sections.push(`STATUS: Verified account`);
    }
    if (profileInfo.location) {
      sections.push(`LOCATION: ${profileInfo.location}`);
    }
  }

  // Bio (all platforms)
  if (profileInfo.bio) {
    sections.push(`BIO: ${profileInfo.bio.slice(0, 300)}`);
  }

  // Recent posts/content
  if (profileInfo.recentPosts && profileInfo.recentPosts.length > 0) {
    sections.push(`RECENT POSTS:\n${profileInfo.recentPosts.map((p, i) => `${i + 1}. ${p.slice(0, 150)}`).join('\n')}`);
  }
  if (profileInfo.recentTweets && profileInfo.recentTweets.length > 0) {
    sections.push(`RECENT TWEETS:\n${profileInfo.recentTweets.map((t, i) => `${i + 1}. ${t.slice(0, 150)}`).join('\n')}`);
  }

  if (sections.length === 0) {
    return '';
  }

  return `\n\nRECIPIENT PROFILE CONTEXT:\n${sections.join('\n')}`;
}
