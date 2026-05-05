// Cherry AI License Admin - Built-in License Server
// No npm dependencies - pure Chrome Extension API

const STORAGE_KEY = 'cherry_license_devices';
const CODES_KEY = 'cherry_license_codes';
const ACTIVITY_KEY = 'cherry_activity_log';

// Default license codes
let licenseCodes = {
  'cherry-admin-2024': { name: 'Default Code', created: Date.now(), uses: 0 },
  'cherry-vip-2024': { name: 'VIP Code', created: Date.now(), uses: 0 }
};

let devices = {};
let activityLog = [];

// Load data from storage
async function loadData() {
  const result = await chrome.storage.local.get([STORAGE_KEY, CODES_KEY, ACTIVITY_KEY]);
  devices = result[STORAGE_KEY] || {};
  if (result[CODES_KEY]) {
    licenseCodes = result[CODES_KEY];
  }
  activityLog = result[ACTIVITY_KEY] || [];
  console.log('[Cherry Admin] Loaded', Object.keys(devices).length, 'devices,', Object.keys(licenseCodes).length, 'codes');
}

// Save all data
async function saveData() {
  await chrome.storage.local.set({
    [STORAGE_KEY]: devices,
    [CODES_KEY]: licenseCodes,
    [ACTIVITY_KEY]: activityLog
  });
}

// Log activity
function logActivity(deviceId, action, details = {}) {
  const entry = {
    timestamp: Date.now(),
    deviceId,
    action,
    details
  };
  activityLog.unshift(entry);
  // Keep only last 1000 entries
  if (activityLog.length > 1000) activityLog = activityLog.slice(0, 1000);
  saveData();
  
  // Notify admin UI
  try {
    chrome.runtime.sendMessage({ 
      action: 'ACTIVITY_UPDATE', 
      entry 
    }).catch(() => {});
  } catch (e) {}
}

// Parse follower count string
function parseFollowers(followersStr) {
  if (!followersStr) return 0;
  const clean = followersStr.toLowerCase().replace(/,/g, '');
  if (clean.includes('m')) return parseFloat(clean) * 1000000;
  if (clean.includes('k')) return parseFloat(clean) * 1000;
  return parseInt(clean) || 0;
}

// Handle messages from client extensions
chrome.runtime.onConnectExternal.addListener((port) => {
  console.log('[Cherry Admin] External connection from:', port.sender?.origin);
  
  port.onMessage.addListener(async (msg) => {
    console.log('[Cherry Admin] Received:', msg.action);
    
    if (msg.action === 'CHECK_LICENSE') {
      const device = devices[msg.deviceId];
      
      if (!device) {
        port.postMessage({ status: 'pending_activation' });
      } else if (device.revoked) {
        port.postMessage({ 
          status: 'revoked', 
          action: 'uninstall',
          message: 'License revoked by administrator'
        });
      } else if (device.active) {
        device.lastSeen = Date.now();
        await saveData();
        port.postMessage({ 
          status: 'active',
          activatedAt: device.activatedAt
        });
      } else {
        port.postMessage({ status: 'inactive' });
      }
    }
    
    else if (msg.action === 'ACTIVATE') {
      // Check if code exists in licenseCodes
      const codeData = licenseCodes[msg.code];
      if (!codeData) {
        port.postMessage({ success: false, message: 'Invalid code' });
        return;
      }
      
      if (devices[msg.deviceId]?.revoked) {
        port.postMessage({ success: false, message: 'Device revoked' });
        return;
      }
      
      // Increment code usage
      codeData.uses = (codeData.uses || 0) + 1;
      codeData.lastUsed = Date.now();
      
      devices[msg.deviceId] = {
        deviceId: msg.deviceId,
        active: true,
        revoked: false,
        activatedAt: Date.now(),
        lastSeen: Date.now(),
        deviceInfo: msg.deviceInfo || {},
        activatedWithCode: msg.code
      };
      
      await saveData();
      console.log('[Cherry Admin] Activated device:', msg.deviceId, 'with code:', msg.code);
      
      // Log activity
      logActivity(msg.deviceId, 'ACTIVATED', { code: msg.code, deviceInfo: msg.deviceInfo });
      
      port.postMessage({ success: true, message: 'Activated with code: ' + codeData.name });
      
      // Notify admin UI if open
      notifyAdminUI();
    }
    
    else if (msg.action === 'LOG_ACTIVITY') {
      logActivity(msg.deviceId, msg.activityType, msg.details);
      port.postMessage({ success: true });
    }
  });
});

