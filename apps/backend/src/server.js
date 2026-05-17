import express from 'express';
import cors from 'cors';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import {
  AgentClaimSchema,
  CampaignSchema,
  PairingCodeSchema,
  PLATFORM_SKILL_CAPABILITIES,
  TaskRequestSchema,
  WORKFLOW_PRESETS,
  WORKFLOW_TEMPLATES,
  createId,
  safeParse,
} from '@cherry/shared';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const stateFile = path.join(process.cwd(), '.cherry-backend-state.json');

const pairingCodes = new Map();
const agents = new Map();
const tasks = new Map();
const campaigns = new Map();
const webClients = new Set();

function loadState() {
  if (!fs.existsSync(stateFile)) {
    return;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    for (const agent of raw.agents || []) {
      agents.set(agent.id, { ...agent, online: false, socket: null, browserAttached: false, tabs: 0 });
    }
    for (const task of raw.tasks || []) {
      if (task.status === 'dispatched' || task.status === 'running') {
        task.status = 'queued';
        task.recoveredAt = new Date().toISOString();
        task.assignedAgentId = undefined;
      }
      tasks.set(task.id, task);
    }
    for (const campaign of raw.campaigns || []) {
      campaigns.set(campaign.id, campaign);
    }
    for (const pairing of raw.pairingCodes || []) {
      pairingCodes.set(pairing.code, pairing);
    }
  } catch (error) {
    console.error('Failed to load backend state', error.message);
  }
}

function persistState() {
  try {
    const serialized = {
      agents: [...agents.values()].map(({ socket, ...agent }) => ({ ...agent, online: false, socket: undefined })),
      tasks: [...tasks.values()],
      campaigns: [...campaigns.values()],
      pairingCodes: [...pairingCodes.values()],
    };
    fs.writeFileSync(stateFile, JSON.stringify(serialized, null, 2));
  } catch (error) {
    console.error('Failed to persist backend state', error.message);
  }
}

function agentPublicState(agent) {
  const { token, socket, ...rest } = agent;
  return rest;
}

function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const client of webClients) {
    if (client.readyState === 1) client.send(payload);
  }
}

function broadcastAgentStatus(agent) {
  const publicState = agentPublicState(agent);
  broadcast({
    type: 'agent.status',
    online: Boolean(publicState.online),
    browserAttached: publicState.browserAttached,
    connectionError: publicState.connectionError,
    profileDirectory: publicState.profileDirectory,
    tabs: publicState.tabs,
    mode: publicState.mode,
    extensionLoaded: publicState.extensionLoaded,
  });
}

function upsertTask(task) {
  tasks.set(task.id, task);
  persistState();
  return task;
}

function dispatchQueuedTasks(agent) {
  for (const task of tasks.values()) {
    if (task.status === 'queued' && agent.online && agent.socket?.readyState === 1) {
      agent.socket.send(JSON.stringify({ type: 'task.dispatch', task }));
      task.status = 'dispatched';
      task.assignedAgentId = agent.id;
      task.dispatchedAt = new Date().toISOString();
      persistState();
    }
  }
}

function requeueAgentTasks(agentId) {
  for (const task of tasks.values()) {
    if ((task.status === 'dispatched' || task.status === 'running') && task.assignedAgentId === agentId) {
      task.status = 'queued';
      task.assignedAgentId = undefined;
      task.recoveredAt = new Date().toISOString();
      task.events = task.events || [];
      task.events.push({ type: 'step.failed', stepId: 'agent_disconnect', error: 'Agent disconnected before this task completed', retrying: true });
    }
  }
  persistState();
}

loadState();

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    agents: agents.size,
    tasks: tasks.size,
    campaigns: campaigns.size,
  });
});

app.get('/skills', (_req, res) => {
  res.json({
    platforms: PLATFORM_SKILL_CAPABILITIES,
    workflows: WORKFLOW_TEMPLATES,
    presets: WORKFLOW_PRESETS,
  });
});

