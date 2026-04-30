// Expanded LinkedIn capabilities - posts, jobs, companies, search filters

import { navigate, pageSnapshot, firstWorkingLocator, clickByText, fillEditable } from './common.js';

export async function createLinkedInPost(page, content, options = {}) {
  const { media = [], visibility = 'anyone' } = options;

  await navigate(page, 'https://www.linkedin.com/post/new/');
  await page.waitForSelector('[data-testid="share-box"], .share-box, div[role="textbox"]', { timeout: 10000 });

  // Fill post content
  const editor = await firstWorkingLocator(page, ['[data-testid="share-box"] div[role="textbox"]', '.share-box div[contenteditable="true"]', 'div[role="textbox"]']);
  await fillEditable(page, editor, content);

  // Add media if provided
  if (media.length > 0) {
    const mediaBtn = await firstWorkingLocator(page, ['button[aria-label="Add media"]', '[data-testid="add-media"]', 'button:has-text("Photo")']);
    if (mediaBtn) {
      await mediaBtn.click();
      // Handle file upload
      const fileInput = await page.locator('input[type="file"]').first();
      if (fileInput) {
        await fileInput.setInputFiles(media);
      }
    }
  }

  // Set visibility
  if (visibility !== 'anyone') {
    const visibilityBtn = await firstWorkingLocator(page, ['button[aria-label="Post settings"]', '[data-testid="visibility-settings"]']);
    if (visibilityBtn) await visibilityBtn.click();
    await clickByText(page, visibility === 'connections' ? 'Connections only' : 'Anyone');
  }

  // Post
  const postBtn = await firstWorkingLocator(page, ['button[data-testid="share-post"]', 'button:has-text("Post")', '[aria-label="Post"]']);
  if (postBtn) {
    await postBtn.click();
    await page.waitForTimeout(2000);
    return { success: true, message: 'Post created successfully' };
  }

  return { success: false, message: 'Could not find post button' };
}

export async function searchLinkedInJobs(page, query, filters = {}) {
  const { location, experienceLevel, jobType, remote = false, past24h = false } = filters;

  let url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}`;

  if (location) url += `&location=${encodeURIComponent(location)}`;
  if (remote) url += '&f_WT=2'; // Remote filter
  if (past24h) url += '&f_TPR=r86400'; // Past 24 hours
  if (experienceLevel) url += `&f_E=${experienceLevel}`; // 2=Entry, 3=Associate, 4=Mid, 5=Senior

  await navigate(page, url);
  await page.waitForTimeout(3000);

  // Extract job listings
  const jobs = await page.evaluate(() => {
    const results = [];
    const cards = document.querySelectorAll('.jobs-search-results__list-item, [data-job-id]');

    cards.forEach((card) => {
      const id = card.getAttribute('data-job-id') || '';
      const title = card.querySelector('.job-card-list__title, h3')?.textContent?.trim() || '';
      const company = card.querySelector('.job-card-container__company-name, .artdeco-entity-lockup__subtitle')?.textContent?.trim() || '';
      const location = card.querySelector('.job-card-container__metadata-item, .artdeco-entity-lockup__caption')?.textContent?.trim() || '';
      const link = card.querySelector('a')?.href || '';

      if (title && company) {
        results.push({ id, title, company, location, link });
      }
    });

    return results.slice(0, 25);
  });

  return { jobs, count: jobs.length };
}

export async function applyToLinkedInJob(page, jobId, applicationData = {}) {
  const { resume, coverLetter, email, phone } = applicationData;

  // Navigate to job
  await navigate(page, `https://www.linkedin.com/jobs/view/${jobId}/`);
  await page.waitForTimeout(2000);

  // Click Easy Apply if available
  const easyApplyBtn = await firstWorkingLocator(page, ['button:has-text("Easy Apply")', '[aria-label*="Easy Apply"]', '.jobs-apply-button']);
  if (!easyApplyBtn) {
    return { success: false, message: 'No Easy Apply button found - external application required' };
  }

  await easyApplyBtn.click();
  await page.waitForTimeout(2000);

  // Fill application form
  const inputs = await page.locator('input[type="text"], input[type="email"], input[type="tel"], textarea').all();

  for (const input of inputs) {
    const label = await input.evaluate(el => {
      const id = el.id;
      const aria = el.getAttribute('aria-label');
      const labelEl = document.querySelector(`label[for="${id}"]`);
      return labelEl?.textContent || aria || '';
    });

    if (label.toLowerCase().includes('email') && email) {
      await input.fill(email);
    } else if (label.toLowerCase().includes('phone') && phone) {
      await input.fill(phone);
    } else if (label.toLowerCase().includes('cover') && coverLetter) {
      await input.fill(coverLetter);
    }
  }

  // Upload resume if input exists
  if (resume) {
    const fileInput = await page.locator('input[type="file"]').first();
    if (fileInput) {
      await fileInput.setInputFiles(resume);
    }
  }

  // Submit
  const submitBtn = await firstWorkingLocator(page, ['button:has-text("Submit")', 'button:has-text("Continue")', '[aria-label="Submit application"]']);
  if (submitBtn) {
    await submitBtn.click();
    await page.waitForTimeout(3000);
    return { success: true, message: 'Application submitted' };
  }

  return { success: false, message: 'Could not submit application' };
}

