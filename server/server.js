const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_CODE = process.env.SECRET_CODE || 'cherry-secret-2024';

// Data storage
const DATA_FILE = path.join(__dirname, 'devices.json');
let devices = {};

// Load existing devices
function loadDevices() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      devices = JSON.parse(data);
      console.log(`Loaded ${Object.keys(devices).length} devices`);
    }
  } catch (e) {
    console.error('Error loading devices:', e);
    devices = {};
  }
}

// Save devices to file
function saveDevices() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(devices, null, 2));
  } catch (e) {
    console.error('Error saving devices:', e);
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Client endpoints
app.get('/api/status', (req, res) => {
  const { deviceId } = req.query;
  
  if (!deviceId) {
    return res.json({ status: 'unauthorized', message: 'No device ID' });
  }
  
  const device = devices[deviceId];
  
  if (!device) {
    return res.json({ status: 'pending_activation', message: 'Device not activated' });
  }
  
  if (device.revoked) {
    return res.json({ 
      status: 'revoked', 
      message: 'License revoked',
      action: 'uninstall'
    });
  }
  
  if (device.active) {
    // Update last seen
    device.lastSeen = new Date().toISOString();
    saveDevices();
    
    return res.json({ 
      status: 'active', 
      message: 'License valid',
      deviceInfo: {
        activatedAt: device.activatedAt,
        lastSeen: device.lastSeen
      }
    });
  }
  
  return res.json({ status: 'inactive', message: 'License inactive' });
});

app.post('/api/activate', (req, res) => {
  const { deviceId, code, deviceInfo } = req.body;
  
  if (!deviceId || !code) {
    return res.status(400).json({ success: false, message: 'Missing device ID or code' });
  }
  
  if (code !== SECRET_CODE) {
    return res.status(401).json({ success: false, message: 'Invalid activation code' });
  }
  
  // Check if device exists and is revoked
  if (devices[deviceId] && devices[deviceId].revoked) {
    return res.status(403).json({ success: false, message: 'Device has been revoked' });
  }
  
  // Activate device
  devices[deviceId] = {
    deviceId,
    active: true,
    revoked: false,
    activatedAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    deviceInfo: deviceInfo || {},
    ip: req.ip || req.connection.remoteAddress
  };
  
  saveDevices();
  
  console.log(`✅ Device activated: ${deviceId}`);
  res.json({ success: true, message: 'Device activated successfully' });
});

// Admin endpoints (protected by secret code)
app.get('/admin/devices', (req, res) => {
  const { code } = req.query;
  
  if (code !== SECRET_CODE) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const deviceList = Object.values(devices).map(d => ({
    deviceId: d.deviceId,
    active: d.active,
    revoked: d.revoked,
    activatedAt: d.activatedAt,
    lastSeen: d.lastSeen,
    deviceInfo: d.deviceInfo,
    ip: d.ip
  }));
  
  res.json({ devices: deviceList });
});

app.post('/admin/revoke', (req, res) => {
  const { code, deviceId } = req.body;
  
  if (code !== SECRET_CODE) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!deviceId || !devices[deviceId]) {
    return res.status(404).json({ error: 'Device not found' });
  }
  
  devices[deviceId].revoked = true;
  devices[deviceId].active = false;
  devices[deviceId].revokedAt = new Date().toISOString();
  
  saveDevices();
  
  console.log(`❌ Device revoked: ${deviceId}`);
  res.json({ success: true, message: 'Device revoked. Extension will be remotely uninstalled.' });
});

app.post('/admin/unrevoke', (req, res) => {
  const { code, deviceId } = req.body;
  
  if (code !== SECRET_CODE) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!deviceId || !devices[deviceId]) {
    return res.status(404).json({ error: 'Device not found' });
  }
  
  devices[deviceId].revoked = false;
  devices[deviceId].active = true;
  delete devices[deviceId].revokedAt;
  
  saveDevices();
  
  console.log(`✅ Device unrevoked: ${deviceId}`);
  res.json({ success: true, message: 'Device reactivated.' });
});

app.post('/admin/delete-all', (req, res) => {
  const { code } = req.body;
  
  if (code !== SECRET_CODE) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Revoke all devices
  let count = 0;
  for (const deviceId in devices) {
    devices[deviceId].revoked = true;
    devices[deviceId].active = false;
    devices[deviceId].revokedAt = new Date().toISOString();
    count++;
  }
  
  saveDevices();
  
  console.log(`❌ All ${count} devices revoked`);
  res.json({ success: true, message: `All ${count} devices revoked. Extensions will be remotely uninstalled.` });
});

