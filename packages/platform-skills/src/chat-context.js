// Chat context extraction for all social platforms
// Filters out UI elements, timestamps, and noise to get actual conversation

function isValidMessage(text) {
  if (!text || text.length < 2 || text.length > 500) return false;

  const normalized = text.toLowerCase().trim();

  // Filter out UI elements and noise
  const noisePatterns = [
    /^(message|send|type a message|write a message)/i,
    /^(seen|delivered|sent|read)$/i,
    /^[\d:]+\s*(am|pm)?$/i, // Timestamps like "4:33 AM"
    /^(today|yesterday|now)$/i,
    /^(liked|love|haha|wow|sad|angry)$/i, // Reactions
    /^(view profile|view photo|1 reply)$/i,
    /^[\d\s:]+$/i, // Just numbers/times
    /^(new message|start a conversation)$/i,
    /^reacted.*to your message$/i,
  ];

  if (noisePatterns.some(p => p.test(normalized))) return false;

  // Filter out very short fragments that look like UI text
  if (text.length < 5 && !/[a-z]{3,}/i.test(text)) return false;

  return true;
}

export async function extractChatContext(page, platform, limit = 8) {
  const extractors = {
    instagram: async () => {
      try {
        const messages = await page.evaluate((msgLimit) => {
          const result = [];

          // Instagram DM specific selectors - ordered by reliability
          const containerSelectors = [
            '[role="main"] [role="log"]', // Main conversation container
            '[data-testid="conversation"]', // Conversation wrapper
            'div[role="main"] div[style*="flex-direction: column"]', // Message list
          ];

          let messageElements = [];

          // Try to find the main conversation container first
          for (const selector of containerSelectors) {
            const container = document.querySelector(selector);
            if (container) {
              // Find message bubbles within container
              const bubbles = container.querySelectorAll('[data-testid="message-bubble"], [data-testid="message-text"], div[dir="auto"] > span');
              if (bubbles.length > 0) {
                messageElements = Array.from(bubbles);
                break;
              }
            }
          }

          // Fallback: search whole page
          if (messageElements.length === 0) {
            const allBubbles = document.querySelectorAll('[data-testid="message-bubble"], [data-testid="message-text"]');
            messageElements = Array.from(allBubbles);
          }

          // Process found elements
          for (const el of messageElements) {
            if (result.length >= msgLimit * 2) break; // Get extra to filter

            // Determine if outgoing (sent by me)
            const isOutgoing =
              el.closest('[data-testid="message-bubble-outgoing"]') !== null ||
              el.getAttribute('data-testid')?.includes('outgoing') ||
              el.closest('div[style*="background-color: rgb(55, 151, 240)"]') !== null || // Instagram blue bubbles
              el.closest('[class*="background-color: rgb(55"]') !== null;

            // Get text content - try multiple strategies
            let text = '';

            // Strategy 1: Look for text in child spans
            const textSpan = el.querySelector('span[dir="auto"], div[dir="auto"]');
            if (textSpan) {
              text = textSpan.textContent || '';
            }

            // Strategy 2: Get direct text content
            if (!text) {
              text = el.textContent || '';
            }

            // Clean the text
            text = text.trim();

            // Skip if not a valid message
            if (!text || text.length < 2) continue;

            // Filter out timestamps, UI elements, etc
            const isNoise = /^(\d{1,2}:\d{2}|seen|sent|delivered|today|yesterday)$/i.test(text) ||
                           text.length < 3 ||
                           (text.length < 10 && /^[a-z\s]+$/i.test(text) && !text.includes(' '));

            if (isNoise) continue;

            // Skip duplicates
            const last = result[result.length - 1];
            if (last && last.text === text && last.role === (isOutgoing ? 'me' : 'them')) continue;

            result.push({
              role: isOutgoing ? 'me' : 'them',
              text: text.slice(0, 400),
              timestamp: Date.now()
            });
          }

          // Return last N messages, ensuring we have the most recent
          return result.slice(-msgLimit);
        }, limit);

        return (messages || []).filter(m => isValidMessage(m.text));
      } catch (e) {
        return [];
      }
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
                                  el.closest('[data-testid*="sent"]') !== null ||
                                  el.closest('[data-testid*="outgoing"]') !== null;

                // Get text from specific elements to avoid noise
                const textEl = el.querySelector('[data-testid="messageText"], span[dir="ltr"], div[dir="auto"]') || el;
                const text = (textEl.textContent || '').trim();

                // Filter out UI noise
                if (!text || text.length < 2) return;
                if (/^(message|send|new message)$/i.test(text)) return;
                if (text.length < 15 && /^[a-z\s]+$/i.test(text) && !text.includes(' ')) return;

                const last = result[result.length - 1];
                if (!last || last.text !== text) {
                  result.push({ role: isOutgoing ? 'me' : 'them', text: text.slice(0, 400) });
                }
              });
              if (result.length > 0) break;
            }
          }
          return result.slice(-msgLimit);
        }, limit);
        return (messages || []);
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

                const textEl = el.querySelector('.msg-s-event-listitem__body, span[dir="ltr"], div[dir="auto"]') || el;
                const text = (textEl.textContent || '').trim();

                // Filter out noise
                if (!text || text.length < 2) return;
                if (/^(write a message|type a message)$/i.test(text)) return;
                if (text.length < 10 && /^[a-z\s]+$/i.test(text)) return;

                const last = result[result.length - 1];
                if (!last || last.text !== text) {
                  result.push({ role: isOutgoing ? 'me' : 'them', text: text.slice(0, 400) });
                }
              });
              if (result.length > 0) break;
            }
          }
          return result.slice(-msgLimit);
        }, limit);
        return (messages || []);
      } catch { return []; }
    },

    facebook: async () => {
      try {
        const messages = await page.evaluate((msgLimit) => {
          const result = [];
          const selectors = [
            '[data-testid="message-container"]',
            'div[role="gridcell"] div[dir="auto"]',
            '[role="main"] div[data-testid="message-container"]',
          ];

          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              elements.forEach((el) => {
                if (result.length >= msgLimit) return;

                // Check for outgoing indicators
                const isOutgoing =
                  el.getAttribute('data-testid')?.includes('outgoing') ||
                  el.closest('[data-testid*="outgoing"]') !== null ||
                  el.closest('div[class*="x14ctfv"]') !== null;

                // Get text from specific child elements
                const textEl = el.querySelector('div[dir="auto"] span, span[dir="auto"], div[dir="auto"]') || el;
                const text = (textEl.textContent || '').trim();

                // Filter noise
                if (!text || text.length < 2) return;
                if (/^(react|reply|write a reply|write something)/i.test(text)) return;
                if (text.length < 10 && /^[a-z\s]+$/i.test(text)) return;
                if (text.startsWith('React') || text.startsWith('Reply')) return;

                const last = result[result.length - 1];
                if (!last || last.text !== text) {
                  result.push({ role: isOutgoing ? 'me' : 'them', text: text.slice(0, 400) });
                }
              });
              if (result.length > 0) break;
            }
          }
          return result.slice(-msgLimit);
        }, limit);
        return (messages || []);
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