export async function searchLinkedInCompanies(page, query, filters = {}) {
  const { industry, companySize, location } = filters;

  let url = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(query)}`;
  if (companySize) url += `&companySize=${companySize}`;

  await navigate(page, url);
  await page.waitForTimeout(3000);

  const companies = await page.evaluate(() => {
    const results = [];
    const cards = document.querySelectorAll('.entity-result, .search-result');

    cards.forEach((card) => {
      const name = card.querySelector('.entity-result__title-text, .org-top-card-summary__title')?.textContent?.trim() || '';
      const link = card.querySelector('a')?.href || '';
      const followers = card.querySelector('.entity-result__primary-subtitle')?.textContent?.trim() || '';
      const description = card.querySelector('.entity-result__summary')?.textContent?.trim() || '';
      const industry = card.querySelector('.entity-result__secondary-subtitle')?.textContent?.trim() || '';

      if (name) {
        results.push({ name, link, followers, description, industry });
      }
    });

    return results.slice(0, 25);
  });

  return { companies, count: companies.length };
}

export async function extractLinkedInCompanyDetails(page, companyUrl) {
  await navigate(page, companyUrl);
  await page.waitForTimeout(3000);

  const details = await page.evaluate(() => {
    const name = document.querySelector('h1')?.textContent?.trim() || '';
    const description = document.querySelector('.org-about-us-organization-description__text')?.textContent?.trim() || '';
    const website = document.querySelector('a[data-control-name="visit_company_website"]')?.href || '';
    const industry = document.querySelector('.org-page-details__definition-text')?.textContent?.trim() || '';
    const size = document.querySelector('.org-about-company-module__company-size-definition-text')?.textContent?.trim() || '';

    // Extract employee list
    const employees = [];
    document.querySelectorAll('.org-people-profile-card').forEach((card) => {
      const empName = card.querySelector('.artdeco-entity-lockup__title')?.textContent?.trim() || '';
      const title = card.querySelector('.artdeco-entity-lockup__subtitle')?.textContent?.trim() || '';
      if (empName) employees.push({ name: empName, title });
    });

    return { name, description, website, industry, size, employees: employees.slice(0, 10) };
  });

  return details;
}

export async function advancedLinkedInSearch(page, query, filters = {}) {
  const {
    searchType = 'people', // people, companies, jobs, posts
    connections = '2nd', // 1st, 2nd, 3rd+
    location = '',
    industry = '',
    currentCompany = '',
    pastCompany = '',
    title = '',
    school = '',
    profileLanguage = '',
  } = filters;

  let url = '';

  switch (searchType) {
    case 'people':
      url = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
      if (connections) url += `&network=${connections === '1st' ? 'F' : connections === '2nd' ? 'S' : 'O'}`;
      if (location) url += `&geoUrn=${encodeURIComponent(location)}`;
      if (industry) url += `&industry=${encodeURIComponent(industry)}`;
      if (currentCompany) url += `&currentCompany=${encodeURIComponent(currentCompany)}`;
      break;

    case 'companies':
      url = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(query)}`;
      if (industry) url += `&industry=${encodeURIComponent(industry)}`;
      break;

    case 'jobs':
      url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}`;
      if (location) url += `&location=${encodeURIComponent(location)}`;
      break;

    case 'posts':
      url = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(query)}`;
      if (filters.past24h) url += '&sortBy=date_posted';
      break;
  }

  await navigate(page, url);
  await page.waitForTimeout(3000);

  // Return snapshot for further processing
  return await pageSnapshot(page, { withText: true });
}
