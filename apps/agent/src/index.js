import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { planTask } from '@cherry/planner';
import { ArtifactStore } from '@cherry/artifacts';
import { AttachedBrowserController } from '@cherry/browser-attached';
import { ManagedBrowserController } from '@cherry/browser-managed';
import { CampaignEngine } from '@cherry/campaign-engine';
import { executeSkill } from '@cherry/platform-skills';

const backendUrl = process.env.CHERRY_BACKEND_URL || 'http://localhost:8787';
const backendWsUrl = backendUrl.replace(/^http/i, 'ws');
const agentRoot = path.join(os.homedir(), '.cherry-agent');
const configFile = path.join(agentRoot, 'agent.json');
fs.mkdirSync(agentRoot, { recursive: true });

const attachedBrowser = new AttachedBrowserController();
const managedBrowser = new ManagedBrowserController({ profileRoot: path.join(agentRoot, 'profiles') });
const artifacts = new ArtifactStore(path.join(agentRoot, 'artifacts'));
let lastBrowserAttachError = '';

function loadConfig() {
  if (!fs.existsSync(configFile)) return null;
  return JSON.parse(fs.readFileSync(configFile, 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
}

async function pairIfNeeded() {
  const pairingCode = process.env.CHERRY_PAIRING_CODE;
  const existing = loadConfig();

  if (!pairingCode && existing?.agentToken) {
    const response = await fetch(`${backendUrl}/agent/session/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: existing.agentId,
        agentToken: existing.agentToken,
        deviceName: os.hostname(),
        os: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
        agentVersion: '0.1.0',
      }),
    }).catch((error) => { throw new Error(`Failed to restore agent session: ${error.message}`); });
    if (!response.ok) throw new Error(`Failed to restore agent session: ${response.status}. Pair again from the web UI.`);
    return existing;
  }

  if (!pairingCode) {
    console.log('No agent pairing found. Set CHERRY_PAIRING_CODE to claim a device code from the web UI.');
    return null;
  }

  const response = await fetch(`${backendUrl}/agent/pairing/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: pairingCode,
      deviceName: os.hostname(),
      os: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
      agentVersion: '0.1.0',
    }),
  });

  if (!response.ok) throw new Error(`Failed to pair agent: ${response.status}`);
  const config = await response.json();
  saveConfig(config);
  return config;
}

async function runTask(task, socket) {
  const plan = planTask({
    taskId: task.id,
    prompt: task.prompt,
    context: task.context,
    preferredBrowserMode: task.preferredBrowserMode,
  });

  socket.send(JSON.stringify({ type: 'task.event', taskId: task.id, payload: { type: 'plan.generated', plan } }));

  const results = [];
  try {
    for (const step of plan.steps) {
      const stepStart = Date.now();
      console.log(`[TIME] Step ${step.id} starting: ${step.platform}:${step.action}`);
      socket.send(JSON.stringify({ type: 'task.event', taskId: task.id, payload: { type: 'step.started', stepId: step.id, label: `${step.platform}:${step.action}` } }));

      try {
        const result = await executeSkill({ step, attachedBrowser, managedBrowser });
        const stepDuration = Date.now() - stepStart;
        console.log(`[TIME] Step ${step.id} completed in ${stepDuration}ms`);
        results.push({ step, result, duration: stepDuration });
        socket.send(JSON.stringify({ type: 'task.event', taskId: task.id, payload: { type: 'step.progress', stepId: step.id, message: result.summary || 'Step complete', duration: stepDuration } }));
      } catch (error) {
        if (error.name === 'LoginWallError') {
          socket.send(JSON.stringify({ type: 'task.event', taskId: task.id, payload: { type: 'hitl.required', stepId: step.id, platform: error.platform, reason: 'login_wall', message: error.message } }));
          return;
        }
        socket.send(JSON.stringify({ type: 'task.event', taskId: task.id, payload: { type: 'step.failed', stepId: step.id, error: error.message, retrying: false } }));
        socket.send(JSON.stringify({ type: 'task.event', taskId: task.id, payload: { type: 'task.failed', error: error.message } }));
        return;
      }
    }

    const stateAndMemory = { scrapedLeads: [], profileSnapshots: [], messagesSent: [], followStatus: [], failures: [] };
    for (const { step, result } of results) {
      if (!result) continue;
      if (result.data?.profiles) stateAndMemory.scrapedLeads.push(...result.data.profiles);
      if (result.data?.page) stateAndMemory.profileSnapshots.push({ platform: step.platform, snapshot: result.data.page });
      if (step.action === 'send_message' || step.action === 'message_batch') stateAndMemory.messagesSent.push({ platform: step.platform, status: result.status });
      if (step.action === 'follow' || step.action === 'follow_user') stateAndMemory.followStatus.push({ platform: step.platform, status: result.status });
      if (result.status === 'failed') stateAndMemory.failures.push({ step: step.id, error: result.error });
    }

    const artifact = artifacts.writeJson({ plan, results, stateAndMemory }, 'task_result');
    socket.send(JSON.stringify({ type: 'task.event', taskId: task.id, payload: { type: 'artifact.ready', artifactId: artifact.artifactId, kind: artifact.kind, url: artifact.filePath } }));
    socket.send(JSON.stringify({ type: 'task.event', taskId: task.id, payload: { type: 'task.completed', summary: `Completed ${plan.steps.length} steps` } }));
  } finally {
    await managedBrowser.closeAll().catch(() => {});
    await publishAgentStatus(socket).catch(() => {});
  }
}