// Handle internal messages from admin UI
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_DEVICES') {
    const deviceList = Object.values(devices).map(d => ({
      ...d,
      activatedAt: d.activatedAt ? new Date(d.activatedAt).toLocaleString() : 'Unknown',
      lastSeen: d.lastSeen ? new Date(d.lastSeen).toLocaleString() : 'Never'
    }));
    sendResponse({ devices: deviceList, count: deviceList.length });
    return true;
  }
  
  if (request.action === 'REVOKE_DEVICE') {
    (async () => {
      if (devices[request.deviceId]) {
        devices[request.deviceId].revoked = true;
        devices[request.deviceId].active = false;
        devices[request.deviceId].revokedAt = Date.now();
        await saveData();
        logActivity(request.deviceId, 'REVOKED', {});
        console.log('[Cherry Admin] Revoked device:', request.deviceId);
      }
      sendResponse({ success: true });
    })();
    return true;
  }
  
  if (request.action === 'REVOKE_ALL') {
    (async () => {
      Object.keys(devices).forEach(id => {
        devices[id].revoked = true;
        devices[id].active = false;
        devices[id].revokedAt = Date.now();
      });
      await saveData();
      console.log('[Cherry Admin] Revoked ALL devices');
      sendResponse({ success: true, count: Object.keys(devices).length });
    })();
    return true;
  }
  
  if (request.action === 'UNREVOKE_DEVICE') {
    (async () => {
      if (devices[request.deviceId]) {
        devices[request.deviceId].revoked = false;
        devices[request.deviceId].active = true;
        delete devices[request.deviceId].revokedAt;
        await saveData();
        logActivity(request.deviceId, 'REACTIVATED', {});
        console.log('[Cherry Admin] Unrevoked device:', request.deviceId);
      }
      sendResponse({ success: true });
    })();
    return true;
  }
  
  if (request.action === 'GET_SECRET_CODES') {
    // Return all license codes with their info
    const codes = Object.entries(licenseCodes).map(([code, data]) => ({
      code,
      ...data,
      created: new Date(data.created).toLocaleString(),
      lastUsed: data.lastUsed ? new Date(data.lastUsed).toLocaleString() : 'Never'
    }));
    sendResponse({ codes });
    return true;
  }
  
  if (request.action === 'CREATE_CODE') {
    const { name } = request;
    const newCode = 'cherry-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString().slice(-4);
    licenseCodes[newCode] = {
      name: name || 'Unnamed Code',
      created: Date.now(),
      uses: 0
    };
    saveData();
    sendResponse({ success: true, code: newCode });
    return true;
  }
  
  if (request.action === 'DELETE_CODE') {
    if (licenseCodes[request.code]) {
      delete licenseCodes[request.code];
      saveData();
    }
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'GET_ACTIVITY_LOG') {
    // Get activity log with device filtering
    let filtered = activityLog;
    if (request.deviceId) {
      filtered = activityLog.filter(a => a.deviceId === request.deviceId);
    }
    // Limit to last 100 entries for UI
    const limited = filtered.slice(0, 100).map(a => ({
      ...a,
      timestamp: new Date(a.timestamp).toLocaleString()
    }));
    sendResponse({ activity: limited, total: activityLog.length });
    return true;
  }
});

// Notify admin UI of changes
function notifyAdminUI() {
  chrome.runtime.sendMessage({ action: 'DEVICES_UPDATED' }).catch(() => {});
}

// Open admin panel when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  const adminUrl = chrome.runtime.getURL('admin-panel.html');
  chrome.tabs.create({ url: adminUrl });
});

// Initialize
loadData();
console.log('[Cherry Admin] License server initialized');
