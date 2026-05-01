import {
  PLATFORM_URLS,
  buildPlatformSearchUrl,
  clickByText,
  composeComment,
  composePost,
  ensurePlatformReady,
  fillEditable,
  generateOutreachMessage,
  openAttachedPage,
  openSearchSurface,
  openTargetPage,
  pageSnapshot,
  reviewQueue,
  runBatchAction,
  scrapeGoogleResults,
  scrapePlatformProfiles,
  submitComposer,
  summarizeAction,
  tryClick,
  waitForAppShell,
} from './common.js';
import { checkLoginState } from './state-checker.js';
import { extractChatContext } from './chat-context.js';
import { mapAllContacts, exportForDashboard, extractWhatsAppContacts, extractLinkedInContacts, extractInstagramContacts } from './contact-mapper.js';

export function createSocialHandler(platform, config) {
  async function draftOrSendMessage(attachedBrowser, step, usernameOverride, providedChatContext = null) {
    // Check login state first
    const page = attachedBrowser?.page;
    if (page) {
      const state = await checkLoginState(page, platform);
      if (!state.ready) {
        return {
          success: false,
          needsAuth: true,
          message: state.message || `Please log in to ${platform}`,
        };
      }
    }

    // Extract chat context if not provided (for all platforms)
    let chatContext = providedChatContext;
    if (!chatContext && page && (step.action === 'send_message' || step.action === 'draft_message')) {
      chatContext = await extractChatContext(page, platform, 8);
    }
    const username = usernameOverride || step.args.username;

    // Open the target conversation page
    const targetPage = await openTargetPage(attachedBrowser, { platform, username });

    const message = await generateOutreachMessage({
      username,
      goal: step.args.messageGoal,
      tone: step.args.tone,
      query: step.args.query,
      platform,
      chatContext,
    });

    if (config.openMessage) {
      await config.openMessage(targetPage, username);
    }

    const filled = await fillEditable(targetPage, config.messageComposerSelectors, config.messageLengthLimit ? message.slice(0, config.messageLengthLimit) : message);
    if (!filled.ok) {
      throw new Error(`Could not open the ${platform} message composer for "${username}"`);
    }

    if (!step.args.requireManualReview) {
      if (config.sendMessage) {
        await config.sendMessage(targetPage);
      } else {
        await submitComposer(targetPage, config.sendMessageSelectors || [], config.sendMessageLabels || []);
      }
    }

    return { page: targetPage, message, sent: !step.args.requireManualReview };
  }

  async function followUser(attachedBrowser, step, usernameOverride) {
    const username = usernameOverride || step.args.username;
    const page = await openTargetPage(attachedBrowser, { platform, username });
    const clicked =
      (await clickByText(page, config.followSelectors || ['button', 'div[role="button"]', 'a'], config.followLabels || ['Follow', 'Connect'])) ||
      (await tryClick(page, config.followClickSelectors || []));

    if (!clicked) {
      throw new Error(`Could not find a follow/connect action for "${username}" on ${platform}`);
    }

    return { page, clicked };
  }

  async function engagePost(attachedBrowser, step, usernameOverride) {
    const username = usernameOverride || step.args.username;
    const page = await openTargetPage(attachedBrowser, { platform, username });
    const comment = await composeComment({ tone: step.args.tone, goal: step.args.messageGoal });

    if (config.openLatestPost) {
      await config.openLatestPost(page);
    }
    if (config.likePost) {
      await config.likePost(page);
    }

    const filled = await fillEditable(page, config.commentSelectors || [], comment);
    if (!filled.ok) {
      throw new Error(`Could not prepare a ${platform} comment for "${username}"`);
    }

    if (!step.args.requireManualReview) {
      if (config.sendComment) {
        await config.sendComment(page);
      } else {
        await submitComposer(page, config.commentSubmitSelectors || [], config.commentSubmitLabels || ['Post', 'Reply']);
      }
    }

    return { page, comment, sent: !step.args.requireManualReview };
  }

  async function composeOrPublishPost(attachedBrowser, step) {
    const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS[platform], { platform });
    const postText = composePost({ platform, goal: step.args.messageGoal, tone: step.args.tone, query: step.args.query });

    if (config.openPostComposer) {
      await config.openPostComposer(page);
    }

    const filled = await fillEditable(page, config.postComposerSelectors || [], postText);
    if (!filled.ok) {
      throw new Error(`Could not open the ${platform} post composer`);
    }

    // Handle file attachment if provided
    if (step.args.attachmentPath) {
      try {
        await page.waitForTimeout(800); // Wait for composer to settle

        // Look for attachment button or file input
        const attachmentSelectors = [
          'input[type="file"]',
          'input[accept*="image"]',
          'button[aria-label*="photo"]', 
          'button[aria-label*="image"]',
          'button[aria-label*="attach"]',
          'button[aria-label*="file"]',
          'div[role="button"][aria-label*="photo"]',
          'div[role="button"][aria-label*="image"]',
          'svg[aria-label*="photo"]',
          'svg[aria-label*="image"]',
          '[data-testid*="photo"]',
          '[data-testid*="attachment"]',
        ];

        let attached = false;
        for (const selector of attachmentSelectors) {
          try {
            const locator = page.locator(selector).first();
            if (await locator.count() > 0 && await locator.isVisible()) {
              const isFileInput = await locator.evaluate(el => el.tagName === 'INPUT').catch(() => false);
              if (isFileInput) {
                await locator.setInputFiles(step.args.attachmentPath);
                attached = true;
              } else {
                // Click attachment button then find file input
                await locator.click({ timeout: 2000 });
                await page.waitForTimeout(1000);
                const fileInput = await page.locator('input[type="file"]').first();
                if (await fileInput.count() > 0) {
                  await fileInput.setInputFiles(step.args.attachmentPath);
                  attached = true;
                }
              }
              if (attached) break;
            }
          } catch { /* continue */ }
        }

        // Platform-specific fallbacks
        if (!attached && config.attachMedia) {
          attached = await config.attachMedia(page, step.args.attachmentPath);
        }

        // Wait for upload to complete
        if (attached) {
          await page.waitForTimeout(3000);
        }
      } catch (attachError) {
        console.warn(`${platform} attachment failed:`, attachError.message);
        // Continue without attachment
      }
    }

    if (step.action === 'publish_post' && !step.args.requireManualReview) {
      if (config.publishPost) {
        await config.publishPost(page);
      } else {
        await submitComposer(page, config.publishPostSelectors || [], config.publishPostLabels || ['Post']);
      }
    }

    return { page, postText, sent: step.action === 'publish_post' && !step.args.requireManualReview };
  }

  return {
    platform,
    async execute({ step, attachedBrowser }) {
      if (step.action === 'open_workspace') {
        const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS[platform], { platform });
        return { status: 'ready', summary: summarizeAction(platform, step), data: await pageSnapshot(page) };
      }

      if (step.action === 'search') {
        const page = await openSearchSurface(await openAttachedPage(attachedBrowser, PLATFORM_URLS[platform], { platform }), platform, step.args.query || step.args.prompt);
        return { status: 'ready', summary: summarizeAction(platform, step), data: await pageSnapshot(page) };
      }

      if (step.action === 'scrape_results') {
        if (['find_leads', 'lead_and_message', 'execute_deep_scrape'].includes(step.args.operation)) {
          const { page, results } = await scrapeGoogleResults(attachedBrowser, {
            query: step.args.query || step.args.prompt,
            platform,
            maxResults: step.args.maxResults,
          });
          return { status: 'completed', summary: summarizeAction(platform, step), data: { page: await pageSnapshot(page), results } };
        }

        const page = await openSearchSurface(await openAttachedPage(attachedBrowser, PLATFORM_URLS[platform], { platform }), platform, step.args.query || step.args.prompt);
        const results = await scrapePlatformProfiles(page, platform, step.args.maxResults);
        return { status: 'completed', summary: summarizeAction(platform, step), data: { page: await pageSnapshot(page), results } };
      }

      if (step.action === 'open_target') {
        const page = await openTargetPage(attachedBrowser, { platform, username: step.args.username });
        if (config.afterOpenTarget) {
          await config.afterOpenTarget(page, step.args.username);
        }
        return { status: 'ready', summary: summarizeAction(platform, step), data: await pageSnapshot(page) };
      }

      if (step.action === 'draft_message') {
        return {
          status: 'ready',
          summary: summarizeAction(platform, step),
          data: {
            preview: await generateOutreachMessage({
              username: step.args.username,
              goal: step.args.messageGoal,
              tone: step.args.tone,
              query: step.args.query,
              platform,
              chatContext: [],
            }),
          },
        };
      }

      if (step.action === 'send_message') {
        const result = await draftOrSendMessage(attachedBrowser, step);
        return { status: 'completed', summary: summarizeAction(platform, step, result), data: { page: await pageSnapshot(result.page), message: result.message, sent: result.sent } };
      }

      if (step.action === 'message_batch') {
        const outputs = await runBatchAction(step, async (username) => draftOrSendMessage(attachedBrowser, step, username));
        return { status: 'completed', summary: summarizeAction(platform, step, { sent: !step.args.requireManualReview }), data: outputs.map((item) => ({ url: item.page.url(), message: item.message, sent: item.sent })) };
      }

      if (step.action === 'follow_user') {
        const result = await followUser(attachedBrowser, step);
        return { status: 'completed', summary: summarizeAction(platform, step, result), data: { page: await pageSnapshot(result.page), clicked: result.clicked } };
      }

      if (step.action === 'engage_post') {
        const result = await engagePost(attachedBrowser, step);
        return { status: 'completed', summary: summarizeAction(platform, step, result), data: { page: await pageSnapshot(result.page), comment: result.comment, sent: result.sent } };
      }

      if (step.action === 'engage_batch' || step.action === 'follow_batch') {
        const outputs = await runBatchAction(step, async (username) => (
          step.action === 'engage_batch' ? engagePost(attachedBrowser, step, username) : followUser(attachedBrowser, step, username)
        ));
        return { status: 'completed', summary: summarizeAction(platform, step), data: outputs.map((item) => ({ url: item.page.url(), sent: item.sent, clicked: item.clicked })) };
      }

      if (step.action === 'compose_post' || step.action === 'publish_post') {
        const result = await composeOrPublishPost(attachedBrowser, step);
        return { status: 'completed', summary: summarizeAction(platform, step, result), data: { page: await pageSnapshot(result.page), postText: result.postText, sent: result.sent } };
      }

      if (step.action === 'review_queue' || step.action === 'continue_outreach') {
        const { page } = await reviewQueue(attachedBrowser, platform);
        return { status: 'ready', summary: summarizeAction(platform, step), data: await pageSnapshot(page) };
      }

      if (step.action === 'extract_context' || step.action === 'export_artifact') {
        const page = await openAttachedPage(attachedBrowser, buildPlatformSearchUrl(platform, step.args.query || step.args.prompt), { platform, forceNavigate: true });
        return { status: 'completed', summary: summarizeAction(platform, step), data: await pageSnapshot(page) };
      }

      if (step.action === 'map_contacts') {
        const { includeConversations = true, includePending = true } = step.args || {};
        
        let contacts = [];
        
        switch (platform) {
          case 'whatsapp':
            const page = await openAttachedPage(attachedBrowser, PLATFORM_URLS[platform], { platform });
            contacts = await extractWhatsAppContacts(page, { includeChats: includeConversations });
            break;
          case 'linkedin':
            const liPage = await openAttachedPage(attachedBrowser, PLATFORM_URLS[platform], { platform });
            contacts = await extractLinkedInContacts(liPage, { includePending });
            break;
          case 'instagram':
            const igPage = await openAttachedPage(attachedBrowser, PLATFORM_URLS[platform], { platform });
            contacts = await extractInstagramContacts(igPage, { includePending });
            break;
          default:
            throw new Error(`Contact mapping not yet supported for ${platform}`);
        }
        
        return {
          status: 'completed',
          summary: `Mapped ${contacts.count || contacts.totalCount || 0} contacts from ${platform}`,
          data: {
            platform,
            contacts,
            dashboardData: exportForDashboard({ platforms: { [platform]: contacts }, categorized: contacts.categorized || {}, totalContacts: contacts.count || 0, timestamp: Date.now() }),
          },
        };
      }

      throw new Error(`${platform} does not support the "${step.action}" action in Cherry yet`);
    },
  };
}
