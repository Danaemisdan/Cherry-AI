// Chat context extraction for all social platforms

export async function extractChatContext(page, platform, limit = 8) {
  const extractors = {
    instagram: async () => {
      try {
        const messages = await page.evaluate((msgLimit) => {
          const result = [];
          const selectors = [
            '[data-testid="message-bubble"]', // DM bubbles
            '[data-testid="message-text"]', // Text content
            'div[role="listitem"] span', // Generic list items
            'div[style*="flex-direction: column"] > div', // Message containers
          ];

          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              elements.forEach((el) => {
                if (result.length >= msgLimit) return;

                const isOutgoing = el.closest('[data-testid="message-bubble-outgoing"]') !== null ||
                                  el.querySelector('[data-testid="message-bubble-outgoing"]') !== null ||
                                  el.getAttribute('data-testid')?.includes('outgoing');

                const textEl = el.querySelector('span, div[dir="auto"]') || el;
                const text = (textEl.textContent || '').trim();

                if (text && text.length > 1) {
                  const last = result[result.length - 1];
                  if (!last || last.text !== text) {
                    result.push({ role: isOutgoing ? 'me' : 'them', text: text.slice(0, 300) });
                  }
                }
              });
              if (result.length > 0) break;
            }
          }
          return result.slice(-msgLimit);
        }, limit);
        return messages || [];
      } catch { return []; }
    },

    twitter: async () => {
      try {
        const messages = await page.evaluate((msgLimit) => {
          const result = [];
          const selectors = [
            '[data-testid="messageEntry"]',
            '[data-testid="conversation"] [role="article"]',
            '[data-testid="DMDrawer"] div[role="button"]',
          ];

          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              elements.forEach((el) => {
                if (result.length >= msgLimit) return;

                const isOutgoing = el.getAttribute('data-testid')?.includes('sent') ||
                                  el.closest('[data-testid*="sent"]') !== null;

                const text = (el.textContent || '').trim();
                if (text && text.length > 1 && !text.includes('Message')) {
                  const last = result[result.length - 1];
                  if (!last || last.text !== text) {
                    result.push({ role: isOutgoing ? 'me' : 'them', text: text.slice(0, 300) });
                  }
                }
              });
              if (result.length > 0) break;
            }
          }
          return result.slice(-msgLimit);
        }, limit);
        return messages || [];
      } catch { return []; }
    },

    linkedin: async () => {
      try {
        const messages = await page.evaluate((msgLimit) => {
          const result = [];
          const selectors = [
            '.msg-s-message-list__event',
            '.msg-s-event-listitem__message-bubble',
            '[data-control-name="message_bubble"]',
          ];

          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              elements.forEach((el) => {
                if (result.length >= msgLimit) return;

                const isOutgoing = el.classList.contains('msg-s-event-listitem--sent') ||
                                  el.closest('.msg-s-event-listitem--sent') !== null ||
                                  el.getAttribute('data-control-name')?.includes('sent');

                const textEl = el.querySelector('.msg-s-event-listitem__body, span[dir="ltr"]') || el;
                const text = (textEl.textContent || '').trim();

                if (text && text.length > 1) {
                  const last = result[result.length - 1];
                  if (!last || last.text !== text) {
                    result.push({ role: isOutgoing ? 'me' : 'them', text: text.slice(0, 300) });
                  }
                }
              });
              if (result.length > 0) break;
            }
          }
          return result.slice(-msgLimit);
        }, limit);
        return messages || [];
      } catch { return []; }
    },

    facebook: async () => {
      try {
        const messages = await page.evaluate((msgLimit) => {
          const result = [];
          const selectors = [
            '[data-testid="message-container"]',
            '.__fb-dark-mode [role="none"] div[dir="auto"]',
            '[role="main"] div[dir="auto"]',
          ];

          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              elements.forEach((el) => {
                if (result.length >= msgLimit) return;

                const isOutgoing = el.classList.contains('x14ctfv') || // Outgoing bubble class
                                  el.closest('[class*="outgoing"]') !== null;

                const text = (el.textContent || '').trim();
                if (text && text.length > 1 && !text.startsWith('React')) {
                  const last = result[result.length - 1];
                  if (!last || last.text !== text) {
                    result.push({ role: isOutgoing ? 'me' : 'them', text: text.slice(0, 300) });
                  }
                }
              });
              if (result.length > 0) break;
            }
          }
          return result.slice(-msgLimit);
        }, limit);
        return messages || [];
      } catch { return []; }
    },

    gmail: async () => {
      try {
        const messages = await page.evaluate((msgLimit) => {
          const result = [];
          const selectors = [
            '.ii.gt .a3s.aiL', // Email body
            '.h7', // Email thread
            '[data-legacy-thread-id] .gmail_quote', // Quoted reply
          ];

          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              elements.forEach((el) => {
                if (result.length >= msgLimit) return;

                // Gmail doesn't have clear me/them in thread view easily
                const isOutgoing = el.closest('[data-legacy-draft-id]') !== null ||
                                  el.classList.contains('gmail_quote') === false;

                const text = (el.textContent || '').trim();
                if (text && text.length > 10) {
                  const last = result[result.length - 1];
                  if (!last || last.text !== text) {
                    result.push({ role: isOutgoing ? 'me' : 'them', text: text.slice(0, 500) });
                  }
                }
              });
              if (result.length > 0) break;
            }
          }
          return result.slice(-msgLimit);
        }, limit);
        return messages || [];
      } catch { return []; }
    },

    whatsapp: async () => {
      try {
        const messages = await page.evaluate((msgLimit) => {
          const result = [];
          const selectors = [
            '[data-testid="msg-container"]',
            '.message-in',
            '.message-out',
            '[data-testid="msg"]',
          ];

          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              elements.forEach((el) => {
                if (result.length >= msgLimit) return;

                const isOutgoing = el.classList.contains('message-out') ||
                                  el.closest('.message-out') !== null ||
                                  el.getAttribute('data-testid')?.includes('out');

                const textEl = el.querySelector('.selectable-text, span[dir="ltr"]') || el;
                const text = (textEl.textContent || '').trim();

                if (text && text.length > 1) {
                  const last = result[result.length - 1];
                  if (!last || last.text !== text) {
                    result.push({ role: isOutgoing ? 'me' : 'them', text: text.slice(0, 300) });
                  }
                }
              });
              if (result.length > 0) break;
            }
          }
          return result.slice(-msgLimit);
        }, limit);
        return messages || [];
      } catch { return []; }
    },
  };

  const extractor = extractors[platform];
  if (!extractor) return [];

  return await extractor();
}
