const CDPController = {
  activeTabs: new Set(),

  async attach(tabId) {
    return new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, '1.3', () => {
        if (chrome.runtime.lastError) {
          console.error(`Failed to attach debugger to tab ${tabId}: ${chrome.runtime.lastError.message}`);
          return reject(chrome.runtime.lastError);
        }
        this.activeTabs.add(tabId);
        console.log(`Successfully attached to tab ${tabId}`);
        
        // Enable required domains
        Promise.all([
          this.sendCommand(tabId, 'Page.enable', {}),
          this.sendCommand(tabId, 'Runtime.enable', {}),
          this.sendCommand(tabId, 'Network.enable', {}),
          this.sendCommand(tabId, 'DOM.enable', {})
        ]).then(() => resolve())
          .catch(err => reject(err));
      });
    });
  },

  async detach(tabId) {
    return new Promise((resolve) => {
      chrome.debugger.detach({ tabId }, () => {
        this.activeTabs.delete(tabId);
        // Ignore errors on detach as they usually mean tab was closed
        resolve();
      });
    });
  },

  async sendCommand(tabId, method, commandParams = {}) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, commandParams, (result) => {
        if (chrome.runtime.lastError) {
          console.error(`${method} failed:`, chrome.runtime.lastError.message);
          return reject(chrome.runtime.lastError);
        }
        resolve(result);
      });
    });
  }
};

export default CDPController;
