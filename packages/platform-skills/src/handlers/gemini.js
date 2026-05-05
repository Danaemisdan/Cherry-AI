import { openAttachedPage, pauseLikeHuman, typeLikeHuman, waitForVisible } from '../common.js';

export const geminiHandler = {
  async execute({ step, attachedBrowser }) {
    if (step.action === 'generate_image') {
      const page = await openAttachedPage(attachedBrowser, 'https://gemini.google.com/', { platform: 'gemini' });
      await pauseLikeHuman(page, 1500, 3000);

      // Find the chat input
      const promptText = `Generate an image based on this description: ${step.args.prompt || 'A beautiful futuristic landscape'}. Make sure to only output the image and no other text.`;
      
      const inputLocator = await waitForVisible(page, [
        'div[contenteditable="true"][role="textbox"]',
        'textarea[aria-label*="prompt"]',
        'rich-textarea'
      ], 10000);

      if (!inputLocator) {
        throw new Error('Gemini chat input not found. Make sure you are logged in.');
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
        'img[src*="googleusercontent"]'
      ], 45000); // Up to 45 seconds to generate

      if (imageLocator) {
        const src = await imageLocator.getAttribute('src');
        return {
          status: 'completed',
          summary: 'Successfully generated image on Gemini.',
          data: { imageUrl: src }
        };
      }

      return {
        status: 'failed',
        summary: 'Failed to extract generated image from Gemini.',
        error: 'Image not found in the chat output.'
      };
    }

    throw new Error(`Gemini does not support action: ${step.action}`);
  }
};
