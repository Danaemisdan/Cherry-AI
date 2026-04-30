import { facebookHandler } from './handlers/facebook.js';
import { gmailHandler } from './handlers/gmail.js';
import { instagramHandler } from './handlers/instagram.js';
import { linkedinHandler } from './handlers/linkedin.js';
import { researchHandler } from './handlers/research.js';
import { twitterHandler } from './handlers/twitter.js';
import { whatsappHandler } from './handlers/whatsapp.js';

export const skillRegistry = new Map([
  ['instagram', instagramHandler],
  ['twitter', twitterHandler],
  ['linkedin', linkedinHandler],
  ['facebook', facebookHandler],
  ['gmail', gmailHandler],
  ['whatsapp', whatsappHandler],
  ['research', researchHandler],
]);

export async function executeSkill({ step, attachedBrowser, managedBrowser }) {
  const skill = skillRegistry.get(step.platform);
  if (!skill) {
    throw new Error(`No skill registered for platform ${step.platform}`);
  }
  return skill.execute({ step, attachedBrowser, managedBrowser });
}

// Export test utilities
export { TestRunner, quickHealthCheck, runTests } from './tests/runner.js';
export { checkLoginState, ensurePlatformReadyWithState } from './state-checker.js';
export { extractChatContext } from './chat-context.js';
export { extractContactInfo, bulkExtractContacts } from './lead-extractor.js';
export { createPost, createStory, schedulePost } from './content-poster.js';
export { MultiTabController, BackgroundScheduler } from './multi-tab.js';
