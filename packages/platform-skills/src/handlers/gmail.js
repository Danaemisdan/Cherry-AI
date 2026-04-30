import {
  PLATFORM_URLS,
  buildPlatformSearchUrl,
  fillEditable,
  generateOutreachMessage,
  navigate,
  openAttachedPage,
  pageSnapshot,
  reviewQueue,
  summarizeAction,
} from '../common.js';

export const gmailHandler = {
  platform: 'gmail',
  async execute({ step, attachedBrowser }) {
    if (step.action === 'open_workspace') {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      return { status: 'ready', summary: summarizeAction('gmail', step), data: await pageSnapshot(page) };
    }

    if (step.action === 'search') {
      const page = await openAttachedPage(attachedBrowser, buildPlatformSearchUrl('gmail', step.args.query || step.args.prompt), { platform: 'gmail', forceNavigate: true });
      return { status: 'ready', summary: summarizeAction('gmail', step), data: await pageSnapshot(page) };
    }

    if (step.action === 'open_target' || step.action === 'draft_message' || step.action === 'send_message') {
      const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS.gmail, { platform: 'gmail' });
      const message = await generateOutreachMessage({
        username: step.args.username,
        goal: step.args.messageGoal,
        tone: step.args.tone,
        query: step.args.query,
        platform: 'gmail',
        chatContext: [],
      });

      if (step.action === 'draft_message') {
        return { status: 'ready', summary: summarizeAction('gmail', step), data: { preview: message } };
      }

      await navigate(page, PLATFORM_URLS.gmail, 'gmail');
      await page.getByRole('button', { name: /compose/i }).click().catch(() => {});
      const recipientsFilled = step.args.username ? await fillEditable(page, ['input[aria-label*="Recipients"]', 'input[role="combobox"]'], step.args.username) : { ok: true };
      const subjectFilled = await fillEditable(page, ['input[name="subjectbox"]'], step.args.messageGoal || step.args.query || 'Quick note');
      const bodyFilled = await fillEditable(page, ['div[aria-label="Message Body"][contenteditable="true"]'], message);

      if (!recipientsFilled.ok || !subjectFilled.ok || !bodyFilled.ok) {
        throw new Error('Could not prepare the Gmail draft');
      }

      if (step.action === 'send_message' && !step.args.requireManualReview) {
        await page.keyboard.press((process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')).catch(() => {});
      }

      return {
        status: step.action === 'send_message' ? 'completed' : 'ready',
        summary: summarizeAction('gmail', step, { sent: step.action === 'send_message' && !step.args.requireManualReview }),
        data: { page: await pageSnapshot(page), message, sent: step.action === 'send_message' && !step.args.requireManualReview },
      };
    }

    if (step.action === 'review_queue' || step.action === 'continue_outreach') {
      const { page } = await reviewQueue(attachedBrowser, 'gmail');
      return { status: 'ready', summary: summarizeAction('gmail', step), data: await pageSnapshot(page) };
    }

    throw new Error(`gmail does not support the "${step.action}" action in Cherry yet`);
  },
};
