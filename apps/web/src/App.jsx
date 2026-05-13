import { useEffect, useMemo, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { PLATFORM_SKILL_CAPABILITIES, WORKFLOW_PRESETS } from '@cherry/shared';
import { 
  Search, 
  Zap, 
  Plus, 
  Mic, 
  ArrowUp, 
  Paperclip,
  ChevronDown,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Copy,
  Share,
  Globe,
  Lightbulb
} from 'lucide-react';
import { IntegrationShowcase } from './components/ui/IntegrationShowcase';
import { AdvancedAIChatInput } from './components/ui/AdvancedAIChatInput';
// Simple inline logo to avoid 3.5MB SVG parse issue
const Logo = () => (
  <svg viewBox="0 0 200 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-10 w-auto">
    <circle cx="20" cy="20" r="18" fill="#dc2626"/>
    <text x="45" y="28" fill="white" fontSize="24" fontWeight="bold" fontFamily="system-ui">Cherry</text>
  </svg>
);

const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8787';
const backendWsUrl = backendUrl.replace(/^http/i, 'ws');

const platformMeta = [
  { id: 'instagram', label: 'Instagram', short: 'IG', icon: InstagramIcon, defaultQuery: 'founders in fintech', description: 'Direct outreach and scraping via attached session.' },
  { id: 'twitter', label: 'X', short: 'X', icon: XIcon, defaultQuery: 'fintech founders', description: 'Automate mentions and DMs on the X platform.' },
  { id: 'linkedin', label: 'LinkedIn', short: 'in', icon: LinkedinIcon, defaultQuery: 'fintech founders india', description: 'Professional B2B lead generation and outreach.' },
  { id: 'facebook', label: 'Facebook', short: 'f', icon: FacebookIcon, defaultQuery: 'saas founders', description: 'Group engagement and lead prospecting.' },
  { id: 'gmail', label: 'Gmail', short: 'M', icon: GmailIcon, defaultQuery: 'warm follow up', description: 'Automated follow-ups and inbox monitoring.' },
  { id: 'whatsapp', label: 'WhatsApp', short: 'WA', icon: WhatsAppIcon, defaultQuery: 'customer follow up', description: 'One-to-one chat automation in a logged-in WhatsApp Web session.' },
  { id: 'chatgpt', label: 'ChatGPT', short: 'GPT', icon: ChatGPTIcon, defaultQuery: 'A cinematic landscape', description: 'Generate images via ChatGPT.' },
  { id: 'gemini', label: 'Gemini', short: 'G', icon: GeminiIcon, defaultQuery: 'A futuristic city', description: 'Generate images via Gemini.' },
  { id: 'research', label: 'Research', short: 'R', icon: SearchIcon, defaultQuery: 'best fintech founders in india', description: 'Deep research using managed stealth browser.' },
];

const defaultCampaignPlatforms = ['instagram', 'twitter', 'linkedin', 'gmail', 'whatsapp', 'research', 'chatgpt', 'gemini'];

function usePlatformData() {
  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [agentOnline, setAgentOnline] = useState(false);
  const [agentState, setAgentState] = useState(null);
  const [contactMetrics, setContactMetrics] = useState(null);

  async function refreshTasks() {
    const response = await fetch(`${backendUrl}/tasks`);
    const payload = await response.json();
    setTasks(payload.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)));
  }

  async function refreshCampaigns() {
    const response = await fetch(`${backendUrl}/campaigns`);
    const payload = await response.json();
    setCampaigns(payload.reverse());
  }

  async function refreshAgents() {
    const response = await fetch(`${backendUrl}/agents`);
    const payload = await response.json();
    const current = payload.find((agent) => agent.online) || payload[0] || null;
    setAgentState(current);
    setAgentOnline(Boolean(current?.online));
  }

  async function refreshContactMetrics() {
    try {
      const response = await fetch(`${backendUrl}/metrics/contacts`);
      const payload = await response.json();
      setContactMetrics(payload);
    } catch {
      // Silently fail - metrics not critical
    }
  }

  useEffect(() => {
    refreshTasks().catch(() => {});
    refreshCampaigns().catch(() => {});
    refreshAgents().catch(() => {});
    refreshContactMetrics().catch(() => {});

    const socket = new WebSocket(`${backendWsUrl}/ws?role=web`);
    socket.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'agent.status') {
        setAgentOnline(Boolean(payload.online));
        setAgentState((current) => ({ ...(current || {}), ...payload }));
      }
      setEvents((current) => [payload, ...current].slice(0, 80));
      refreshTasks().catch(() => {});
      if (payload.type === 'campaign.updated') {
        refreshCampaigns().catch(() => {});
      }
    };

    const interval = window.setInterval(() => {
      refreshTasks().catch(() => {});
      refreshCampaigns().catch(() => {});
      refreshAgents().catch(() => {});
      refreshContactMetrics().catch(() => {});
    }, 4000);

    return () => {
      socket.close();
      window.clearInterval(interval);
    };
  }, []);

  return {
    agentState,
    agentOnline,
    campaigns,
    contactMetrics,
    events,
    refreshAgents,
    refreshCampaigns,
    refreshContactMetrics,
    refreshTasks,
    tasks,
  };
}

function Shell({ agentOnline, agentState, children }) {
  const browserAttached = Boolean(agentState?.browserAttached);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand flex items-center justify-start px-4">
          <Logo />
        </div>

        <div className="sidebar-card mt-6">
          <span className="sidebar-label">Agent bridge</span>
          <strong>
            {!agentOnline ? 'Awaiting local runtime' : browserAttached ? 'Attached runtime online' : 'Runtime online, browser unattached'}
          </strong>
          <p>
            {agentState?.profileDirectory
              ? `Profile ${agentState.profileDirectory}${agentState?.browserAttached ? ` • ${agentState.tabs || 0} tabs visible` : ' • browser not attached'}`
              : 'Chrome CDP / extension bridge status will appear here.'}
          </p>
          {agentState?.connectionError ? <p>{agentState.connectionError}</p> : null}
        </div>

        <nav className="mt-8">
          <NavLink to="/">Workspace</NavLink>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/campaigns">Campaigns</NavLink>
          <NavLink to="/pairing">Pairing</NavLink>
          <NavLink to="/history">History</NavLink>
        </nav>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}

