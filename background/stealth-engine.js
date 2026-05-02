import CDPController from './cdp-controller.js';

const StealthEngine = {
  isAborted: false,
  _abortRejects: [],   // Store all pending sleep reject callbacks so STOP kills them instantly

  checkAbort() {
    if (this.isAborted) throw new Error("USER_ABORTED");
  },

  abort() {
    this.isAborted = true;
    // Immediately reject all pending sleeps so nothing keeps running
    const rejects = [...this._abortRejects];
    this._abortRejects = [];
    for (const reject of rejects) {
      try { reject(new Error("USER_ABORTED")); } catch(e) {}
    }
  },

  reset() {
    this.isAborted = false;
    this._abortRejects = [];
  },

  // Spoof navigator, webdriver flag, etc via CDP before page loads
  async applySpoofing(tabId) {
    const script = `
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    `;
    
    try {
      await CDPController.sendCommand(tabId, 'Page.addScriptToEvaluateOnNewDocument', { source: script });
      await CDPController.sendCommand(tabId, 'Network.setExtraHTTPHeaders', {
        headers: {
          'Accept-Language': 'en-US,en;q=0.9',
          'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"'
        }
      });
    } catch(e) {}
  },

  // Simulate human-like mouse movement using Bezier curves
  async simulateMouseMove(tabId, startX, startY, endX, endY) {
    this.checkAbort();
    const steps = Math.floor(Math.random() * 12) + 10;
    // Bezier control point (slight arc)
    const cpX = (startX + endX) / 2 + (Math.random() * 80 - 40);
    const cpY = (startY + endY) / 2 + (Math.random() * 80 - 40);
    
    for (let i = 1; i <= steps; i++) {
        this.checkAbort();
        const t = i / steps;
        // Quadratic bezier
        const currentX = Math.round((1-t)*(1-t)*startX + 2*(1-t)*t*cpX + t*t*endX);
        const currentY = Math.round((1-t)*(1-t)*startY + 2*(1-t)*t*cpY + t*t*endY);
        
        await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: currentX,
            y: currentY
        });
        
        await this.sleep(Math.floor(Math.random() * 18) + 8);
    }
  },

  // Click at exact coordinates organically (move then click)
  async organicClick(tabId, x, y) {
    this.checkAbort();
    // Random start position
    const startX = Math.floor(Math.random() * 600) + 100;
    const startY = Math.floor(Math.random() * 400) + 100;
    await this.simulateMouseMove(tabId, startX, startY, x, y);
    await this.sleep(Math.floor(Math.random() * 150) + 50);
    await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.sleep(Math.floor(Math.random() * 60) + 30);
    await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await this.sleep(Math.floor(Math.random() * 200) + 100);
  },

  // Organic click on a CSS selector found in the page
  async clickElement(tabId, selector) {
    this.checkAbort();
    const coords = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const el = document.querySelector('${selector.replace(/'/g, '"')}');
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return null;
          return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
        })();
      `,
      returnByValue: true
    });
    if (!coords.result.value) throw new Error("Element not found on page: " + selector);
    const { x, y } = coords.result.value;
    await this.organicClick(tabId, x, y);
    return { x, y };
  },

  // Click on a button/element by matching text content
  async clickByText(tabId, tagName, textContent) {
    this.checkAbort();
    const coords = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
      expression: `
        (() => {
          const els = Array.from(document.querySelectorAll('${tagName}'));
          const el = els.find(e => e.textContent.trim().includes('${textContent.replace(/'/g, '"')}'));
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return null;
          return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
        })();
      `,
      returnByValue: true
    });
    if (!coords.result.value) throw new Error("Button with text not found: " + textContent);
    const { x, y } = coords.result.value;
    await this.organicClick(tabId, x, y);
  },

  // Click on the page search bar (by CSS selector), type query, and press Enter
  async organicSearch(tabId, searchBarSelector, query) {
    this.checkAbort();
    // Click search bar
    await this.clickElement(tabId, searchBarSelector);
    // Brief pause like a human reading the bar
    await this.sleep(Math.floor(Math.random() * 500) + 300);
    // Clear any existing text
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA' });
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', modifiers: 2, windowsVirtualKeyCode: 65, code: 'KeyA' });
    await this.sleep(150);
    // Type the query naturally
    await this.simulateTyping(tabId, query);
    // Pause before hitting enter (like reading what you typed)
    await this.sleep(300);
    // Press Enter
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, code: 'Enter' });
    await this.sleep(50);
    await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, code: 'Enter' });
    // Wait for results to load
    await this.sleep(2000); // Reduced from 2.5-4.5s
  },

  // Navigate back in browser history (like pressing Back button)
  async goBack(tabId) {
    this.checkAbort();
    await CDPController.sendCommand(tabId, 'Runtime.evaluate', { expression: 'window.history.back();' });
    await this.sleep(1500); // Reduced from 2-3.5s
  },

  // Wait for page to settle (poll for document.readyState)
  async waitForPageLoad(tabId, maxWaitMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      this.checkAbort();
      const stateEval = await CDPController.sendCommand(tabId, 'Runtime.evaluate', {
        expression: 'document.readyState',
        returnByValue: true
      });
      if (stateEval.result.value === 'complete') return;
      await this.sleep(500);
    }
  },

  // Simulates a human typing at varying WPM with natural typo-corrections
  async simulateTyping(tabId, text) {
    this.checkAbort();
    const keyboardLayout = "qwertyuiopasdfghjklzxcvbnm";
    for (let i = 0; i < text.length; i++) {
        this.checkAbort();
        const char = text[i];
        
        // 4% chance to make a typo if character is alphabetical
        if (Math.random() < 0.04 && keyboardLayout.includes(char.toLowerCase())) {
            const wrongChar = keyboardLayout.charAt(Math.floor(Math.random() * keyboardLayout.length));
            await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'char', text: wrongChar });
            await this.sleep(Math.floor(Math.random() * 80) + 70);
            await this.sleep(Math.floor(Math.random() * 300) + 150); // "oh no" pause
            await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8, code: 'Backspace' });
            await this.sleep(Math.floor(Math.random() * 40) + 20);
            await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8, code: 'Backspace' });
            await this.sleep(Math.floor(Math.random() * 150) + 50);
        }
        
        await CDPController.sendCommand(tabId, 'Input.dispatchKeyEvent', { type: 'char', text: char });
        
        // 10% chance for a longer "thinking" pause
        if (Math.random() < 0.10) {
           await this.sleep(Math.floor(Math.random() * 400) + 200);
        } else {
           await this.sleep(Math.floor(Math.random() * 90) + 40);
        }
    }
  },

  async simulateScroll(tabId, direction = 'down', scrolls = 1) {
    this.checkAbort();
    for (let s = 0; s < scrolls; s++) {
      this.checkAbort();
      const distance = Math.floor(Math.random() * 300) + 150;
      const ydelta = direction === 'down' ? distance : -distance;
      const centerX = Math.floor(Math.random() * 400) + 200;
      const centerY = Math.floor(Math.random() * 200) + 200;
      
      await CDPController.sendCommand(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: centerX,
        y: centerY,
        deltaX: 0,
        deltaY: ydelta
      });
      
      await this.sleep(Math.floor(Math.random() * 1200) + 500);
    }
  },

  // Full sleep that can be killed instantly by abort()
  sleep(ms) {
    this.checkAbort();
    let _reject;
    let tid;
    const p = new Promise((resolve, reject) => {
      _reject = (err) => {
        clearTimeout(tid);
        reject(err);
      };
      
      tid = setTimeout(() => {
        const idx = this._abortRejects.indexOf(_reject);
        if (idx !== -1) this._abortRejects.splice(idx, 1);
        
        if (this.isAborted) { _reject(new Error("USER_ABORTED")); }
        else resolve();
      }, ms);
    });
    
    this._abortRejects.push(_reject);
    return p;
  }
};

export default StealthEngine;