app.post('/agent/pairing/code', (_req, res) => {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const payload = PairingCodeSchema.parse({
    code,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  pairingCodes.set(code, payload);
  persistState();
  res.json(payload);
});

app.post('/agent/pairing/claim', (req, res) => {
  const claim = safeParse(AgentClaimSchema, req.body);
  const pairing = pairingCodes.get(claim.code);
  if (!pairing) {
    return res.status(404).json({ error: 'Pairing code not found' });
  }

  const agentId = createId('agent');
  const agentToken = createId('token');
  agents.set(agentId, {
    id: agentId,
    token: agentToken,
    deviceName: claim.deviceName,
    os: claim.os,
    agentVersion: claim.agentVersion,
    online: false,
  });
  pairingCodes.delete(claim.code);
  persistState();

  res.json({
    agentId,
    agentToken,
    websocketUrl: 'ws://localhost:8787/ws',
  });
});

app.post('/agent/session/restore', (req, res) => {
  const { agentId, agentToken, deviceName, os, agentVersion } = req.body || {};
  if (!agentId || !agentToken) {
    return res.status(400).json({ error: 'agentId and agentToken are required' });
  }

  const existing = agents.get(agentId);
  if (existing && existing.token !== agentToken) {
    return res.status(409).json({ error: 'Agent token mismatch' });
  }

  agents.set(agentId, {
    id: agentId,
    token: agentToken,
    deviceName: deviceName || existing?.deviceName || 'Cherry Agent',
    os: os || existing?.os || 'macos',
    agentVersion: agentVersion || existing?.agentVersion || '0.1.0',
    online: false,
    browserAttached: false,
    tabs: 0,
  });
  persistState();

  res.json({
    ok: true,
    agentId,
    websocketUrl: 'ws://localhost:8787/ws',
  });
});

app.get('/agents', (_req, res) => {
  res.json([...agents.values()].map(agentPublicState));
});

app.post('/tasks', (req, res) => {
  const input = safeParse(TaskRequestSchema, req.body);
  const task = upsertTask({
    id: createId('task'),
    status: 'queued',
    prompt: input.prompt,
    context: input.context || {},
    preferredBrowserMode: input.preferredBrowserMode,
    events: [{ type: 'task.created', taskId: createId('event'), prompt: input.prompt }],
    createdAt: new Date().toISOString(),
  });

  broadcast({ type: 'task.created', taskId: task.id, prompt: task.prompt });

  for (const agent of agents.values()) {
    if (agent.online && agent.socket?.readyState === 1) {
      agent.socket.send(JSON.stringify({ type: 'task.dispatch', task }));
      task.status = 'dispatched';
      task.assignedAgentId = agent.id;
      task.dispatchedAt = new Date().toISOString();
      persistState();
      break;
    }
  }

  res.status(201).json(task);
});

app.get('/tasks', (_req, res) => {
  res.json([...tasks.values()]);
});

app.get('/tasks/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.post('/campaigns', (req, res) => {
  const campaign = CampaignSchema.parse({
    id: createId('campaign'),
    ...req.body,
  });
  campaigns.set(campaign.id, campaign);
  persistState();
  broadcast({ type: 'campaign.updated', campaignId: campaign.id, status: campaign.status });
  res.status(201).json(campaign);
});

app.patch('/campaigns/:id', (req, res) => {
  const existing = campaigns.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Campaign not found' });
  const campaign = CampaignSchema.parse({
    ...existing,
    ...req.body,
    id: existing.id,
  });
  campaigns.set(campaign.id, campaign);
  persistState();
  broadcast({ type: 'campaign.updated', campaignId: campaign.id, status: campaign.status });
  res.json(campaign);
});

app.get('/campaigns', (_req, res) => {
  res.json([...campaigns.values()]);
});

// Contact Metrics API
const contactMetricsCache = new Map();

function emptyContactMetrics() {
  return {
    summary: {
      totalContacts: 0,
      totalPlatforms: 0,
      lastUpdated: Date.now(),
    },
    categories: {
      leads: 0,
      partners: 0,
      candidates: 0,
      customers: 0,
      network: 0,
      audience: 0,
      unknown: 0,
    },
    platforms: [
      { name: 'whatsapp', total: 0, connections: 0, pending: 0 },
      { name: 'linkedin', total: 0, connections: 0, pending: 0 },
      { name: 'instagram', total: 0, followers: 0, pending: 0 },
      { name: 'twitter', total: 0, connections: 0, pending: 0 },
      { name: 'facebook', total: 0, connections: 0, pending: 0 },
      { name: 'gmail', total: 0, connections: 0, pending: 0 },
      { name: 'youtube', total: 0, connections: 0, pending: 0 },
    ],
    recentActivity: [],
    sentiment: { positive: 0, neutral: 0, negative: 0 },
    status: 'pending_initial_sync',
    message: 'Run "map_contacts" action on any platform to sync contact data',
  };
}

function normalizeMetricNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function mergeContactMetrics(existing, incoming) {
  const base = existing || emptyContactMetrics();
  const next = {
    ...base,
    summary: { ...base.summary },
    categories: { ...base.categories },
    sentiment: { ...base.sentiment },
    platforms: [...(base.platforms || [])],
    recentActivity: [...(base.recentActivity || [])],
  };

  const incomingCategories = incoming.categories || {};
  if (Array.isArray(incomingCategories)) {
    for (const category of incomingCategories) {
      next.categories[category.name] = normalizeMetricNumber(category.count);
    }
  } else {
    for (const [key, value] of Object.entries(incomingCategories)) {
      next.categories[key] = normalizeMetricNumber(value);
    }
  }

  const platformMap = new Map(next.platforms.map((platform) => [platform.name, platform]));
  for (const platform of incoming.platforms || []) {
    platformMap.set(platform.name, {
      ...(platformMap.get(platform.name) || {}),
      ...platform,
      total: normalizeMetricNumber(platform.total),
      connections: normalizeMetricNumber(platform.connections),
      pending: normalizeMetricNumber(platform.pending),
    });
  }
  next.platforms = [...platformMap.values()];

  const activityMap = new Map(next.recentActivity.map((item) => [item.id || `${item.platform}:${item.name}:${item.lastMessageAt}`, item]));
  for (const item of incoming.recentActivity || []) {
    activityMap.set(item.id || `${item.platform}:${item.name}:${item.lastMessageAt}`, item);
  }
  next.recentActivity = [...activityMap.values()]
    .sort((left, right) => normalizeMetricNumber(right.lastMessageAt) - normalizeMetricNumber(left.lastMessageAt))
    .slice(0, 50);

  next.sentiment = {
    positive: normalizeMetricNumber(incoming.sentiment?.positive ?? next.sentiment.positive),
    neutral: normalizeMetricNumber(incoming.sentiment?.neutral ?? next.sentiment.neutral),
    negative: normalizeMetricNumber(incoming.sentiment?.negative ?? next.sentiment.negative),
  };

  next.summary = {
    totalContacts: next.platforms.reduce((sum, platform) => sum + normalizeMetricNumber(platform.total), 0),
    totalPlatforms: next.platforms.filter((platform) => normalizeMetricNumber(platform.total) > 0 || platform.error).length,
    lastUpdated: incoming.summary?.lastUpdated || Date.now(),
  };
  next.status = next.summary.totalContacts > 0 ? 'ready' : 'pending_initial_sync';
  next.message = next.summary.totalContacts > 0
    ? 'Contact intelligence synced from agent results'
    : base.message || 'Run "map_contacts" action on any platform to sync contact data';

  return next;
}

function ingestContactMetrics(stepData) {
  const incoming = stepData?.dashboardData || stepData?.metrics;
  if (!incoming) return null;
  const current = contactMetricsCache.get('data')?.data || emptyContactMetrics();
  const merged = mergeContactMetrics(current, incoming);
  contactMetricsCache.set('data', { data: merged, timestamp: Date.now() });
  broadcast({ type: 'contact.metrics.updated', metrics: merged });
  return merged;
}

app.get('/metrics/contacts', async (_req, res) => {
  try {
    // Return cached data if available and fresh (< 5 minutes)
    const cached = contactMetricsCache.get('data');
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return res.json(cached.data);
    }

    const metrics = emptyContactMetrics();

    contactMetricsCache.set('data', { data: metrics, timestamp: Date.now() });
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/metrics/contacts/refresh', async (req, res) => {
  const { platform } = req.body || {};
  
  try {
    // Clear cache to force refresh
    contactMetricsCache.delete('data');
    
    // In production, this would trigger the agent to run map_contacts
    res.json({ 
      status: 'refresh_requested',
      platform: platform || 'all',
      message: `Refresh requested for ${platform || 'all platforms'}. Run map_contacts action to update.`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

wss.on('connection', (socket, req) => {
  const url = new URL(req.url, 'http://localhost:8787');
  const role = url.searchParams.get('role');
  const token = url.searchParams.get('token');

  if (role === 'web') {
    webClients.add(socket);
    const liveAgent = [...agents.values()].find((agent) => agent.online) || [...agents.values()][0];
    socket.send(JSON.stringify(liveAgent ? {
      type: 'agent.status',
      online: Boolean(liveAgent.online),
      browserAttached: liveAgent.browserAttached,
      connectionError: liveAgent.connectionError,
      profileDirectory: liveAgent.profileDirectory,
      tabs: liveAgent.tabs,
      mode: liveAgent.mode,
      extensionLoaded: liveAgent.extensionLoaded,
    } : { type: 'agent.status', online: false }));
    socket.on('close', () => webClients.delete(socket));
    return;
  }

  const agent = [...agents.values()].find((candidate) => candidate.token === token);
  if (!agent) {
    socket.close(1008, 'Unknown agent');
    return;
  }

  agent.socket = socket;
  agent.online = true;
  persistState();
  broadcastAgentStatus(agent);
  dispatchQueuedTasks(agent);

  socket.on('message', (raw) => {
    const event = JSON.parse(String(raw));
    if (event.type === 'agent.status') {
      agent.browserAttached = event.payload?.browserAttached;
      agent.connectionError = event.payload?.connectionError;
      agent.profileDirectory = event.payload?.profileDirectory;
      agent.tabs = event.payload?.tabs;
      agent.mode = event.payload?.mode;
      agent.extensionLoaded = event.payload?.extensionLoaded;
      persistState();
      broadcastAgentStatus(agent);
      return;
    }
    if (event.type === 'task.event' && event.taskId) {
      const task = tasks.get(event.taskId);
      if (task) {
        task.events.push(event.payload);
        if (event.payload.type === 'step.progress') {
          ingestContactMetrics(event.payload.data);
        }
        if (event.payload.type === 'step.started') task.status = 'running';
        if (event.payload.type === 'task.completed') task.status = 'completed';
        if (event.payload.type === 'task.failed') task.status = 'failed';
        if (event.payload.type === 'step.failed' && event.payload.retrying) task.status = 'retrying';
        persistState();
      }
      broadcast(event.payload);
    }
  });

  socket.on('close', () => {
    requeueAgentTasks(agent.id);
    agent.online = false;
    agent.socket = null;
    agent.browserAttached = false;
    agent.tabs = 0;
    persistState();
    broadcastAgentStatus(agent);
  });
});

// Dialogue system routes
import { setupDialogueRoutes } from './dialogue.js';
setupDialogueRoutes(app);

server.listen(8787, () => {
  console.log('Cherry backend listening on http://localhost:8787');
});