function DialogueBox({ dialogue, onSelect, selectedPlatforms }) {
  if (!dialogue) return null;
  const isPlatformSelection = dialogue.type === 'platform_selection';
  return (
    <div className="bg-zinc-900/80 border border-zinc-700 rounded-2xl p-6 mt-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <p className="text-white font-medium mb-4">{dialogue.message}</p>
      <div className="flex flex-wrap gap-2">
        {dialogue.options?.map((option) => {
          const isSelected = isPlatformSelection && selectedPlatforms?.includes(option.id);
          return (
            <button
              key={option.id}
              onClick={() => onSelect(option, isPlatformSelection)}
              className={`px-4 py-2 rounded-xl font-medium text-sm transition-all ${
                isSelected ? 'bg-red-500 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {isPlatformSelection && dialogue.continueAction && selectedPlatforms?.length > 0 && (
        <button
          onClick={() => onSelect({ action: 'confirm_platforms', data: { platforms: selectedPlatforms } }, false)}
          className="mt-4 px-6 py-2 bg-white text-black rounded-xl font-bold text-sm hover:bg-zinc-200 transition-all"
        >
          {dialogue.continueAction.label}
        </button>
      )}
    </div>
  );
}

function Workspace({ refreshTasks, tasks }) {
  const [prompt, setPrompt] = useState('');
  const [dialogue, setDialogue] = useState(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [selectedPlatform, setSelectedPlatform] = useState('instagram');
  const [query, setQuery] = useState('fintech founders');
  const [username] = useState('');
  const [batchUsernames] = useState('');
  const [goal, setGoal] = useState('Get a meeting');
  const [tone, setTone] = useState('Casual and brief');
  const [attachmentPath, setAttachmentPath] = useState('');
  const [targetUsername, setTargetUsername] = useState('');
  const [maxResults, setMaxResults] = useState(15);
  const [submitting, setSubmitting] = useState(false);
  const [automationMode, setAutomationMode] = useState('auto');

  // Gmail-specific fields
  const [emailSubject, setEmailSubject] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailBcc, setEmailBcc] = useState('');
  const [emailSignature, setEmailSignature] = useState('');
  const [gmailSearchQuery, setGmailSearchQuery] = useState('');

  const displayedTasks = useMemo(() => tasks.slice(0, 20), [tasks]);
  const selectedPlatformMeta = platformMeta.find((item) => item.id === selectedPlatform) || platformMeta[0];
  const capabilities = PLATFORM_SKILL_CAPABILITIES[selectedPlatform] || [];
  const supports = (action) => {
    const supported = capabilities.includes(action);
    console.log(`Platform: ${selectedPlatform}, Action: ${action}, Supported: ${supported}, Capabilities:`, capabilities);
    return supported;
  };

  function cn(...classes) {
    return classes.filter(Boolean).join(' ');
  }

  useEffect(() => {
    setQuery(selectedPlatformMeta.defaultQuery);
  }, [selectedPlatformMeta]);

  async function dispatchTask(payload) {
    setSubmitting(true);
    try {
      await fetch(`${backendUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await refreshTasks();
    } finally {
      setSubmitting(false);
    }
  }

  async function submitConversation(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!prompt.trim()) return;

    // Send message to dialogue API
    const response = await fetch(`${backendUrl}/dialogue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'default', message: prompt }),
    });

    const result = await response.json();
    setDialogue(result);
    setSelectedPlatforms([]);
    setPrompt('');
  }

  async function submitConversationText(text) {
    const nextPrompt = String(text || '').trim();
    if (!nextPrompt) return;
    setSubmitting(true);
    try {
      const response = await fetch(`${backendUrl}/dialogue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'default', message: nextPrompt }),
      });
      const result = await response.json();
      setDialogue(result);
      setSelectedPlatforms([]);
      setPrompt('');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDialogueSelect(option, isMultiSelect) {
    if (isMultiSelect) {
      // Toggle platform selection
      setSelectedPlatforms(prev =>
        prev.includes(option.id)
          ? prev.filter(p => p !== option.id)
          : [...prev, option.id]
      );
      return;
    }

    // Handle regular selection
    const response = await fetch(`${backendUrl}/dialogue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'default', choice: option }),
    });

    const result = await response.json();
    setDialogue(result);

    // If we have tasks to execute, dispatch them
    if (result.type === 'execution_plan' && result.tasks) {
      for (const task of result.tasks) {
        await dispatchTask({
          prompt: task.prompt,
          context: task.context,
          preferredBrowserMode: task.platform === 'research' ? 'managed' : 'attached',
        });
      }
      setDialogue(null);
      setSelectedPlatforms([]);
    }
  }

  async function runPlatformAction(operation) {
    console.log('[runPlatformAction] Starting operation:', operation);
    console.log('[runPlatformAction] Selected platform:', selectedPlatform);
    console.log('[runPlatformAction] Query value:', query);

    const usernames = normalizeList(batchUsernames);
    const targetHandle = targetUsername.trim() || username.trim() || undefined;
    const autoOnlyOperations = new Set(['auto_dm', 'auto_dm_contact', 'auto_dm_new', 'like_ai_comment', 'like_post', 'auto_comment', 'follow_user', 'auto_post', 'bulk_dm_csv', 'bulk_engage_csv', 'bulk_follow_csv']);
    const messageOperations = new Set(['send_message', 'message_batch', 'lead_and_message', 'auto_dm', 'auto_dm_contact', 'auto_dm_new', 'bulk_dm_csv']);
    const trimmedQuery = query.trim();
    const noisyDefaults = new Set(['customer follow up']);
    const messageContext = messageOperations.has(operation) && trimmedQuery && !noisyDefaults.has(trimmedQuery.toLowerCase())
      ? trimmedQuery
      : undefined;
    const baseContext = {
      destination: operation === 'find_leads' || operation === 'lead_and_message' ? 'sheet' : 'inbox',
      maxResults: Number(maxResults) || 15,
      messageGoal: goal,
      platform: selectedPlatform,
      query: messageOperations.has(operation) ? messageContext : trimmedQuery,
      requireManualReview: autoOnlyOperations.has(operation) ? false : automationMode === 'manual',
      tone,
      attachmentPath: attachmentPath.trim() || undefined,
      emailSubject: emailSubject.trim() || undefined,
      emailCc: emailCc.trim() || undefined,
      emailBcc: emailBcc.trim() || undefined,
      emailSignature: emailSignature.trim() || undefined,
      username: targetHandle,
      usernames,
    };

    console.log('[runPlatformAction] Base context:', baseContext);

    const payloads = {
      open_workspace: {
        prompt: `Open ${selectedPlatformMeta.label} in my attached Chrome workspace.`,
        context: { ...baseContext, operation: 'open_workspace' },
      },
      find_leads: {
        prompt: `Find ${maxResults} leads on ${selectedPlatformMeta.label} for "${query}" and export them to a sheet.`,
        context: { ...baseContext, operation: 'find_leads' },
      },
      send_message: {
        prompt: `Message ${username || 'the selected contact'} on ${selectedPlatformMeta.label}. Goal: ${goal}. Tone: ${tone}.`,
        context: { ...baseContext, operation: 'send_message' },
      },
      message_batch: {
        prompt: `Message these ${usernames.length} contacts one by one on ${selectedPlatformMeta.label}. Goal: ${goal}. Tone: ${tone}. Respect caps and review before send.`,
        context: { ...baseContext, operation: 'message_batch' },
      },
      lead_and_message: {
        prompt: `Find ${maxResults} leads on ${selectedPlatformMeta.label} for "${query}", put them in a sheet, then message them one by one. Goal: ${goal}. Tone: ${tone}.`,
        context: { ...baseContext, operation: 'lead_and_message' },
      },
      scrape_profiles: {
        prompt: `Scrape profile search results for "${query}" on ${selectedPlatformMeta.label}. Limit: ${maxResults}.`,
        context: { ...baseContext, operation: 'scrape_profiles' },
      },
      execute_deep_scrape: {
        prompt: `Execute a deep scrape on ${selectedPlatformMeta.label} for keyword "${query}". Limit: ${maxResults}.`,
        context: { ...baseContext, operation: 'execute_deep_scrape' },
      },
      auto_dm: {
        prompt: `Send an automated DM to ${targetHandle || 'the user'} on ${selectedPlatformMeta.label}. Goal: ${goal}. Tone: ${tone}. Attachment: ${attachmentPath || 'none'}.`,
        context: { ...baseContext, operation: 'auto_dm', attachmentPath },
      },
      auto_dm_contact: {
        prompt: `Send an automated DM to contact ${targetHandle || 'the user'} on ${selectedPlatformMeta.label}. Goal: ${goal}. Tone: ${tone}. Attachment: ${attachmentPath || 'none'}.`,
        context: { ...baseContext, operation: 'auto_dm_contact', attachmentPath },
      },
      auto_dm_new: {
        prompt: `Send an automated DM to new person ${targetHandle || 'the user'} on ${selectedPlatformMeta.label}. Goal: ${goal}. Tone: ${tone}. Attachment: ${attachmentPath || 'none'}.`,
        context: { ...baseContext, operation: 'auto_dm_new', attachmentPath },
      },
      like_ai_comment: {
        prompt: `Like and leave an AI-generated comment on ${targetHandle || 'the user'}'s recent post on ${selectedPlatformMeta.label}. Goal: ${goal}. Tone: ${tone}.`,
        context: { ...baseContext, operation: 'like_ai_comment' },
      },
      like_post: {
        prompt: `Like ${targetHandle || 'the user'}'s most recent post on ${selectedPlatformMeta.label}.`,
        context: { ...baseContext, operation: 'like_post' },
      },
      auto_comment: {
        prompt: `Leave an AI-generated comment on ${targetHandle || 'the user'}'s most recent post on ${selectedPlatformMeta.label}. Goal: ${goal}. Tone: ${tone}.`,
        context: { ...baseContext, operation: 'auto_comment' },
      },
      comment_post: {
        prompt: `Leave an AI-generated comment on ${targetHandle || 'the user'}'s most recent post on ${selectedPlatformMeta.label}. Goal: ${goal}. Tone: ${tone}.`,
        context: { ...baseContext, operation: 'comment_post' },
      },
      engage_post: {
        prompt: `Like and leave an AI-generated comment on ${targetHandle || 'the user'}'s most recent post on ${selectedPlatformMeta.label}. Goal: ${goal}. Tone: ${tone}.`,
        context: { ...baseContext, operation: 'engage_post' },
      },
      follow_user: {
        prompt: `Follow ${targetHandle || 'the user'} on ${selectedPlatformMeta.label}.`,
        context: { ...baseContext, operation: 'follow_user' },
      },
      follow_and_message: {
        prompt: `Follow ${targetHandle || 'the selected contact'} on ${selectedPlatformMeta.label}, then send a contextual message. Goal: ${goal}. Tone: ${tone}.`,
        context: { ...baseContext, operation: 'follow_and_message' },
      },
      scrape_and_message: {
        prompt: `Scrape ${maxResults} ${selectedPlatformMeta.label} profiles for "${query}", then message the provided targets one by one. Goal: ${goal}. Tone: ${tone}.`,
        context: { ...baseContext, operation: 'scrape_and_message', destination: 'sheet' },
      },
      auto_post: {
        prompt: `Automatically create a post on ${selectedPlatformMeta.label}. Content goal: ${goal}. Tone: ${tone}. Asset: ${attachmentPath || 'none'}.`,
        context: { ...baseContext, operation: 'auto_post', attachmentPath },
      },
      // Gmail-specific
      gmail_search: {
        prompt: `Search Gmail for: ${gmailSearchQuery || query}`,
        context: { ...baseContext, operation: 'gmail_search', query: gmailSearchQuery || query },
      },
      gmail_get_context: {
        prompt: `Read and extract context from my Gmail inbox.`,
        context: { ...baseContext, operation: 'gmail_get_context', maxResults: 20 },
      },
      gmail_get_profile: {
        prompt: `Get profile context for email ${targetUsername} from Gmail history.`,
        context: { ...baseContext, operation: 'gmail_get_profile' },
      },
      gmail_reply: {
        prompt: `Reply to the latest email from ${targetUsername} on Gmail. Goal: ${goal}. Tone: ${tone}.`,
        context: { ...baseContext, operation: 'gmail_reply' },
      },
      bulk_dm_csv: {
        prompt: `Execute a bulk DM campaign from CSV on ${selectedPlatformMeta.label}. List size: ${usernames.length}. Goal: ${goal}. Tone: ${tone}.`,
        context: { ...baseContext, operation: 'bulk_dm_csv' },
      },
      bulk_engage_csv: {
        prompt: `Execute bulk engagement (like/comment) from CSV on ${selectedPlatformMeta.label}. List size: ${usernames.length}. Goal: ${goal}. Tone: ${tone}.`,
        context: { ...baseContext, operation: 'bulk_engage_csv' },
      },
      bulk_follow_csv: {
        prompt: `Execute bulk follow from CSV on ${selectedPlatformMeta.label}. List size: ${usernames.length}.`,
        context: { ...baseContext, operation: 'bulk_follow_csv' },
      },
      open_status: {
        prompt: `Open the status or updates view in ${selectedPlatformMeta.label}.`,
        context: { ...baseContext, operation: 'open_status' },
      },
      post_status: {
        prompt: `Create a new status on ${selectedPlatformMeta.label}. Goal: ${goal}. Tone: ${tone}. Asset: ${attachmentPath || 'none'}.`,
        context: { ...baseContext, operation: 'post_status', attachmentPath },
      },
      change_profile_photo: {
        prompt: `Change the profile photo on ${selectedPlatformMeta.label}. Asset: ${attachmentPath || 'none'}.`,
        context: { ...baseContext, operation: 'change_profile_photo', attachmentPath },
      },
      delete_chat: {
        prompt: `Delete the chat with ${targetHandle || 'the selected contact'} on ${selectedPlatformMeta.label}.`,
        context: { ...baseContext, operation: 'delete_chat' },
      },
      block_user: {
        prompt: `Block ${targetHandle || 'the selected contact'} on ${selectedPlatformMeta.label}.`,
        context: { ...baseContext, operation: 'block_user' },
      },
      report_user: {
        prompt: `Report ${targetHandle || 'the selected contact'} on ${selectedPlatformMeta.label}.`,
        context: { ...baseContext, operation: 'report_user' },
      },
      scrape_followers: {
        prompt: `Scrape followers or competitor audience from ${targetHandle || query} on ${selectedPlatformMeta.label}. Limit: ${maxResults}.`,
        context: { ...baseContext, operation: 'scrape_followers', query: targetHandle || query },
      },
      map_contacts: {
        prompt: `Map visible contacts and conversations from ${selectedPlatformMeta.label} into the dashboard.`,
        context: { ...baseContext, operation: 'map_contacts', destination: 'artifact' },
      },
      // ChatGPT & Gemini specific — combine ALL panel inputs into a rich prompt
      generate_image: (() => {
        const subject = query.trim() || 'A cinematic landscape';
        const parts = [`Create an image of: ${subject}.`];
        if (targetUsername.trim()) parts.push(`Subject/Target: ${targetUsername.trim()}.`);
        if (goal && goal.trim()) parts.push(`Goal/Purpose: ${goal.trim()}.`);
        if (tone && tone.trim()) parts.push(`Style/Tone: ${tone.trim()}.`);
        if (maxResults) parts.push(`Variations: ${maxResults}.`);
        if (attachmentPath.trim()) parts.push(`Reference asset: ${attachmentPath.trim()}.`);
        const composedPrompt = parts.join(' ');
        return {
          prompt: composedPrompt,
          context: {
            ...baseContext,
            operation: 'generate_image',
            messageGoal: subject,
            query: subject,
            imageSubject: subject,
            imageTarget: targetUsername.trim() || undefined,
            imageGoal: goal && goal.trim() ? goal.trim() : undefined,
            imageTone: tone && tone.trim() ? tone.trim() : undefined,
            imageVariations: Number(maxResults) || 1,
            attachmentPath: attachmentPath.trim() || undefined,
          },
        };
      })(),
      ask: (() => {
        const question = query.trim() || 'What can you help me with?';
        const parts = [question];
        if (targetUsername.trim()) parts.push(`Context — about: ${targetUsername.trim()}.`);
        if (goal && goal.trim()) parts.push(`Goal: ${goal.trim()}.`);
        if (tone && tone.trim()) parts.push(`Tone: ${tone.trim()}.`);
        if (attachmentPath.trim()) parts.push(`Attached file: ${attachmentPath.trim()}.`);
        const composedPrompt = parts.join(' ');
        return {
          prompt: composedPrompt,
          context: {
            ...baseContext,
            operation: 'ask',
            messageGoal: question,
            query: question,
            askTarget: targetUsername.trim() || undefined,
            askGoal: goal && goal.trim() ? goal.trim() : undefined,
            askTone: tone && tone.trim() ? tone.trim() : undefined,
            attachmentPath: attachmentPath.trim() || undefined,
          },
        };
      })(),
    };

    const operationPayload = payloads[operation];
    console.log('[runPlatformAction] Operation payload:', operationPayload);

    if (!operationPayload) {
      console.error(`[runPlatformAction] Missing payload for operation: ${operation}`);
      console.error('[runPlatformAction] Available operations:', Object.keys(payloads));
      return;
    }

    await dispatchTask({
      ...operationPayload,
      preferredBrowserMode: selectedPlatform === 'research' ? 'managed' : 'attached',
    });
    console.log('[runPlatformAction] Task dispatched successfully');
  }

  return (
    <section className="workspace-container relative w-full flex flex-col">
      {/* 1. Full-Height AI Chat Section (The "Home Screen") */}
      <div className="w-full h-screen flex flex-col bg-[#050505] relative overflow-hidden">
        {/* Scrollable Conversation Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-24">
          <div className="max-w-[1000px] mx-auto flex flex-col gap-12 pb-32">
            {displayedTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-40 animate-in fade-in zoom-in-95 duration-1000">
                <div className="w-24 h-24 rounded-full bg-zinc-900/50 flex items-center justify-center mb-10 border border-zinc-800 shadow-2xl">
                  <selectedPlatformMeta.icon className="w-10 h-10 text-white" />
                </div>
                <h2 className="text-6xl font-black text-white tracking-tighter mb-4">What's on your mind?</h2>
                <p className="text-zinc-500 max-w-sm mt-2 text-xl font-medium leading-relaxed">
                  Start an agentic workflow by typing a command below.
                </p>
              </div>
            ) : (
              displayedTasks.map((task) => (
                <div key={task.id} className="flex flex-col gap-8 animate-in fade-in duration-500">
                  {/* User Message (Standard) */}
                  <div className="flex flex-col items-end gap-3 self-end max-w-[80%]">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">You</span>
                      <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[8px] text-white">U</div>
                    </div>
                    <div className="bg-zinc-900 text-zinc-100 px-6 py-4 rounded-2xl rounded-tr-none text-lg font-medium shadow-xl">
                      {task.prompt}
                    </div>
                  </div>

                  {/* Agent Response (aliimam style) */}
                  <div className="flex flex-col items-start gap-4 self-start w-full">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-red-600 flex items-center justify-center text-white">
                        <selectedPlatformMeta.icon className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest invisible">Cherry AI</span>
                    </div>
                    <div className="w-full pl-8 flex flex-col gap-4">
                      <div className="bg-[#0c0c0e] border border-zinc-800/50 p-8 rounded-2xl shadow-inner text-zinc-300 leading-relaxed">
                        <TaskCard task={task} compact />
                      </div>
                      
                      {/* Actions row */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="p-2 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-red-500 transition-all"><RefreshCw className="w-4 h-4" /></button>
                        <button className="p-2 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-red-500 transition-all"><ThumbsUp className="w-4 h-4" /></button>
                        <button className="p-2 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-red-500 transition-all"><ThumbsDown className="w-4 h-4" /></button>
                        <button className="p-2 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-red-500 transition-all"><Copy className="w-4 h-4" /></button>
                        <button className="p-2 rounded-full hover:bg-zinc-800 text-zinc-500 hover:text-red-500 transition-all"><Share className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 2. Dialogue Box - Video Game Style Choices */}
        {dialogue && (
          <div className="w-full px-8 pb-4">
            <div className="max-w-[700px] mx-auto">
              <DialogueBox
                dialogue={dialogue}
                onSelect={handleDialogueSelect}
                selectedPlatforms={selectedPlatforms}
              />
            </div>
          </div>
        )}

        {/* 3. AI Chat Input Block (hextaui style) */}
        <div className="w-full px-8 pb-12">
          <div className="max-w-[700px] mx-auto">
            <div className="flex items-center justify-end mb-3">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/50 border border-zinc-800 text-zinc-400 text-xs font-medium cursor-pointer hover:bg-zinc-800 transition-all">
                <span>Cherry v1.0</span>
                <ChevronDown className="w-3 h-3" />
              </div>
            </div>

            <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 rounded-[2rem] p-6 shadow-2xl">
              <textarea
                className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-zinc-500 text-lg resize-none min-h-[100px] outline-none font-medium custom-scrollbar"
                placeholder="Talk to Cherry..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitConversation();
                  }
                }}
              />
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-zinc-800/50">
                <div className="flex items-center gap-2">
                  <button className="p-2.5 rounded-xl hover:bg-zinc-800 text-zinc-500 hover:text-white transition-all"><Paperclip className="w-5 h-5" /></button>
                  <button className="p-2.5 rounded-xl hover:bg-zinc-800 text-zinc-500 hover:text-white transition-all"><Lightbulb className="w-5 h-5" /></button>
                  <button className="flex items-center gap-2 px-4 py-2 rounded-xl hover:bg-zinc-800 text-zinc-500 hover:text-white transition-all text-xs font-bold uppercase tracking-widest">
                    <Globe className="w-4 h-4" />
                    <span>Search</span>
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <button className="p-2.5 rounded-full border border-zinc-800 text-zinc-500 hover:text-white transition-all"><Mic className="w-5 h-5" /></button>
                  <button 
                    onClick={submitConversation}
                    disabled={!prompt.trim() || submitting}
                    className="p-3.5 rounded-2xl bg-white text-black hover:bg-zinc-200 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <ArrowUp className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </div>
            
            {/* Quick Starter Prompts */}
            <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
              <button
                onClick={() => submitConversationText('I want more sales and customers')}
                className="px-4 py-2 rounded-full bg-zinc-900/50 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 text-xs font-medium transition-all"
              >
                💰 I want more sales
              </button>
              <button
                onClick={() => submitConversationText('Help me grow my brand and followers')}
                className="px-4 py-2 rounded-full bg-zinc-900/50 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 text-xs font-medium transition-all"
              >
                📢 Grow my brand
              </button>
              <button
                onClick={() => submitConversationText('Monitor my messages and auto-respond')}
                className="px-4 py-2 rounded-full bg-zinc-900/50 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 text-xs font-medium transition-all"
              >
                👁️ Monitor & respond
              </button>
              <button
                onClick={() => submitConversationText('Research my competitors')}
                className="px-4 py-2 rounded-full bg-zinc-900/50 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 text-xs font-medium transition-all"
              >
                🔍 Research competitors
              </button>
            </div>

            <div className="flex items-center justify-center gap-6 mt-4">
              <button className="text-[9px] text-zinc-700 font-black uppercase tracking-[0.4em] hover:text-zinc-500 transition-colors">
                Scroll for dashboard ↓
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Integration & Tools Section (Below the chat section) */}
      <div className="w-full max-w-[1200px] mx-auto flex flex-col gap-12 py-12 px-8">
        <IntegrationShowcase
          title="Command ~Center~"
          subtitle="Configure autonomous platform agents."
          integrations={platformMeta}
          selectedIntegration={selectedPlatform}
          onIntegrationClick={setSelectedPlatform}
          className="py-0"
        />

        {selectedPlatform && (
          <div className="action-center animate-in fade-in zoom-in-95 duration-1000">
            <section className="action-card relative overflow-hidden bg-[#09090b] border border-zinc-800 p-12 rounded-[3rem] shadow-3xl">
              <div className="absolute top-0 right-0 w-[700px] h-[700px] bg-white/[0.01] blur-[200px] rounded-full -mr-64 -mt-64 pointer-events-none" />
              
              <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-8 mb-12 border-b border-zinc-800 pb-10">
                <div className="flex items-center gap-12">
                  <div className="w-20 h-20 rounded-[1.5rem] bg-zinc-900 border border-red-500/20 flex items-center justify-center shadow-2xl">
                    <selectedPlatformMeta.icon className="w-10 h-10 text-white" />
                  </div>
                  <div>
                    <h3 className="text-4xl font-black text-white tracking-tighter">{selectedPlatformMeta.label}</h3>
                    <div className="flex items-center gap-6 mt-6">
                      <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-[11px] font-black text-green-500 uppercase tracking-widest">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        Live
                      </div>
                      <p className="text-sm text-zinc-500 font-bold uppercase tracking-[0.3em]">Neural Bridge Active</p>
                    </div>
                  </div>
                </div>

                <div className="flex bg-zinc-900/40 p-1.5 rounded-[1.5rem] border border-zinc-800 shadow-2xl backdrop-blur-xl">
                  <button onClick={() => setAutomationMode('manual')} className={cn("px-8 py-3 rounded-[1.2rem] text-[9px] font-black uppercase tracking-widest transition-all", automationMode === 'manual' ? "bg-red-500 text-white shadow-2xl scale-105" : "text-zinc-500 hover:text-zinc-300")}>Manual Control</button>
                  <button onClick={() => setAutomationMode('auto')} className={cn("px-8 py-3 rounded-[1.2rem] text-[9px] font-black uppercase tracking-widest transition-all", automationMode === 'auto' ? "bg-red-500 text-white shadow-2xl scale-105" : "text-zinc-500 hover:text-zinc-300")}>Auto Pilot</button>
                </div>
              </div>

              <div className="relative mb-12 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {WORKFLOW_PRESETS.filter((preset) => {
                  const workflowSupport = {
                    find_leads: supports('scrape_results'),
                    scrape_profiles: supports('scrape_results'),
                    follow_user: supports('follow_user'),
                    send_message: supports('send_message'),
                    follow_and_message: supports('follow_user') && supports('send_message'),
                    lead_and_message: supports('scrape_results') && supports('message_batch'),
                    map_contacts: supports('map_contacts'),
                  };
                  return workflowSupport[preset.id];
                }).map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => runPlatformAction(preset.id)}
                    className="text-left p-5 rounded-2xl bg-black/60 border border-zinc-800 hover:border-red-500/50 hover:bg-zinc-950 transition-all"
                  >
                    <span className="block text-sm font-black text-white uppercase tracking-widest">{preset.label}</span>
                    <span className="block mt-2 text-xs leading-relaxed text-zinc-500">{preset.description}</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                {/* LEFT COLUMN: SCRAPER ENGINE / PROMPT STUDIO */}
                <div className="space-y-12">
                  <div className="space-y-8">
                    <h4 className="text-[14px] font-black text-white uppercase tracking-[0.3em] border-b border-zinc-800 pb-4">
                      {selectedPlatformMeta.label} - {(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? 'PROMPT STUDIO' : 'LEAD SCRAPER ENGINE'}
                    </h4>
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <label className="text-[11px] font-black text-zinc-600 uppercase tracking-[0.4em] ml-2">
                          {(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? 'Prompt / Subject' : 'Target Keyword/Niche'}
                        </label>
                        <input className="w-full bg-black border border-zinc-800 rounded-2xl py-6 px-8 text-lg text-white focus:border-zinc-500 outline-none shadow-2xl font-medium" placeholder={(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? 'e.g. A cinematic landscape' : 'e.g. tech founders'} value={query} onChange={(event) => setQuery(event.target.value)} />
                      </div>
                      <div className="space-y-3">
                        <label className="text-[11px] font-black text-zinc-600 uppercase tracking-[0.4em] ml-2">
                          {(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? 'Image Variations / Response Length' : 'Max Profiles to Scrape'}
                        </label>
                        <input className="w-full bg-black border border-zinc-800 rounded-2xl py-6 px-8 text-lg text-white focus:border-zinc-500 outline-none shadow-2xl font-medium" type="number" value={maxResults} onChange={(event) => setMaxResults(event.target.value)} />
                      </div>
                      {(supports('scrape_results') || supports('search')) ? (
                        <button onClick={() => runPlatformAction('execute_deep_scrape')} className="w-full p-8 rounded-[2rem] bg-red-600 hover:bg-red-700 text-white font-black text-lg transition-all active:scale-95 shadow-2xl">Execute Deep Scrape</button>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-6">
                    {supports('scrape_results') ? <button onClick={() => runPlatformAction('scrape_profiles')} className="flex items-center justify-between p-6 rounded-[2rem] bg-zinc-900/30 hover:bg-zinc-800/50 border border-zinc-800 text-white font-black transition-all group shadow-2xl">
                      <span className="text-lg">Search Results Scrape</span>
                      <Search className="w-6 h-6 text-zinc-700 group-hover:text-white transition-colors" />
                    </button> : null}
                    {supports('scrape_followers') ? <button onClick={() => runPlatformAction('scrape_followers')} className="flex items-center justify-between p-6 rounded-[2rem] bg-zinc-900/30 hover:bg-zinc-800/50 border border-zinc-800 text-white font-black transition-all group shadow-2xl">
                      <span className="text-lg">Extract Competitor Audience</span>
                      <Plus className="w-6 h-6 text-zinc-700 group-hover:text-white transition-colors" />
                    </button> : null}
                  </div>
                </div>

                {/* RIGHT COLUMN: ENGAGEMENT SUITE / AI OPTIONS */}
                <div className="space-y-12">
                  <h4 className="text-[14px] font-black text-white uppercase tracking-[0.3em] border-b border-zinc-800 pb-4">
                    {selectedPlatformMeta.label} - {(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? 'AI OPTIONS' : 'AUTO-ENGAGEMENT SUITE'}
                  </h4>

                  <div className="space-y-8">
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <label className="text-[11px] font-black text-zinc-600 uppercase tracking-[0.4em] ml-2">
                          {(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? 'Subject / Focus' : 'Target Username'}
                        </label>
                        <input className="w-full bg-black border border-zinc-800 rounded-2xl py-6 px-8 text-lg text-white focus:border-zinc-500 outline-none shadow-2xl font-medium" placeholder={(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? 'e.g. Hospital, sunset, cat' : 'username'} value={targetUsername} onChange={(event) => setTargetUsername(event.target.value)} />
                      </div>
                      <div className="space-y-3">
                        <label className="text-[11px] font-black text-zinc-600 uppercase tracking-[0.4em] ml-2">
                          {(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? 'Goal / Purpose' : 'LLM Goal'}
                        </label>
                        <input className="relative z-10 w-full bg-black border border-zinc-800 rounded-2xl py-6 px-8 text-lg text-white focus:border-zinc-500 outline-none shadow-2xl font-medium" placeholder={(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? 'e.g. marketing poster' : ''} value={goal} onChange={(event) => setGoal(event.target.value)} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <label className="text-[11px] font-black text-zinc-600 uppercase tracking-[0.4em] ml-2">
                          {(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? 'Style / Mood' : 'LLM Tone'}
                        </label>
                        <input className="relative z-10 w-full bg-black border border-zinc-800 rounded-2xl py-6 px-8 text-lg text-white focus:border-zinc-500 outline-none shadow-2xl font-medium" placeholder={(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? 'e.g. photorealistic, anime, watercolor' : ''} value={tone} onChange={(event) => setTone(event.target.value)} />
                      </div>
                      <div className="space-y-3">
                        <label className="text-[11px] font-black text-zinc-600 uppercase tracking-[0.4em] ml-2">
                          {(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? 'Reference Image / File (Optional)' : 'Attachment Path (Optional)'}
                        </label>
                        <input className="w-full bg-black border border-zinc-800 rounded-2xl py-6 px-8 text-lg text-white focus:border-zinc-500 outline-none shadow-2xl font-medium" placeholder="/path/to/image.png" value={attachmentPath} onChange={(event) => setAttachmentPath(event.target.value)} />
                      </div>
                    </div>

                    {(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? null : (
                      <div className="space-y-3">
                        <label className="text-[11px] font-black text-zinc-600 uppercase tracking-[0.4em] ml-2">Feed Usernames From CSV</label>
                        <div className="w-full h-32 bg-zinc-900/50 border-2 border-dashed border-zinc-800 rounded-[2rem] flex items-center justify-center cursor-pointer hover:bg-zinc-800/50 transition-all group">
                          <div className="flex flex-col items-center gap-2">
                            <Plus className="w-6 h-6 text-zinc-600 group-hover:text-white transition-colors" />
                            <span className="text-xs font-black text-zinc-500 uppercase tracking-widest">Upload Username CSV</span>
                          </div>
                        </div>
                        <p className="text-[10px] text-zinc-600 font-bold ml-2">Use a CSV where the first column contains usernames.</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      {supports('send_message') ? (
                        <>
                          <button onClick={() => runPlatformAction(selectedPlatform === 'gmail' ? 'auto_dm' : 'auto_dm_contact')} className="p-6 rounded-[1.5rem] bg-red-600 hover:bg-red-700 text-white font-black transition-all active:scale-95 shadow-2xl">{selectedPlatform === 'gmail' ? 'Auto-Email' : 'DM a contact'}</button>
                          {selectedPlatform !== 'gmail' && <button onClick={() => runPlatformAction('auto_dm_new')} className="p-6 rounded-[1.5rem] bg-red-600 hover:bg-red-700 text-white font-black transition-all active:scale-95 shadow-2xl">DM a new person</button>}
                        </>
                      ) : null}
                      {supports('engage_post') ? (
                        <>
                          <button onClick={() => runPlatformAction('like_post')} className="p-6 rounded-[1.5rem] bg-red-600 hover:bg-red-700 text-white font-black transition-all active:scale-95 shadow-2xl">❤️ Like Post</button>
                          <button onClick={() => runPlatformAction('engage_post')} className="p-6 rounded-[1.5rem] bg-red-600 hover:bg-red-700 text-white font-black transition-all active:scale-95 shadow-2xl">💬 AI Comment</button>
                        </>
                      ) : null}
                      {supports('follow_user') ? <button onClick={() => runPlatformAction('follow_user')} className="p-6 rounded-[1.5rem] bg-red-600 hover:bg-red-700 text-white font-black transition-all active:scale-95 shadow-2xl">Follow User</button> : null}
                      {supports('publish_post') ? <button onClick={() => runPlatformAction('auto_post')} className="p-6 rounded-[1.5rem] bg-red-600 hover:bg-red-700 text-white font-black transition-all active:scale-95 shadow-2xl">Auto-Post</button> : null}
                    </div>

                    {selectedPlatform === 'whatsapp' ? (
                      <div className="grid grid-cols-2 gap-4">
                        {supports('open_status') ? <button onClick={() => runPlatformAction('open_status')} className="p-5 rounded-[1.5rem] bg-zinc-900/40 hover:bg-zinc-800/60 border border-zinc-800 text-white font-black transition-all active:scale-95 shadow-2xl">View Status</button> : null}
                        {supports('post_status') ? <button onClick={() => runPlatformAction('post_status')} className="p-5 rounded-[1.5rem] bg-zinc-900/40 hover:bg-zinc-800/60 border border-zinc-800 text-white font-black transition-all active:scale-95 shadow-2xl">Post Status</button> : null}
                        {supports('change_profile_photo') ? <button onClick={() => runPlatformAction('change_profile_photo')} className="p-5 rounded-[1.5rem] bg-zinc-900/40 hover:bg-zinc-800/60 border border-zinc-800 text-white font-black transition-all active:scale-95 shadow-2xl">Change Profile Pic</button> : null}
                        {supports('delete_chat') ? <button onClick={() => runPlatformAction('delete_chat')} className="p-5 rounded-[1.5rem] bg-zinc-900/40 hover:bg-zinc-800/60 border border-zinc-800 text-white font-black transition-all active:scale-95 shadow-2xl">Delete Chat</button> : null}
                        {supports('block_user') ? <button onClick={() => runPlatformAction('block_user')} className="p-5 rounded-[1.5rem] bg-zinc-900/40 hover:bg-zinc-800/60 border border-zinc-800 text-white font-black transition-all active:scale-95 shadow-2xl">Block Contact</button> : null}
                        {supports('report_user') ? <button onClick={() => runPlatformAction('report_user')} className="p-5 rounded-[1.5rem] bg-zinc-900/40 hover:bg-zinc-800/60 border border-zinc-800 text-white font-black transition-all active:scale-95 shadow-2xl">Report Contact</button> : null}
                      </div>
                    ) : null}

                    {/* ChatGPT & Gemini specific buttons - only 2 options */}
                    {(selectedPlatform === 'chatgpt' || selectedPlatform === 'gemini') ? (
                      <div className="grid grid-cols-2 gap-4">
                        {supports('ask') ? (
                          <button onClick={() => { console.log('Ask Question clicked'); runPlatformAction('ask'); }} className="p-6 rounded-[1.5rem] bg-red-600 hover:bg-red-700 text-white font-black transition-all active:scale-95 shadow-2xl">Ask Question</button>
                        ) : (
                          <div className="p-6 rounded-[1.5rem] bg-zinc-900/40 text-zinc-500 text-center">Ask not supported</div>
                        )}
                        {supports('generate_image') ? (
                          <button onClick={() => { console.log('Generate Image clicked'); runPlatformAction('generate_image'); }} className="p-6 rounded-[1.5rem] bg-red-600 hover:bg-red-700 text-white font-black transition-all active:scale-95 shadow-2xl">Generate Image</button>
                        ) : (
                          <div className="p-6 rounded-[1.5rem] bg-zinc-900/40 text-zinc-500 text-center">Generate not supported</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-zinc-600 text-sm">Select ChatGPT or Gemini to see options</div>
                    )}

                    {/* Gmail-specific expanded panel */}
                    {selectedPlatform === 'gmail' ? (
                      <div className="space-y-6 p-6 rounded-[2rem] bg-zinc-900/40 border border-zinc-800">
                        <p className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.4em]">Gmail — Email Options</p>

                        {/* Row 1: Subject + CC */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest ml-1">Subject</label>
                            <input className="w-full bg-black border border-zinc-800 rounded-xl py-4 px-5 text-sm text-white focus:border-zinc-500 outline-none" placeholder="Email subject (optional, AI picks one)" value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest ml-1">CC</label>
                            <input className="w-full bg-black border border-zinc-800 rounded-xl py-4 px-5 text-sm text-white focus:border-zinc-500 outline-none" placeholder="cc@example.com" value={emailCc} onChange={e => setEmailCc(e.target.value)} />
                          </div>
                        </div>

                        {/* Row 2: BCC + Attachment */}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest ml-1">BCC</label>
                            <input className="w-full bg-black border border-zinc-800 rounded-xl py-4 px-5 text-sm text-white focus:border-zinc-500 outline-none" placeholder="bcc@example.com" value={emailBcc} onChange={e => setEmailBcc(e.target.value)} />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest ml-1">Attachment (HTML / Image / Video)</label>
                            <input className="w-full bg-black border border-zinc-800 rounded-xl py-4 px-5 text-sm text-white focus:border-zinc-500 outline-none" placeholder="/path/to/file.html" value={attachmentPath} onChange={e => setAttachmentPath(e.target.value)} />
                          </div>
                        </div>

                        {/* Signature */}
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-zinc-600 uppercase tracking-widest ml-1">Email Signature (optional)</label>
                          <textarea rows={3} className="w-full bg-black border border-zinc-800 rounded-xl py-4 px-5 text-sm text-white focus:border-zinc-500 outline-none resize-none" placeholder={"Best,\nYour Name\nyoursite.com"} value={emailSignature} onChange={e => setEmailSignature(e.target.value)} />
                        </div>

                        {/* Gmail utility buttons */}
                        <div className="space-y-3 pt-2 border-t border-zinc-800">
                          <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Gmail Tools</p>
                          <div className="flex gap-3 flex-wrap">
                            <div className="flex gap-2 flex-1">
                              <input className="flex-1 bg-black border border-zinc-800 rounded-xl py-3 px-4 text-sm text-white focus:border-zinc-500 outline-none" placeholder="Search query..." value={gmailSearchQuery} onChange={e => setGmailSearchQuery(e.target.value)} />
                              <button onClick={() => runPlatformAction('gmail_search')} className="px-5 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-black text-xs transition-all whitespace-nowrap">🔍 Search</button>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <button onClick={() => runPlatformAction('gmail_get_context')} className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all font-black text-xs uppercase tracking-widest">📬 Get Inbox Context</button>
                            <button onClick={() => runPlatformAction('gmail_get_profile')} className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all font-black text-xs uppercase tracking-widest">👤 Get Sender Profile</button>
                            <button onClick={() => runPlatformAction('gmail_reply')} className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all font-black text-xs uppercase tracking-widest">↩️ Reply to Email</button>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 gap-3">
                      {supports('message_batch') ? <button onClick={() => runPlatformAction('bulk_dm_csv')} className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all font-black uppercase text-xs tracking-widest">Bulk {selectedPlatform === 'gmail' ? 'Email' : 'DM'} From CSV</button> : null}
                      {supports('engage_batch') ? <button onClick={() => runPlatformAction('bulk_engage_csv')} className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all font-black uppercase text-xs tracking-widest">Bulk Engage From CSV</button> : null}
                      {supports('follow_batch') ? <button onClick={() => runPlatformAction('bulk_follow_csv')} className="p-4 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all font-black uppercase text-xs tracking-widest">Bulk Follow From CSV</button> : null}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-16 pt-10 border-t border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-12">
                <div className="flex items-center gap-8 text-zinc-600">
                  <Zap className="w-12 h-12 text-red-500 shadow-2xl" />
                  <div className="flex flex-col">
                    <span className="text-3xl font-black text-white tracking-tight">Agent Synchronized</span>
                    <span className="text-sm font-bold uppercase tracking-[0.3em]">Bridge Ready for {selectedPlatformMeta.label}</span>
                  </div>
                </div>
                <button onClick={() => runPlatformAction(supports('send_message') ? 'send_message' : 'open_workspace')} className="w-full md:w-auto px-24 py-12 bg-white text-black rounded-[4rem] font-black text-3xl shadow-3xl hover:scale-105 transition-all active:scale-95">Initiate Protocol</button>
              </div>
            </section>
          </div>
        )}

        <div className="panel bg-black/40 rounded-[5rem] border border-zinc-800 p-20 shadow-3xl">
          <div className="flex items-center justify-between mb-20 border-b border-zinc-800 pb-12">
            <div>
              <h3 className="text-5xl font-black text-white tracking-tighter">Archive</h3>
              <p className="text-[12px] text-zinc-600 font-black uppercase tracking-[0.4em] mt-4">Agentic Log History</p>
            </div>
            <button className="px-10 py-4 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 hover:text-white transition-colors">Wipe Records</button>
          </div>
          <div className="grid grid-cols-1 gap-6">
            {tasks.length ? tasks.map((task) => (
              <div key={task.id} className="p-10 bg-zinc-900/10 rounded-[2.5rem] border border-zinc-800/30 flex items-center justify-between group hover:border-zinc-700 transition-all">
                <div className="flex items-center gap-10">
                  <div className="w-2.5 h-2.5 rounded-full bg-zinc-800 group-hover:bg-red-500 transition-colors shadow-2xl" />
                  <span className="text-2xl text-zinc-400 font-bold truncate max-w-2xl">{task.prompt}</span>
                </div>
                <div className="flex items-center gap-12">
                  <span className="text-xs text-zinc-700 font-black uppercase tracking-[0.2em]">{new Date(task.createdAt).toLocaleTimeString()}</span>
                  <span className={cn(
                    "px-6 py-2 rounded-full border text-[10px] font-black uppercase tracking-[0.3em]",
                    task.status === 'completed' ? "bg-green-900/30 border-green-800/50 text-green-500" :
                    task.status === 'failed' ? "bg-red-900/30 border-red-800/50 text-red-500" :
                    task.status === 'running' ? "bg-blue-900/30 border-blue-800/50 text-blue-500" :
                    task.status === 'retrying' ? "bg-yellow-900/30 border-yellow-800/50 text-yellow-500" :
                    "bg-zinc-900 border-zinc-800 text-zinc-500"
                  )}>{task.status}</span>
                </div>
              </div>
            )) : <p className="text-center text-zinc-600 py-20 text-2xl font-medium">No recorded operations.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function Campaigns({ campaigns, refreshCampaigns }) {
  const [name, setName] = useState('Always-on social outreach');
  const [objective, setObjective] = useState('Monitor inboxes, continue outreach follow-ups, refresh lead pools, and push approved messages one by one.');
  const [keywords, setKeywords] = useState('fintech founders, saas operators');
  const [cadenceMinutes, setCadenceMinutes] = useState(60);
  const [tone, setTone] = useState('Casual and brief');
  const [goal, setGoal] = useState('Get a meeting');
  const [selectedPlatforms, setSelectedPlatforms] = useState(defaultCampaignPlatforms);
  const [response, setResponse] = useState(null);

  function togglePlatform(platformId) {
    setSelectedPlatforms((current) =>
      current.includes(platformId) ? current.filter((item) => item !== platformId) : [...current, platformId],
    );
  }

  async function createCampaign(event) {
    event.preventDefault();

    const perPlatform = Object.fromEntries(
      selectedPlatforms.map((platform) => [platform, platform === 'research' ? 'managed' : 'attached']),
    );

    const payload = {
      name,
      objective,
      platforms: selectedPlatforms,
      browserStrategy: {
        defaultMode: 'attached',
        perPlatform,
      },
      schedules: [{ id: 'primary', label: `Every ${cadenceMinutes} min`, cadenceMinutes: Number(cadenceMinutes) || 60 }],
      caps: {
        perPlatformDailyActions: { instagram: 50, twitter: 40, linkedin: 30, facebook: 20, gmail: 35, whatsapp: 35 },
        perPlatformDailyMessages: { instagram: 20, twitter: 15, linkedin: 20, facebook: 10, gmail: 30, whatsapp: 25 },
        maxConcurrentTabs: 4,
        maxConcurrentConversations: 2,
      },
      quietHours: {
        timezone: 'Asia/Kolkata',
        windows: [{ start: '23:00', end: '07:00' }],
      },
      targets: {
        usernames: [],
        emails: [],
        keywords: normalizeList(keywords.replace(/,/g, '\n')),
        notes: 'Structured from the new campaigns console.',
      },
      leadSources: [
        { sourceType: 'search_engine', engine: 'duckduckgo', query: keywords.split(',')[0]?.trim() || 'fintech founders', browserMode: 'managed' },
      ],
      stopRules: [{ type: 'daily_cap_reached' }, { type: 'consecutive_failures', count: 5 }],
      contentPolicy: {
        tone,
        outreachGoal: goal,
        allowAutonomousReplies: false,
      },
      status: 'draft',
    };

    const res = await fetch(`${backendUrl}/campaigns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setResponse(await res.json());
    await refreshCampaigns();
  }

  return (
    <section className="campaigns-grid">
      <div className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Campaign builder</span>
            <h2>Per-platform campaign strategy</h2>
            <p>Research stays managed. Outreach platforms stay attached so the agent works in your real Chrome session.</p>
          </div>
        </div>

        <form className="campaign-form" onSubmit={createCampaign}>
          <label htmlFor="campaign-name">Campaign name</label>
          <input id="campaign-name" value={name} onChange={(event) => setName(event.target.value)} />

          <label htmlFor="campaign-objective">Objective</label>
          <textarea id="campaign-objective" rows={4} value={objective} onChange={(event) => setObjective(event.target.value)} />

          <div className="campaign-fields">
            <div>
              <label htmlFor="campaign-keywords">Lead keywords</label>
              <input id="campaign-keywords" value={keywords} onChange={(event) => setKeywords(event.target.value)} />
            </div>
            <div>
              <label htmlFor="campaign-cadence">Cadence minutes</label>
              <input id="campaign-cadence" type="number" min="15" value={cadenceMinutes} onChange={(event) => setCadenceMinutes(Number(event.target.value) || 15)} />
            </div>
          </div>

          <div className="campaign-fields">
            <div>
              <label htmlFor="campaign-goal">Outreach goal</label>
              <input id="campaign-goal" value={goal} onChange={(event) => setGoal(event.target.value)} />
            </div>
            <div>
              <label htmlFor="campaign-tone">Tone</label>
              <input id="campaign-tone" value={tone} onChange={(event) => setTone(event.target.value)} />
            </div>
          </div>

          <div className="platform-toggle-grid">
            {platformMeta.map((platform) => (
              <button
                key={platform.id}
                className={`platform-toggle ${selectedPlatforms.includes(platform.id) ? 'active' : ''}`}
                onClick={() => togglePlatform(platform.id)}
                type="button"
              >
                <span>{platform.label}</span>
                <small>{platform.id === 'research' ? 'Managed' : 'Attached'}</small>
              </button>
            ))}
          </div>

          <button type="submit">Create campaign draft</button>
        </form>
      </div>

      <div className="campaigns-side">
        <div className="panel">
          <h3>Latest draft</h3>
          {response ? <pre>{JSON.stringify(response, null, 2)}</pre> : <p>No campaign draft yet.</p>}
        </div>

        <div className="panel">
          <h3>Campaign queue</h3>
          <div className="task-list">
            {campaigns.length ? campaigns.map((campaign) => (
              <div key={campaign.id} className="campaign-card">
                <div className="task-card-top">
                  <strong>{campaign.name}</strong>
                  <span className={`status-badge ${campaign.status}`}>{campaign.status}</span>
                </div>
                <p>{campaign.objective}</p>
                <div className="meta-row">
                  <span>{campaign.platforms.join(', ')}</span>
                  <span>{campaign.schedules[0]?.cadenceMinutes || 0} min cadence</span>
                </div>
              </div>
            )) : <p>No campaigns yet.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function Dashboard({ contactMetrics, refreshContactMetrics }) {
  const metrics = contactMetrics || {};
  const summary = metrics.summary || {};
  const categories = metrics.categories || {};
  const platforms = metrics.platforms || [];
  const sentiment = metrics.sentiment || {};
  const recentActivity = metrics.recentActivity || [];

  return (
    <section className="space-y-12">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-black text-white tracking-tighter">Contact Intelligence</h2>
          <p className="text-[12px] text-zinc-600 font-black uppercase tracking-[0.4em] mt-4">
            Cross-platform contact mapping and analytics
          </p>
        </div>
        <button 
          onClick={() => refreshContactMetrics()}
          className="px-6 py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-sm font-bold text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
        >
          Refresh Data
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-6">
        <div className="p-8 bg-zinc-900/40 rounded-[2rem] border border-zinc-800">
          <p className="text-[11px] font-black text-zinc-600 uppercase tracking-[0.4em]">Total Contacts</p>
          <p className="text-5xl font-black text-white mt-4">{summary.totalContacts || 0}</p>
        </div>
        <div className="p-8 bg-zinc-900/40 rounded-[2rem] border border-zinc-800">
          <p className="text-[11px] font-black text-zinc-600 uppercase tracking-[0.4em]">Platforms</p>
          <p className="text-5xl font-black text-white mt-4">{summary.totalPlatforms || 0}</p>
        </div>
        <div className="p-8 bg-zinc-900/40 rounded-[2rem] border border-zinc-800">
          <p className="text-[11px] font-black text-zinc-600 uppercase tracking-[0.4em]">Leads</p>
          <p className="text-5xl font-black text-green-500 mt-4">{categories.leads || 0}</p>
        </div>
        <div className="p-8 bg-zinc-900/40 rounded-[2rem] border border-zinc-800">
          <p className="text-[11px] font-black text-zinc-600 uppercase tracking-[0.4em]">Active Chats</p>
          <p className="text-5xl font-black text-blue-500 mt-4">
            {(recentActivity || []).length}
          </p>
        </div>
      </div>

      {/* Platform Breakdown */}
      <div className="panel bg-black/40 rounded-[3rem] border border-zinc-800 p-12">
        <h3 className="text-2xl font-black text-white mb-8">Platform Breakdown</h3>
        <div className="grid grid-cols-5 gap-6">
          {platforms.map((platform) => (
            <div key={platform.name} className="p-6 bg-zinc-900/40 rounded-2xl border border-zinc-800 text-center">
              <p className="text-lg font-bold text-white capitalize">{platform.name}</p>
              <p className="text-3xl font-black text-white mt-2">{platform.total || 0}</p>
              <div className="mt-3 space-y-1 text-xs text-zinc-500">
                <p>{platform.connections || platform.followers || 0} connections</p>
                {platform.pending > 0 && <p className="text-yellow-500">{platform.pending} pending</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Categories & Sentiment */}
      <div className="grid grid-cols-2 gap-8">
        <div className="panel bg-black/40 rounded-[3rem] border border-zinc-800 p-12">
          <h3 className="text-2xl font-black text-white mb-8">Contact Categories</h3>
          <div className="space-y-4">
            {Object.entries(categories).map(([name, count]) => (
              <div key={name} className="flex items-center justify-between p-4 bg-zinc-900/40 rounded-xl">
                <span className="text-zinc-400 capitalize font-bold">{name}</span>
                <span className="text-2xl font-black text-white">{count || 0}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel bg-black/40 rounded-[3rem] border border-zinc-800 p-12">
          <h3 className="text-2xl font-black text-white mb-8">Sentiment Analysis</h3>
          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-zinc-900/40 rounded-xl">
              <span className="text-green-500 font-bold">Positive</span>
              <span className="text-2xl font-black text-white">{sentiment.positive || 0}</span>
            </div>
            <div className="flex items-center justify-between p-4 bg-zinc-900/40 rounded-xl">
              <span className="text-zinc-400 font-bold">Neutral</span>
              <span className="text-2xl font-black text-white">{sentiment.neutral || 0}</span>
            </div>
            <div className="flex items-center justify-between p-4 bg-zinc-900/40 rounded-xl">
              <span className="text-red-500 font-bold">Negative</span>
              <span className="text-2xl font-black text-white">{sentiment.negative || 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="panel bg-black/40 rounded-[3rem] border border-zinc-800 p-12">
        <h3 className="text-2xl font-black text-white mb-8">Recent Activity</h3>
        {recentActivity.length > 0 ? (
          <div className="space-y-4">
            {recentActivity.slice(0, 10).map((activity, idx) => (
              <div key={idx} className="flex items-center justify-between p-4 bg-zinc-900/40 rounded-xl">
                <div>
                  <p className="text-white font-bold">{activity.name}</p>
                  <p className="text-xs text-zinc-500 capitalize">{activity.platform} • {activity.category}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-600">
                    {activity.lastMessageAt ? new Date(activity.lastMessageAt).toLocaleDateString() : 'No recent activity'}
                  </p>
                  {activity.potentialUse && (
                    <span className="text-xs text-zinc-500">{activity.potentialUse}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-zinc-600">No recent activity. Run "map_contacts" to sync data.</p>
          </div>
        )}
      </div>

      {/* Instructions */}
      {metrics.status === 'pending_initial_sync' && (
        <div className="p-8 bg-yellow-500/10 border border-yellow-500/30 rounded-[2rem]">
          <p className="text-yellow-500 font-bold text-lg">Initial Setup Required</p>
          <p className="text-zinc-400 mt-2">
            To populate your dashboard, run the "map_contacts" action on any platform. 
            This will extract your contacts, conversations, and build intelligence.
          </p>
        </div>
      )}
    </section>
  );
}

function Pairing() {
  const [pairing, setPairing] = useState(null);

  useEffect(() => {
    fetch(`${backendUrl}/agent/pairing/code`, { method: 'POST' })
      .then((response) => response.json())
      .then(setPairing);
  }, []);

  return (
    <section className="pairing-grid max-w-2xl mx-auto py-12">
      <div className="panel border-white/5 bg-[#0c0c0c] rounded-2xl border p-8 text-center">
        <span className="text-[10px] uppercase tracking-[0.2em] font-bold text-red-500 mb-2 block">Agent Pairing</span>
        <h2 className="text-3xl font-bold text-white mb-4">Secure Device Connection</h2>
        <p className="text-zinc-500 mb-8">Enter this unique authorization code in your local agent instance to link this workspace.</p>

        {pairing ? (
          <div className="bg-black/40 border border-white/5 rounded-3xl p-12 shadow-2xl">
            <div className="text-6xl font-black tracking-[0.3em] text-white mb-4 font-mono">{pairing.code}</div>
            <div className="text-xs text-zinc-600 uppercase tracking-widest">
              Expires at {new Date(pairing.expiresAt).toLocaleTimeString()}
            </div>
          </div>
        ) : (
          <div className="animate-pulse text-zinc-500 italic">Generating secure code...</div>
        )}
        
        <div className="mt-12 p-6 bg-white/5 rounded-2xl border border-white/5 text-left">
          <h4 className="text-sm font-bold text-white mb-2">Instructions</h4>
          <p className="text-sm text-zinc-500 leading-relaxed">
            Ensure your local Cherry Agent is running. When prompted, enter the code above to authorize this browser session. 
            Once paired, your social automation engine will become active.
          </p>
        </div>
      </div>
    </section>
  );
}

function History({ events, tasks }) {
  return (
    <section className="history-grid">
      <div className="panel">
        <h2>Task ledger</h2>
        <div className="task-list">
          {tasks.map((task) => <TaskCard key={task.id} task={task} compact />)}
        </div>
      </div>

      <div className="panel">
        <h2>Event stream</h2>
        <div className="event-list long">
          {events.map((event, index) => (
            <div key={`${event.type}-${index}`} className="event-row">
              <span className="event-type">{event.type}</span>
              <span className="event-text">{describeEvent(event)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TaskCard({ compact = false, task }) {
  const latestArtifact = [...(task.events || [])].reverse().find((event) => event.type === 'artifact.ready');
  const latestFailure = [...(task.events || [])].reverse().find((event) => event.type === 'task.failed' || event.type === 'step.failed');
  const hitlEvent = [...(task.events || [])].reverse().find((event) => event.type === 'hitl.required');
  const completedEvent = [...(task.events || [])].reverse().find((event) => event.type === 'task.completed');
  const plan = task.events?.find((event) => event.type === 'plan.generated')?.plan;


  const stepStates = useMemo(() => {
    const state = new Map();
    for (const event of task.events || []) {
      if (event.type === 'step.started') {
        state.set(event.stepId, { kind: 'running', label: event.label });
      }
      if (event.type === 'step.progress') {
        state.set(event.stepId, { kind: 'done', detail: event.message });
      }
      if (event.type === 'step.failed') {
        state.set(event.stepId, { kind: 'failed', detail: event.error });
      }
      if (event.type === 'hitl.required') {
        state.set(event.stepId, { kind: 'paused', detail: event.message });
      }
    }
    return state;
  }, [task.events]);


  return (
    <article className={`task-card ${compact ? 'compact' : ''}`}>
      <div className="task-card-top">
        <div>
          <strong>{task.prompt}</strong>
          <div className="meta-row">
            <span>{task.context?.platform || 'auto-routing'}</span>
            <span>{new Date(task.createdAt).toLocaleString()}</span>
          </div>
        </div>
        <span className={`status-badge ${task.status}`}>{task.status}</span>
      </div>

      {task.context?.operation ? <p className="task-summary">Operation: <code>{task.context.operation}</code></p> : null}

      {plan?.steps?.length ? (
        <div className="step-stack">
          {plan.steps.map((step) => {
            const current = stepStates.get(step.id);
            return (
              <div key={step.id} className={`step-row ${current?.kind || 'idle'}`}>
                <div>
                  <span className="step-label">{step.platform}:{step.action}</span>
                  <small>{step.browserMode}</small>
                </div>
                <span className="step-detail">{current?.detail || current?.label || 'Queued'}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {completedEvent ? <p className="success-note">{completedEvent.summary}</p> : null}
      {latestFailure && !hitlEvent ? <p className="error-note">{latestFailure.error || latestFailure.detail}</p> : null}
      {hitlEvent ? (
        <div className="hitl-banner">
          <span className="hitl-icon">⚠️</span>
          <div>
            <strong>Action Required — Log In</strong>
            <p>{hitlEvent.message}</p>
            <small>Log in to <strong>{hitlEvent.platform}</strong> in the browser window, then re-send this task to retry.</small>
          </div>
        </div>
      ) : null}
      {latestArtifact?.url ? <p className="artifact-note">Artifact: <code>{latestArtifact.url}</code></p> : null}
    </article>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <strong>No tasks yet</strong>
      <p>Dispatch a conversational task or use a direct platform action.</p>
    </div>
  );
}

function normalizeList(text) {
  return text
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function describeEvent(event) {
  if (event.type === 'agent.status') return event.online ? 'Agent session active' : 'Agent disconnected';
  if (event.type === 'task.created') return `Initialized: ${event.prompt}`;
  if (event.type === 'campaign.updated') return `Campaign ${event.status}`;
  if (event.type === 'step.progress') return event.message;
  if (event.type === 'task.failed') return `Execution Error: ${event.error}`;
  if (event.type === 'task.completed') return `Success: ${event.summary}`;
  if (event.type === 'hitl.required') return `⚠️ Login required on ${event.platform} — please log in and retry`;
  return 'System Event';
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm5.25-8.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z" />
    </svg>
  );
}

function LinkedinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function GmailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.52 3.449A11.815 11.815 0 0 0 12.041 0C5.495 0 .162 5.333.16 11.879a11.82 11.82 0 0 0 1.62 5.986L0 24l6.303-1.652a11.83 11.83 0 0 0 5.734 1.462h.005c6.545 0 11.878-5.333 11.88-11.879A11.82 11.82 0 0 0 20.52 3.449ZM12.043 21.8h-.004a9.8 9.8 0 0 1-4.995-1.369l-.358-.213-3.74.98 1-3.648-.233-.375A9.8 9.8 0 0 1 2.2 11.88C2.202 6.447 6.61 2.04 12.041 2.04c2.633 0 5.108 1.026 6.971 2.89a9.79 9.79 0 0 1 2.886 6.972c-.002 5.432-4.41 9.839-9.855 9.839Zm5.395-7.358c-.295-.148-1.746-.862-2.017-.96-.27-.099-.467-.148-.665.148-.197.295-.764.96-.936 1.158-.172.197-.344.221-.639.074-.295-.148-1.246-.459-2.373-1.463-.876-.781-1.467-1.746-1.639-2.041-.172-.295-.018-.454.13-.602.133-.132.295-.344.443-.516.147-.172.197-.295.295-.492.098-.197.049-.369-.025-.516-.074-.148-.664-1.6-.91-2.189-.239-.575-.482-.496-.665-.505-.172-.008-.369-.01-.566-.01-.197 0-.516.074-.787.369-.27.295-1.033 1.009-1.033 2.459s1.058 2.853 1.205 3.05c.148.197 2.082 3.179 5.044 4.456.705.304 1.254.485 1.682.621.707.225 1.351.193 1.86.117.568-.085 1.746-.713 1.992-1.403.246-.689.246-1.279.172-1.402-.074-.123-.271-.197-.566-.344Z" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.707 20.879l-5.632-5.632A9.972 9.972 0 0 0 20 9.999a10 10 0 1 0-10 10 9.972 9.972 0 0 0 5.247-1.925l5.632 5.632a2 2 0 1 0 2.828-2.828ZM2 9.999a8 8 0 1 1 8 8 8.01 8.01 0 0 1-8-8Z" />
    </svg>
  );
}

function ChatGPTIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-1.5609-7.2502 6.0063 6.0063 0 0 0-8.3202.9649 5.9856 5.9856 0 0 0-8.3973 2.0526 6.0063 6.0063 0 0 0 .548 8.3534 5.985 5.985 0 0 0 1.5609 7.2503 6.0063 6.0063 0 0 0 8.3202-.9649 5.9856 5.9856 0 0 0 8.3973-2.0525 6.006 6.006 0 0 0-.548-8.3536Zm-8.6521 7.3651v-5.1054l4.423-2.5532.032.013v5.527l-4.455 2.5705v-.4519Zm-1.21-1.0664-4.4365-2.5604 2.2155-3.8373h5.539l-2.202 3.8138-1.116.6453-.0001 1.9386Zm-5.326-1.5162-2.228-3.859 4.423-2.5532 2.2144 3.8354-4.41 2.5457v.0311Zm-1.464-6.3117 2.2155-3.8374h8.86l-2.2156 3.8374H7.6298Zm2.674-2.5828 4.4365 2.5604-2.2154 3.8374H4.386l2.202-3.8138 1.116-.6453.0001-1.9387Zm5.326 1.5163 2.228 3.859-4.423 2.5532-2.2144-3.8353 4.41-2.5458v-.0311Zm1.464 6.3117-2.2156 3.8373h-8.86l2.2156-3.8373h6.6444Zm-5.111-2.6075 2.2281-1.2863 2.2281 1.2863v2.5726l-2.2281 1.2862-2.2281-1.2862V10.93Z"/>
    </svg>
  );
}

function GeminiIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.049 2.006c-.456-1.048-1.745-1.048-2.201 0l-1.921 4.409-4.321 2.052c-1.018.484-1.018 1.91 0 2.394l4.32 2.053 1.922 4.408c.456 1.048 1.745 1.048 2.201 0l1.922-4.408 4.32-2.053c1.018-.484 1.018-1.91 0-2.394l-4.32-2.052Zm8.081 13.918c-.342-.786-1.308-.786-1.65 0l-.824 1.89-1.851.879c-.437.208-.437.82 0 1.027l1.85.88.825 1.889c.342.786 1.308.786 1.65 0l.824-1.89 1.851-.879c.437-.208.437-.82 0-1.027l-1.85-.88Z"/>
    </svg>
  );
}

export function App() {
  const { 
    agentOnline, 
    agentState, 
    campaigns, 
    events, 
    refreshCampaigns, 
    refreshTasks, 
    tasks, 
    contactMetrics, 
    refreshContactMetrics 
  } = usePlatformData();

  return (
    <Shell agentOnline={agentOnline} agentState={agentState}>
      <Routes>
        <Route path="/" element={<Workspace agentOnline={agentOnline} events={events} refreshTasks={refreshTasks} tasks={tasks} />} />
        <Route path="/dashboard" element={<Dashboard contactMetrics={contactMetrics} refreshContactMetrics={refreshContactMetrics} />} />
        <Route path="/campaigns" element={<Campaigns campaigns={campaigns} refreshCampaigns={refreshCampaigns} />} />
        <Route path="/pairing" element={<Pairing />} />
        <Route path="/history" element={<History events={events} tasks={tasks} />} />
      </Routes>
    </Shell>
  );
}
