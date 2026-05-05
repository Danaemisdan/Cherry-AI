const ADMIN_EXTENSION_ID = 'cherry-ai-license-admin'; // Extension ID will be set after first connection
const CHECK_INTERVAL = 30000; // Check every 30 seconds
const DEFAULT_SERVER_URL = 'http://localhost:8080';

class LicenseManager {
  constructor() {
    this.deviceId = null;
    this.isActive = false;
    this.checkInterval = null;
    this.serverUrl = null;
  }

  // Find the admin extension by trying to connect
  async findAdminExtension() {
    // Check if admin ID is stored
    const result = await chrome.storage.local.get(['cherry_admin_extension_id']);
    if (result.cherry_admin_extension_id) {
      this.adminExtensionId = result.cherry_admin_extension_id;
      console.log('[Cherry License] Using stored admin ID:', this.adminExtensionId);
      return;
    }
    
    // Try to get all extensions and find Cherry AI Admin
    try {
      const extensions = await chrome.management.getAll();
      console.log('[Cherry License] Found', extensions.length, 'extensions');
      
      for (const ext of extensions) {
        if (ext.name && ext.name.includes('Cherry') && ext.name.includes('Admin')) {
          this.adminExtensionId = ext.id;
          await chrome.storage.local.set({ cherry_admin_extension_id: ext.id });
          console.log('[Cherry License] Found admin extension via management API:', ext.id);
          return;
        }
      }
    } catch (e) {
      console.log('[Cherry License] Management API failed:', e.message);
    }
    
    console.log('[Cherry License] Admin extension not found. Make sure Cherry AI License Admin is installed.');
  }

  // Generate or retrieve unique device ID
  async getDeviceId() {
    if (this.deviceId) return this.deviceId;
    
    const result = await chrome.storage.local.get(['cherry_device_id']);
    if (result.cherry_device_id) {
      this.deviceId = result.cherry_device_id;
      return this.deviceId;
    }
    
    // Generate new device ID
    this.deviceId = 'cherry_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
    await chrome.storage.local.set({ cherry_device_id: this.deviceId });
    return this.deviceId;
  }

  // HTTP API call to license server
  async apiCall(endpoint, method = 'GET', body = null) {
    const serverUrl = await this.getServerUrl();
    const url = `${serverUrl}${endpoint}`;
    
    try {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
      };
      if (body) {
        options.body = JSON.stringify(body);
      }
      
      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (e) {
      console.log('[Cherry License] API error:', e.message);
      return { error: e.message };
    }
  }

  // Check license status with admin extension
  async checkStatus() {
    const deviceId = await this.getDeviceId();
    const response = await this.apiCall(`/check?device_id=${encodeURIComponent(deviceId)}`);
    
    if (response.error) {
      console.log('[Cherry License] Error:', response.error);
      this.isActive = false;
      return 'offline';
    }
    
    console.log('[Cherry License] Status:', response.status);
    
    if (response.status === 'revoked' && response.action === 'uninstall') {
      console.log('[Cherry License] License revoked - uninstalling...');
      await this.remoteUninstall();
      return 'revoked';
    }
    
    if (response.status === 'active') {
      this.isActive = true;
      await chrome.storage.local.set({ cherry_activated: true });
      return 'active';
    }
    
    this.isActive = false;
    return response.status;
  }

  // Activate with secret code
  async activate(code) {
    console.log('[Cherry License] Starting activation...');
    const deviceId = await this.getDeviceId();
    console.log('[Cherry License] Device ID:', deviceId);
    
    const deviceInfo = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language
    };
    
    console.log('[Cherry License] Connecting to server for activation...');
    const response = await this.apiCall('/activate', 'POST', { 
      device_id: deviceId, 
      code, 
      device_info: deviceInfo 
    });
    console.log('[Cherry License] Server response:', response);
    
    if (response.error) {
      return { success: false, message: response.error };
    }
    
    if (response.success) {
      this.isActive = true;
      await chrome.storage.local.set({ cherry_activated: true });
      this.startChecking();
      return { success: true, message: response.message };
    }
    
    return { success: false, message: response.message || 'Activation failed' };
  }

  // Remote uninstall - triggered when license is revoked
  async remoteUninstall() {
    console.log('[Cherry License] Remote uninstall triggered');
    
    try {
      await chrome.storage.local.clear();
      await chrome.management.uninstallSelf({ showConfirmDialog: false });
    } catch (e) {
      console.error('[Cherry License] Uninstall failed:', e);
      await chrome.storage.local.set({ cherry_revoked: true });
    }
  }

  // Start periodic license checking
  startChecking() {
    if (this.checkInterval) return;
    
    console.log('[Cherry License] Starting periodic checks');
    
    this.checkInterval = setInterval(async () => {
      const status = await this.checkStatus();
      
      if (status === 'revoked') {
        this.stopChecking();
      }
    }, CHECK_INTERVAL);
  }

  // Stop checking
  stopChecking() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // Check if extension is allowed to run
  async isAllowed() {
    const result = await chrome.storage.local.get(['cherry_revoked']);
    if (result.cherry_revoked) {
      return false;
    }
    
    const status = await this.checkStatus();
    return status === 'active';
  }

  // Set server URL
  async setServerUrl(url) {
    this.serverUrl = url;
    await chrome.storage.local.set({ cherry_server_url: url });
  }
  
  // Report activity to admin extension
  async reportActivity(activityType, details = {}) {
    const deviceId = await this.getDeviceId();
    const response = await this.apiCall('/report', 'POST', { 
      device_id: deviceId, 
      action: activityType, 
      details 
    });
    return response;
  }
}

const licenseManager = new LicenseManager();
export default licenseManager;
