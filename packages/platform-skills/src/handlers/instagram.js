import { clickByText, submitComposer, tryClick, waitForAppShell } from '../common.js';
import { createSocialHandler } from '../social-base.js';

export const instagramHandler = createSocialHandler('instagram', {
  async openMessage(page) {
    await clickByText(page, ['button', 'div[role="button"]'], ['Message']);
    await waitForAppShell(page);
  },
  messageComposerSelectors: ['textarea', 'div[contenteditable="true"][role="textbox"]', 'div[contenteditable="true"]'],
  sendMessageSelectors: ['button:has-text("Send")'],
  sendMessageLabels: ['Send'],
  followLabels: ['Follow'],
  async openLatestPost(page) {
    await page.locator('a[href*="/p/"], a[href*="/reel/"]').first().click().catch(() => {});
    await waitForAppShell(page);
  },
  async likePost(page) {
    await tryClick(page, ['svg[aria-label="Like"]', 'button svg[aria-label="Like"]']);
  },
  commentSelectors: ['textarea[placeholder*="comment"]', 'textarea'],
  commentSubmitLabels: ['Post'],
  async openPostComposer(page) {
    await clickByText(page, ['a', 'div[role="button"]', 'button'], ['Create']).catch(() => {});
    await waitForAppShell(page);
  },
  postComposerSelectors: ['textarea', 'div[contenteditable="true"][role="textbox"]'],
});
