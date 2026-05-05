// Cherry AI License Admin Panel - External JS (CSP compliant)
// Connects to local HTTP server on port 8081

const ADMIN_API_URL = 'http://localhost:8081';

let devices = [];
let codes = [];
let activity = [];

// Tab switching
function showTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById(tab + '-tab').classList.add('active');
}

async function apiCall(endpoint, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) options.body = JSON.stringify(body);
    
    const response = await fetch(`${ADMIN_API_URL}${endpoint}`, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error('API error:', err);
    return { error: err.message };
  }
}

async function loadAllData() {
  await Promise.all([loadCodes(), loadDevices(), loadActivity()]);
}

async function loadCodes() {
  try {
    const result = await apiCall('/admin/codes');
    if (result.error) throw new Error(result.error);
    
    // Convert object to array
    codes = Object.entries(result.codes || {}).map(([code, data]) => ({
      code,
      name: data.name || 'Generated Code',
      uses: data.uses || 0,
      created: new Date(data.created).toLocaleDateString(),
      lastUsed: data.lastUsed || 'Never'
    }));
    
    const list = document.getElementById('codesList');
    if (codes.length === 0) {
      list.innerHTML = '<div class="empty-state">No license codes yet. Click "Generate New Code" above.</div>';
      return;
    }
    
    list.innerHTML = codes.map(c => `
      <div class="code-item">
        <div class="code-info">
          <div class="code-text">${c.code}</div>
          <div class="code-meta">
            ${c.name} • Used ${c.uses || 0} times • Created ${c.created}
            ${c.lastUsed !== 'Never' ? `• Last used ${c.lastUsed}` : ''}
          </div>
        </div>
        <div class="code-actions">
          <button class="btn-secondary" data-action="copy" data-code="${c.code}">Copy</button>
          <button class="btn-danger" data-action="delete" data-code="${c.code}">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading codes:', err);
    document.getElementById('codesList').innerHTML = '<div class="empty-state">Error: Make sure license server is running. ' + err.message + '</div>';
  }
}

async function loadDevices() {
  try {
    const result = await apiCall('/admin/devices');
    if (result.error) throw new Error(result.error);
    
    // Convert object to array
    devices = Object.entries(result.devices || {}).map(([deviceId, data]) => ({
      deviceId,
      revoked: data.status === 'revoked',
      activatedWithCode: data.code || 'N/A',
      activatedAt: data.activated_at ? new Date(data.activated_at * 1000).toLocaleDateString() : 'N/A'
    }));
    
    document.getElementById('totalCount').textContent = devices.length;
    document.getElementById('activeCount').textContent = devices.filter(d => !d.revoked).length;
    document.getElementById('revokedCount').textContent = devices.filter(d => d.revoked).length;
    
    const list = document.getElementById('deviceList');
    if (devices.length === 0) {
      list.innerHTML = '<div class="empty-state">No devices activated yet</div>';
      return;
    }
    
    list.innerHTML = devices.map(device => `
      <div class="device ${device.revoked ? 'revoked' : ''}">
        <div class="device-info">
          <div class="device-id">${device.deviceId.substring(0, 25)}...</div>
          <div class="device-meta">
            ${device.revoked 
              ? `Revoked • Code: ${device.activatedWithCode || 'N/A'}`
              : `Active • ${device.activatedAt} • Code: ${device.activatedWithCode || 'N/A'}`
            }
          </div>
        </div>
        <div class="device-actions">
          ${device.revoked
            ? `<button class="btn-success" data-action="restore" data-device="${device.deviceId}">Restore</button>`
            : `<button class="btn-danger" data-action="revoke" data-device="${device.deviceId}">Revoke</button>`
          }
          <button class="btn-secondary" data-action="view-activity" data-device="${device.deviceId}">Activity</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading devices:', err);
    document.getElementById('deviceList').innerHTML = '<div class="empty-state">Error: Make sure license server is running. ' + err.message + '</div>';
  }
}

async function loadActivity() {
  try {
    const result = await apiCall('/admin/activity');
    if (result.error) throw new Error(result.error);
    activity = result.activity || [];
    
    const list = document.getElementById('activityList');
    if (activity.length === 0) {
      list.innerHTML = '<div class="empty-state">No activity recorded yet</div>';
      return;
    }
    
    list.innerHTML = activity.map(a => `
      <div class="activity-item">
        <div class="activity-info">
          <div>
            <span class="activity-type activity-${a.action.toLowerCase()}">${a.action}</span>
            <span style="color: #888; margin-left: 10px;">${new Date(a.timestamp * 1000).toLocaleString()}</span>
          </div>
          <div class="activity-meta" style="margin-top: 5px;">
            Device: ${a.device_id ? a.device_id.substring(0, 20) : 'Unknown'}...
            ${a.details ? `• ${JSON.stringify(a.details)}` : ''}
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading activity:', err);
    document.getElementById('activityList').innerHTML = '<div class="empty-state">Error: Make sure license server is running.</div>';
  }
}

async function createCode() {
  const name = document.getElementById('newCodeName').value.trim();
  if (!name) {
    alert('Please enter a name for this code');
    return;
  }
  
  const result = await apiCall('/admin/generate', 'POST');
  
  if (result.success) {
    document.getElementById('newCodeName').value = '';
    alert('New code created: ' + result.code);
    loadCodes();
  } else {
    alert('Error creating code: ' + (result.error || 'Unknown error'));
  }
}

async function deleteCode(code) {
  if (!confirm('Delete this code? Existing activations will remain active.')) return;
  
  await apiCall('/admin/delete-code', 'POST', { code });
  
  loadCodes();
}

async function revoke(deviceId) {
  if (!confirm('Revoke this device? The extension will be remotely uninstalled.')) return;
  
  await apiCall('/admin/revoke', 'POST', { device_id: deviceId });
  
  loadDevices();
  loadActivity();
}

async function unrevoke(deviceId) {
  await apiCall('/admin/unrevoke', 'POST', { device_id: deviceId });
  
  loadDevices();
  loadActivity();
}

async function revokeAll() {
  if (!confirm('⚠️ REVOKE ALL DEVICES?\n\nThis will remotely uninstall the extension from ALL customer computers.\n\nThis action cannot be undone!')) return;
  
  for (const device of devices.filter(d => !d.revoked)) {
    await apiCall('/admin/revoke', 'POST', { device_id: device.deviceId });
  }
  
  alert(`All devices revoked`);
  loadDevices();
  loadActivity();
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
  alert('Copied: ' + text);
}

function viewDeviceActivity(deviceId) {
  showTab('activity');
}

// Event delegation for dynamic elements
document.addEventListener('click', (e) => {
  const target = e.target;
  
  // Tab buttons
  if (target.classList.contains('tab')) {
    const tab = target.dataset.tab;
    if (tab) showTab(tab);
  }
  
  // Generate code button
  if (target.id === 'generateCodeBtn') {
    createCode();
  }
  
  // Revoke all button
  if (target.id === 'revokeAllBtn') {
    revokeAll();
  }
  
  // Copy code button
  if (target.dataset.action === 'copy') {
    copyToClipboard(target.dataset.code);
  }
  
  // Delete code button
  if (target.dataset.action === 'delete') {
    deleteCode(target.dataset.code);
  }
  
  // Revoke device button
  if (target.dataset.action === 'revoke') {
    revoke(target.dataset.device);
  }
  
  // Restore device button
  if (target.dataset.action === 'restore') {
    unrevoke(target.dataset.device);
  }
  
  // View activity button
  if (target.dataset.action === 'view-activity') {
    viewDeviceActivity(target.dataset.device);
  }
});

// Listen for updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'DEVICES_UPDATED' || msg.action === 'ACTIVITY_UPDATE') {
    loadAllData();
  }
});

// Auto-refresh every 5 seconds
setInterval(loadAllData, 5000);

// Initial load
document.addEventListener('DOMContentLoaded', () => {
  loadAllData();
});
