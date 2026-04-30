import { tryClick, waitForAppShell } from '../common.js';
import { createSocialHandler } from '../social-base.js';

export const twitterHandler = createSocialHandler('twitter', {
  async openMessage(page) {
    await tryClick(page, ['div[data-testid="sendDMFromProfile"]', 'button[aria-label*="Message"]']);
    await waitForAppShell(page);
  },
  messageComposerSelectors: ['div[data-testid="dmComposerTextInput"]', 'div[contenteditable="true"][role="textbox"]'],
  sendMessageSelectors: ['button[data-testid="dmComposerSendButton"]'],
  sendMessageLabels: ['Send'],
  followLabels: ['Follow'],
  followClickSelectors: ['button[data-testid$="-follow"]'],
  async openLatestPost(page) {
    const article = page.locator('article[data-testid="tweet"]').first();
    await article.scrollIntoViewIfNeeded().catch(() => {});
    await article.locator('button[data-testid="reply"]').click().catch(() => {});
    await waitForAppShell(page);
  },
  async likePost(page) {
    await page.locator('article[data-testid="tweet"]').first().locator('button[data-testid="like"]').click().catch(() => {});
  },
  commentSelectors: ['div[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]'],
  commentSubmitSelectors: ['button[data-testid="tweetButton"]'],
  commentSubmitLabels: ['Reply'],
  postComposerSelectors: ['div[data-testid="tweetTextarea_0"]', 'div[role="textbox"][contenteditable="true"]'],
  publishPostSelectors: ['button[data-testid="tweetButtonInline"]', 'button[data-testid="tweetButton"]'],
  publishPostLabels: ['Post'],
});
