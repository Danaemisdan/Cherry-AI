import { openAttachedPage, pauseLikeHuman, typeLikeHuman, waitForVisible } from '../common.js';

export const chatgptHandler = {
  async execute({ step, attachedBrowser }) {
    if (step.action === 'generate_image') {
      const page = await openAttachedPage(attachedBrowser, 'https://chat.openai.com/', { platform: 'chatgpt' });
      await pauseLikeHuman(page, 1500, 3000);

      // Find the chat input
      const promptText = `Generate an image based on this description: ${step.args.prompt || 'A beautiful futuristic landscape'}. Make sure to only output the image and no other text.`;
      
      const inputLocator = await waitForVisible(page, [
        'textarea#prompt-textarea',
        'textarea[data-id="root"]',
        'div[contenteditable="true"]'
      ], 10000);

      if (!inputLocator) {
        throw new Error('ChatGPT chat input not found. Make sure you are logged in.');
      }

      // Type the prompt
      await typeLikeHuman(page, inputLocator, promptText);
      await pauseLikeHuman(page, 500, 1000);

      // Press Enter
      await page.keyboard.press('Enter');
      
      // Wait for image to generate
      await pauseLikeHuman(page, 10000, 15000); // Image generation takes time

      // Look for the generated image
      const imageLocator = await waitForVisible(page, [
        'img[alt*="Generated image"]',
        'div[data-message-author-role="assistant"] img'
      ], 45000); // Up to 45 seconds to generate

      if (imageLocator) {
        const src = await imageLocator.getAttribute('src');
        return {
          status: 'completed',
          summary: 'Successfully generated image on ChatGPT.',
          data: { imageUrl: src }
        };
      }

      return {
        status: 'failed',
        summary: 'Failed to extract generated image from ChatGPT.',
        error: 'Image not found in the chat output.'
      };
    }

    throw new Error(`ChatGPT does not support action: ${step.action}`);
  }
};
