// Wrap Chrome storage to provide an encrypted abstraction layer

// Fallback/Mock for local testing when chrome.storage isn't available
const mockStorage = new Map();

export const StorageArea = {
  async get(keys) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        chrome.storage.local.get(keys, (items) => {
          resolve(items);
        });
      });
    }
    
    // Fallback for dev mode outside extension
    const result = {};
    if (Array.isArray(keys)) {
      keys.forEach(k => {
        if (mockStorage.has(k)) result[k] = mockStorage.get(k);
      });
    } else if (typeof keys === 'string') {
      if (mockStorage.has(keys)) result[keys] = mockStorage.get(keys);
    }
    return result;
  },

  async set(items) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        chrome.storage.local.set(items, () => {
          resolve();
        });
      });
    }
    
    // Fallback
    Object.entries(items).forEach(([k, v]) => {
      mockStorage.set(k, v);
    });
    return Promise.resolve();
  }
};

// Simplified state persistence wrapper (full AES implementation will be injected during the build step as part of Phase 5)
export const StateStore = {
  async loadSettings() {
    const data = await StorageArea.get(['cherry_settings']);
    return data.cherry_settings || {
      minProfileDelay: 5,
      maxProfileDelay: 25,
      minPageDelay: 10,
      maxPageDelay: 45
    };
  },

  async saveSettings(settings) {
    await StorageArea.set({ cherry_settings: settings });
  }
};