// Simple admin dashboard HTML
app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Cherry AI License Admin</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #1a1a1a; color: #fff; padding: 20px; }
    h1 { color: #007AFF; }
    .card { background: #2a2a2a; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    input, button { padding: 10px; margin: 5px; border-radius: 4px; border: none; }
    input { background: #333; color: #fff; width: 300px; }
    button { background: #007AFF; color: #fff; cursor: pointer; }
    button.danger { background: #FF3B30; }
    button.success { background: #34C759; }
    .device { background: #333; padding: 15px; margin: 10px 0; border-radius: 6px; }
    .device.active { border-left: 4px solid #34C759; }
    .device.revoked { border-left: 4px solid #FF3B30; }
    .status { font-weight: bold; }
    .active { color: #34C759; }
    .revoked { color: #FF3B30; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h1>Cherry AI License Admin</h1>
  
  <div id="login" class="card">
    <h2>Enter Secret Code</h2>
    <input type="password" id="secretCode" placeholder="Secret code">
    <button onclick="login()">Access Dashboard</button>
  </div>
  
  <div id="dashboard" class="hidden">
    <div class="card">
      <h2>Device Management</h2>
      <p>Total devices: <span id="deviceCount">0</span></p>
      <button class="danger" onclick="deleteAll()">🗑️ REVOKE ALL DEVICES</button>
    </div>
    
    <div class="card">
      <h2>Connected Devices</h2>
      <div id="deviceList"></div>
    </div>
  </div>
  
  <script>
    let secretCode = '';
    
    async function login() {
      secretCode = document.getElementById('secretCode').value;
      const response = await fetch('/admin/devices?code=' + encodeURIComponent(secretCode));
      if (response.ok) {
        document.getElementById('login').classList.add('hidden');
        document.getElementById('dashboard').classList.remove('hidden');
        loadDevices();
      } else {
        alert('Invalid code');
      }
    }
    
    async function loadDevices() {
      const response = await fetch('/admin/devices?code=' + encodeURIComponent(secretCode));
      const data = await response.json();
      
      document.getElementById('deviceCount').textContent = data.devices.length;
      
      const list = document.getElementById('deviceList');
      list.innerHTML = '';
      
      data.devices.forEach(device => {
        const div = document.createElement('div');
        div.className = 'device ' + (device.revoked ? 'revoked' : 'active');
        div.innerHTML = \`
          <div><strong>\${device.deviceId.substring(0, 20)}...</strong></div>
          <div>Status: <span class="status \${device.revoked ? 'revoked' : 'active'}">\${device.revoked ? 'REVOKED' : 'ACTIVE'}</span></div>
          <div>Activated: \${new Date(device.activatedAt).toLocaleString()}</div>
          <div>Last seen: \${device.lastSeen ? new Date(device.lastSeen).toLocaleString() : 'Never'}</div>
          <div style="margin-top: 10px;">
            \${device.revoked 
              ? '<button class="success" onclick="unrevoke(\\'' + device.deviceId + '\\')">Reactivate</button>'
              : '<button class="danger" onclick="revoke(\\'' + device.deviceId + '\\')">Revoke</button>'
            }
          </div>
        \`;
        list.appendChild(div);
      });
    }
    
    async function revoke(deviceId) {
      if (!confirm('Revoke this device? Extension will be uninstalled remotely.')) return;
      
      await fetch('/admin/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: secretCode, deviceId })
      });
      
      loadDevices();
    }
    
    async function unrevoke(deviceId) {
      await fetch('/admin/unrevoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: secretCode, deviceId })
      });
      
      loadDevices();
    }
    
    async function deleteAll() {
      if (!confirm('⚠️ REVOKE ALL DEVICES?\n\nThis will remotely uninstall the extension from ALL customer computers.\n\nThis action cannot be undone!')) return;
      
      await fetch('/admin/delete-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: secretCode })
      });
      
      loadDevices();
      alert('All devices revoked');
    }
    
    // Auto-refresh every 10 seconds
    setInterval(() => {
      if (!document.getElementById('dashboard').classList.contains('hidden')) {
        loadDevices();
      }
    }, 10000);
  </script>
</body>
</html>
  `);
});

// Start server
loadDevices();
app.listen(PORT, () => {
  console.log('🔐 Cherry AI License Server');
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`🔑 Secret code: ${SECRET_CODE}`);
  console.log(`📊 Admin dashboard: http://localhost:${PORT}/admin`);
  console.log('');
  console.log('To change the secret code, set SECRET_CODE environment variable:');
  console.log(`  SECRET_CODE=your-secret-code node server.js`);
});
