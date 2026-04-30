import { clickByText, waitForAppShell } from '../common.js';
import { createSocialHandler } from '../social-base.js';

export const linkedinHandler = createSocialHandler('linkedin', {
  async openMessage(page) {
    const opened = await clickByText(page, ['button'], ['Message', 'Connect']);
    if (!opened) {
      throw new Error('Could not open the LinkedIn message flow');
    }
    await waitForAppShell(page);
    await clickByText(page, ['button'], ['Add a note']).catch(() => {});
    await waitForAppShell(page);
  },
  messageComposerSelectors: ['textarea[name="message"]', 'div[role="textbox"][contenteditable="true"]'],
  messageLengthLimit: 280,
  sendMessageLabels: ['Send', 'Invite'],
  followLabels: ['Follow', 'Connect'],
  async likePost(page) {
    await page.locator('button[aria-label*="Like"]').first().click().catch(() => {});
  },
  async openLatestPost(page) {
    await page.locator('button[aria-label*="Comment"]').first().click().catch(() => {});
  },
  commentSelectors: ['div[contenteditable="true"][role="textbox"]'],
  commentSubmitLabels: ['Post'],
  async openPostComposer(page) {
    await clickByText(page, ['button', 'div[role="button"]'], ['Start a post']).catch(() => {});
    await waitForAppShell(page);
  },
  postComposerSelectors: ['div[role="textbox"][contenteditable="true"]'],
  publishPostLabels: ['Post'],
});
