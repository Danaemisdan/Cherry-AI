import { clickByText, waitForAppShell } from '../common.js';
import { createSocialHandler } from '../social-base.js';

export const facebookHandler = createSocialHandler('facebook', {
  async openMessage(page) {
    await clickByText(page, ['a', 'div[role="button"]', 'button'], ['Message']).catch(() => {});
    await waitForAppShell(page);
  },
  messageComposerSelectors: ['div[role="textbox"][contenteditable="true"]', 'textarea'],
  async sendMessage(page) {
    await page.keyboard.press('Enter').catch(() => {});
  },
  followLabels: ['Follow', 'Add friend'],
  async likePost(page) {
    await clickByText(page, ['div[role="button"]', 'button'], ['Like']).catch(() => {});
  },
  commentSelectors: ['div[role="textbox"][contenteditable="true"]'],
  async sendComment(page) {
    await page.keyboard.press('Enter').catch(() => {});
  },
  async openPostComposer(page) {
    await clickByText(page, ['div[role="button"]', 'button'], [`What's on your mind`, 'Create post']).catch(() => {});
    await waitForAppShell(page);
  },
  postComposerSelectors: ['div[role="textbox"][contenteditable="true"]'],
  publishPostLabels: ['Post'],
});