// ── Campaign runner ───────────────────────────────────────────────────────────
// POST a task to the backend for each campaign tick.
// The backend will then dispatch it back via task.dispatch.
async function runCampaignTick(campaign) {
  const platform = campaign.platforms?.[0] || 'instagram';
  const objective = campaign.contentPolicy?.outreachGoal || campaign.objective || 'Monitor inbox and auto-reply';
  try {
    const res = await fetch(`${backendUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `[Campaign: ${campaign.name}] ${objective}. Platform: ${platform}.`,
        context: {
          operation: 'get_context',
          platform,
          messageGoal: objective,
          tone: campaign.contentPolicy?.tone || 'Casual and brief',
          campaignId: campaign.id,
        },
        preferredBrowserMode: 'attached',
      }),
    });
    if (!res.ok) console.error(`[Campaign] Failed to queue tick for ${campaign.id}: ${res.status}`);
    else console.log(`[Campaign] Tick dispatched for "${campaign.name}" on ${platform}`);
  } catch (e) {
    console.error(`[Campaign] Tick error for ${campaign.id}:`, e.message);
  }
}

async function publishAgentStatus(socket) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  const browserStatus = await attachedBrowser.status().catch(() => ({ connected: false, tabs: [] }));
  socket.send(JSON.stringify({
    type: 'agent.status',
    payload: {
      browserAttached: Boolean(browserStatus.connected),
      connectionError: browserStatus.connected ? undefined : lastBrowserAttachError || undefined,
      profileDirectory: browserStatus.profileDirectory,
      tabs: Array.isArray(browserStatus.tabs) ? browserStatus.tabs.length : 0,
      mode: browserStatus.mode || 'cdp',
      extensionLoaded: Boolean(browserStatus.extensionLoaded),
    },
  }));
}

async function ensureAttachedBrowser() {
  try {
    await attachedBrowser.connect({ allowLaunch: true });
    lastBrowserAttachError = '';
    return true;
  } catch (error) {
    lastBrowserAttachError = error.message;
    return false;
  }
}

async function main() {
  const config = await pairIfNeeded();
  if (!config?.agentToken) return;

  const campaignEngine = new CampaignEngine({
    onEvent: (event) => console.log('[Campaign]', event.type, event.campaignId || '', event.status || ''),
  });
  console.log('Campaign engine ready', campaignEngine.listCampaigns().length);

  const socket = new WebSocket(`${backendWsUrl}/ws?role=agent&token=${encodeURIComponent(config.agentToken)}`);
  let statusInterval = null;

  socket.on('open', async () => {
    console.log('Cherry agent connected');
    const attached = await ensureAttachedBrowser();
    if (!attached) console.error('Cherry browser attach failed', lastBrowserAttachError);
    publishAgentStatus(socket).catch((error) => console.error('Failed to publish agent status', error.message));
    statusInterval = setInterval(() => { publishAgentStatus(socket).catch(() => {}); }, 15000);
  });

  socket.on('message', async (raw) => {
    const message = JSON.parse(String(raw));

    if (message.type === 'task.dispatch') {
      await runTask(message.task, socket);
    }

    // ── Campaign lifecycle messages ─────────────────────────────────────────
    if (message.type === 'campaign.dispatch') {
      const campaign = message.campaign;
      const cadenceSecs = (() => {
        const sched = campaign.schedules?.[0];
        if (!sched) return 300;
        return Math.round((sched.cadenceMinutes || 5) * 60);
      })();
      console.log(`[Campaign] Starting "${campaign.name}" — every ${cadenceSecs}s`);
      // Run first tick immediately, then on interval
      runCampaignTick(campaign).catch(() => {});
      campaignEngine.upsertCampaign({ ...campaign, status: 'active' });
      campaignEngine.startCampaign(campaign.id, () => runCampaignTick(campaign));
      // The campaignEngine uses cadenceMinutes — override with seconds-based interval
      // (campaignEngine.startCampaign already set it, but it uses cadenceMinutes*60*1000)
      // For sub-minute cadence, set our own interval
      if (cadenceSecs < 60) {
        const timer = setInterval(() => runCampaignTick(campaign), cadenceSecs * 1000);
        // Store so we can clear on stop
        campaignEngine.timers.set(campaign.id + '_override', timer);
      }
    }

    if (message.type === 'campaign.stop') {
      console.log(`[Campaign] Stopping ${message.campaignId}`);
      campaignEngine.stopCampaign(message.campaignId);
      const overrideTimer = campaignEngine.timers.get(message.campaignId + '_override');
      if (overrideTimer) { clearInterval(overrideTimer); campaignEngine.timers.delete(message.campaignId + '_override'); }
    }
  });

  socket.on('close', () => {
    if (statusInterval) clearInterval(statusInterval);
    console.log('Cherry agent disconnected');
  });
  socket.on('error', (error) => {
    console.error('Cherry agent socket error', error.message);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
