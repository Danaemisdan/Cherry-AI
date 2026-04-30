// Lead contact info extraction across platforms

import { navigate, pageSnapshot } from './common.js';

export async function extractContactInfo(page, platform, profileUrl) {
  const extractors = {
    linkedin: async () => {
      await navigate(page, profileUrl);
      await page.waitForTimeout(3000);

      const info = await page.evaluate(() => {
        const result = { emails: [], phones: [], links: [], sources: [] };

        // Contact info section
        const contactSection = document.querySelector('.pv-contact-info__contact-type');
        if (contactSection) {
          // Emails
          document.querySelectorAll('.pv-contact-info__ci-container a[href^="mailto:"]').forEach(el => {
            const email = el.href.replace('mailto:', '');
            if (email && !result.emails.includes(email)) result.emails.push(email);
          });

          // Phones
          document.querySelectorAll('.pv-contact-info__ci-container').forEach(el => {
            const text = el.textContent || '';
            const phoneMatch = text.match(/[\+]?[\d\s\-\(\)]{10,}/);
            if (phoneMatch) result.phones.push(phoneMatch[0].trim());
          });
        }

        // Website links from bio
        document.querySelectorAll('.pv-profile-section a[href^="http"]').forEach(el => {
          const link = el.href;
          if (!link.includes('linkedin.com') && !result.links.includes(link)) {
            result.links.push(link);
          }
        });

        // Twitter/X handle
        const twitterEl = document.querySelector('a[href*="twitter.com"], a[href*="x.com"]');
        if (twitterEl) {
          const handle = twitterEl.href.match(/[@\/]([^\/]+)$/);
          if (handle) result.sources.push({ type: 'twitter', handle: handle[1] });
        }

        return result;
      });

      return info;
    },

    twitter: async () => {
      await navigate(page, profileUrl);
      await page.waitForTimeout(3000);

      const info = await page.evaluate(() => {
        const result = { emails: [], phones: [], links: [], bio: '' };

        // Bio often contains contact info
        const bioEl = document.querySelector('[data-testid="UserDescription"], .ProfileHeaderCard-bio');
        const bio = bioEl?.textContent || '';
        result.bio = bio;

        // Extract email from bio
        const emailMatch = bio.match(/[\w.-]+@[\w.-]+\.\w+/);
        if (emailMatch) result.emails.push(emailMatch[0]);

        // Website link
        const websiteEl = document.querySelector('a[href*="t.co"]');
        if (websiteEl) result.links.push(websiteEl.href);

        return result;
      });

      return info;
    },

    instagram: async () => {
      await navigate(page, profileUrl);
      await page.waitForTimeout(3000);

      const info = await page.evaluate(() => {
        const result = { emails: [], phones: [], links: [], bio: '' };

        // Bio
        const bioEl = document.querySelector('div._aa_c, h1, div[data-testid="biography"]');
        const bio = bioEl?.textContent || '';
        result.bio = bio;

        // Extract email from bio
        const emailMatch = bio.match(/[\w.-]+@[\w.-]+\.\w+/);
        if (emailMatch) result.emails.push(emailMatch[0]);

        // External link
        document.querySelectorAll('a[rel="me"], a[href^="http"]').forEach(el => {
          const link = el.href;
          if (!link.includes('instagram.com') && !result.links.includes(link)) {
            result.links.push(link);
          }
        });

        return result;
      });

      return info;
    },

    facebook: async () => {
      await navigate(page, profileUrl);
      await page.waitForTimeout(3000);

      const info = await page.evaluate(() => {
        const result = { emails: [], phones: [], links: [], about: {} };

        // About section
        const aboutItems = document.querySelectorAll('.about-section-content span');
        aboutItems.forEach(el => {
          const text = el.textContent || '';

          // Email
          const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/);
          if (emailMatch && !result.emails.includes(emailMatch[0])) {
            result.emails.push(emailMatch[0]);
          }

          // Phone
          const phoneMatch = text.match(/[\+]?[\d\s\-\(\)]{10,}/);
          if (phoneMatch && !result.phones.includes(phoneMatch[0])) {
            result.phones.push(phoneMatch[0].trim());
          }
        });

        return result;
      });

      return info;
    },
  };

  const extractor = extractors[platform];
  if (!extractor) return { error: 'Platform not supported' };

  return await extractor();
}

export async function bulkExtractContacts(page, platform, profileUrls) {
  const results = [];

  for (const url of profileUrls) {
    try {
      const info = await extractContactInfo(page, platform, url);
      results.push({ url, ...info, success: true });
      await page.waitForTimeout(1500); // Rate limiting
    } catch (error) {
      results.push({ url, error: error.message, success: false });
    }
  }

  return results;
}
