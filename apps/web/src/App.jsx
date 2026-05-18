import { useEffect, useMemo, useRef, useState } from 'react';

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
    
    socket.onopen = () => {
      console.log('WebSocket connected successfully');
    };
    
    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    socket.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      // Attempt to reconnect after 3 seconds
      setTimeout(() => {
        console.log('Attempting to reconnect WebSocket...');
        const newSocket = new WebSocket(`${backendWsUrl}/ws?role=web`);
        newSocket.onmessage = socket.onmessage;
        newSocket.onopen = socket.onopen;
        newSocket.onerror = socket.onerror;
        newSocket.onclose = socket.onclose;
      }, 3000);
    };
    
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
  const sc = !agentOnline ? '' : browserAttached ? 'attached' : 'online';
  const sl = !agentOnline ? 'Offline' : browserAttached ? 'Browser Attached' : 'Agent Online';
  const ss = agentState?.profileDirectory
    ? `${agentState.tabs||0} tabs · ${agentState.profileDirectory.split(/[\\/]/).pop()}`
    : 'Waiting for local agent…';
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand">
            <div className="brand-dot"/>
            <span className="brand-name">Cherry</span>
            <span className="brand-tag">AI</span>
          </div>
          <div className="status-pill">
            <div className={`status-dot ${sc}`}/>
            <div><div className="status-text">{sl}</div><div className="status-sub">{ss}</div></div>
          </div>
          <nav className="sidebar-nav">
            <NavLink to="/" end className={({isActive})=>isActive?'active':''}>
              <svg className="nav-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 7h2v7h4v-4h2v4h4V7h2L8 1z"/></svg>Workspace
            </NavLink>
            <NavLink to="/dashboard" className={({isActive})=>isActive?'active':''}>
              <svg className="nav-icon" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>Dashboard
            </NavLink>
            <NavLink to="/campaigns" className={({isActive})=>isActive?'active':''}>
              <svg className="nav-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M2 4h12v2H2zm0 3h12v2H2zm0 3h8v2H2z"/></svg>Campaigns
            </NavLink>
            <NavLink to="/history" className={({isActive})=>isActive?'active':''}>
              <svg className="nav-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM7 4h2v4.414l2.293 2.293-1.414 1.414L7 9.414V4z"/></svg>History
            </NavLink>
            <NavLink to="/pairing" className={({isActive})=>isActive?'active':''}>
              <svg className="nav-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M10 3a1 1 0 0 1 1 1v1h1a3 3 0 0 1 0 6h-1v1a1 1 0 0 1-2 0v-1H6v1a1 1 0 0 1-2 0v-1H3a3 3 0 0 1 0-6h1V4a1 1 0 0 1 1-1h5z"/></svg>Pairing
            </NavLink>
          </nav>
        </div>
        <div className="sidebar-bottom">
          <span style={{fontSize:10,color:'var(--text-3)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.1em'}}>v1.0 · Cherry AI</span>
        </div>
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

  // ── Multi-session Chat History ─────────────────────────────────────────────
  const SESSIONS_INDEX_KEY = 'cherry_sessions';
  const sessionMsgKey = (id) => `cherry_session_${id}`;
  const WELCOME_MSG = { role: 'assistant', content: "Hey! I'm Cherry — your AI automation agent. Tell me what you want to do and I'll figure out the best way to make it happen.", id: 'welcome' };

  const genSessionId = () => `s_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

  const loadSessionIndex = () => { try { return JSON.parse(localStorage.getItem(SESSIONS_INDEX_KEY) || '[]'); } catch { return []; } };
  const saveSessionIndex = (idx) => { try { localStorage.setItem(SESSIONS_INDEX_KEY, JSON.stringify(idx.slice(0, 50))); } catch {} };
  const loadSessionMsgs  = (id)  => { try { const s = localStorage.getItem(sessionMsgKey(id)); return s ? JSON.parse(s).map(m => ({...m, streaming: false})) : null; } catch { return null; } };
  const saveSessionMsgs  = (id, msgs) => { try { localStorage.setItem(sessionMsgKey(id), JSON.stringify(msgs)); } catch {} };
  const deleteSessionData= (id)  => { try { localStorage.removeItem(sessionMsgKey(id)); } catch {} };

  // Init session
  const [sessionId,      setSessionId]      = useState(() => { const idx = loadSessionIndex(); return idx[0]?.id || genSessionId(); });
  const [sessionIndex,   setSessionIndex]   = useState(() => loadSessionIndex());
  const [showHistory,    setShowHistory]    = useState(false);

  const [aiMessages, _setAiMessages] = useState(() => {
    const idx = loadSessionIndex();
    if (idx[0]) { const msgs = loadSessionMsgs(idx[0].id); if (msgs?.length) return msgs; }
    return [WELCOME_MSG];
  });

  const setAiMessages = (updater) => {
    _setAiMessages(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      // Save messages to localStorage for current session
      saveSessionMsgs(sessionId, next);
      // Update session index with latest title
      const title = next.find(m => m.role === 'user')?.content?.slice(0, 55) || 'New chat';
      const idx = loadSessionIndex();
      const ei = idx.findIndex(s => s.id === sessionId);
      const meta = { id: sessionId, title, timestamp: Date.now() };
      const newIdx = ei >= 0 ? idx.map((s,i) => i === ei ? meta : s) : [meta, ...idx];
      saveSessionIndex(newIdx);
      setSessionIndex(newIdx);
      return next;
    });
  };

  // Start a brand-new chat session
  const startNewChat = async () => {
    if (isTyping) return;
    const newId = genSessionId();
    setSessionId(newId);
    const welcome = {...WELCOME_MSG, id: `welcome_${newId}`};
    _setAiMessages([welcome]);
    saveSessionMsgs(newId, [welcome]);
    const meta = { id: newId, title: 'New chat', timestamp: Date.now() };
    const newIdx = [meta, ...loadSessionIndex()];
    saveSessionIndex(newIdx);
    setSessionIndex(newIdx);
    setShowHistory(false);
    try { await fetch(`${backendUrl}/ai/chat/default`, { method: 'DELETE' }); } catch {}
  };

  // Switch to a past session
  const switchSession = (id) => {
    if (id === sessionId) { setShowHistory(false); return; }
    const msgs = loadSessionMsgs(id);
    setSessionId(id);
    _setAiMessages(msgs?.length ? msgs : [WELCOME_MSG]);
    setShowHistory(false);
  };

  // Delete a session
  const deleteSession = (id, e) => {
    e.stopPropagation();
    deleteSessionData(id);
    const newIdx = loadSessionIndex().filter(s => s.id !== id);
    saveSessionIndex(newIdx);
    setSessionIndex(newIdx);
    if (id === sessionId) startNewChat();
  };

  const [llmOnline, setLlmOnline] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  const displayedTasks = useMemo(() => tasks.slice(0, 20), [tasks]);
  const selectedPlatformMeta = platformMeta.find((item) => item.id === selectedPlatform) || platformMeta[0];
  const capabilities = PLATFORM_SKILL_CAPABILITIES[selectedPlatform] || [];
  const supports = (action) => capabilities.includes(action);

  const chatBottomRef = useRef(null);
  useEffect(() => { chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [aiMessages, isTyping]);

  // Check LLM health on mount
  useEffect(() => {
    fetch(`${backendUrl}/ai/health`)
      .then(r => r.json())
      .then(d => setLlmOnline(d.llm === 'online'))
      .catch(() => setLlmOnline(false));
  }, []);

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

  async function sendAiMessage(text) {
    const msg = (text || prompt).trim();
    if (!msg || isTyping) return;
    setPrompt('');
    setIsTyping(true);

    // Add user message + a blank assistant message that we'll stream into
    const assistantId = Date.now() + 'a';
    setAiMessages(prev => [
      ...prev,
      { role: 'user', content: msg, id: Date.now() + 'u' },
      { role: 'assistant', content: '', suggestions: null, streaming: true, id: assistantId },
    ]);

    try {
      const res = await fetch(`${backendUrl}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'default', message: msg }),
      });

      if (!res.ok) throw new Error('offline');
      setLlmOnline(true);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const evt = JSON.parse(raw);

            if (evt.token) {
              // Append token to the streaming bubble
              setAiMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, content: m.content + evt.token }
                  : m
              ));
            }

            if (evt.done) {
              // Stream finished — attach suggestions and remove streaming flag
              setAiMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, streaming: false, suggestions: evt.suggestions || null }
                  : m
              ));
            }
          } catch {}
        }
      }
    } catch {
      setLlmOnline(false);
      setAiMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: 'LLM is offline. Run: python3 llm_server.py', streaming: false, error: true }
          : m
      ));
    } finally {
      setIsTyping(false);
    }
  }

  async function executeSuggestion(suggestion) {
    try {
      const res = await fetch(`${backendUrl}/ai/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestion }),
      });
      const data = await res.json();
      await refreshTasks();
      const isContinuous = data.mode === 'continuous';
      setAiMessages(prev => [...prev, {
        role: 'assistant',
        content: isContinuous
          ? `✅ Campaign scheduled: "${data.campaign?.name}" — running every ${suggestion.cadenceMinutes} min in the background.`
          : `✅ ${data.count} task${data.count !== 1 ? 's' : ''} queued — Cherry is on it.`,
        id: Date.now() + 'ex',
      }]);
    } catch (e) {
      setAiMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e.message}`, id: Date.now() + 'ee', error: true }]);
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

    const usernames = normalizeList(batchUsernames);
    const targetHandle = targetUsername.trim() || username.trim() || undefined;
    const autoOnlyOperations = new Set(['auto_dm', 'auto_dm_contact', 'auto_dm_new', 'like_ai_comment', 'like_post', 'auto_comment', 'follow_user', 'follow_search', 'connect', 'connect_swn', 'connect_sn', 'auto_post', 'bulk_dm_csv', 'bulk_engage_csv', 'bulk_follow_csv']);
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
      follow_search: {
        prompt: `Search people on ${selectedPlatformMeta.label} for "${query}" and follow or add each result one by one. Limit: ${maxResults}.`,
        context: { ...baseContext, operation: 'follow_search' },
      },
      connect: {
        prompt: `LinkedIn connect-SWN: send connection request without a note to ${targetHandle || 'the user'}.`,
        context: { ...baseContext, operation: 'connect_swn' },
      },
      connect_swn: {
        prompt: `LinkedIn connect-SWN: send connection request without a note to ${targetHandle || 'the user'}.`,
        context: { ...baseContext, operation: 'connect_swn' },
      },
      connect_sn: {
        prompt: `LinkedIn connect-SN: send connection request with a personal note to ${targetHandle || 'the user'}. Goal: ${goal}. Tone: ${tone}.`,
        context: { ...baseContext, operation: 'connect_sn' },
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
      // ── Image pipeline ──────────────────────────────────────────────────────
      download_image: {
        prompt: `Download image/media from ${targetHandle || 'the post'} on ${selectedPlatformMeta.label}.`,
        context: { ...baseContext, operation: 'download_image', username: targetHandle },
      },
      send_image_dm: {
        prompt: `Send a DM with image to ${targetHandle || 'the user'} on ${selectedPlatformMeta.label}. Image: ${attachmentPath}. Goal: ${goal}. Tone: ${tone}.`,
        context: { ...baseContext, operation: 'send_image_dm', username: targetHandle, attachmentPath: attachmentPath.trim() || undefined },
      },
      generate_and_post: {
        prompt: `Generate an image of "${query}" via ${selectedPlatformMeta.label}, then post it on Instagram. Goal: ${goal}.`,
        context: { ...baseContext, operation: 'generate_and_post', query, destination: 'instagram' },
      },
      generate_and_dm: {
        prompt: `Generate an image of "${query}" via ${selectedPlatformMeta.label}, then DM it to ${targetHandle || 'the user'} on Instagram.`,
        context: { ...baseContext, operation: 'generate_and_dm', query, username: targetHandle, destination: 'instagram' },
      },
      upload_to_ai: {
        prompt: `Upload ${attachmentPath} to ${selectedPlatformMeta.label} and ${goal}.`,
        context: { ...baseContext, operation: 'upload_to_ai', attachmentPath: attachmentPath.trim() || undefined, query: goal },
      },
      // ── ChatGPT & Gemini ────────────────────────────────────────────────────
      generate_image: (() => {
        const subject = query.trim() || 'A cinematic landscape';
        const parts = [`Create an image of: ${subject}.`];
        if (targetUsername.trim()) parts.push(`Subject/Target: ${targetUsername.trim()}.`);
        if (goal && goal.trim()) parts.push(`Goal/Purpose: ${goal.trim()}.`);
        if (tone && tone.trim()) parts.push(`Style/Tone: ${tone.trim()}.`);
        if (maxResults) parts.push(`Variations: ${maxResults}.`);
        if (attachmentPath.trim()) parts.push(`Reference asset: ${attachmentPath.trim()}.`);
        return {
          prompt: parts.join(' '),
          context: { ...baseContext, operation: 'generate_image', query: subject, imageSubject: subject, attachmentPath: attachmentPath.trim() || undefined },
        };
      })(),
      ask: (() => {
        const question = query.trim() || 'What can you help me with?';
        const parts = [question];
        if (targetUsername.trim()) parts.push(`Context — about: ${targetUsername.trim()}.`);
        if (goal && goal.trim()) parts.push(`Goal: ${goal.trim()}.`);
        if (tone && tone.trim()) parts.push(`Tone: ${tone.trim()}.`);
        if (attachmentPath.trim()) parts.push(`Attached file: ${attachmentPath.trim()}.`);
        return {
          prompt: parts.join(' '),
          context: { ...baseContext, operation: 'ask', query: question, attachmentPath: attachmentPath.trim() || undefined },
        };
      })(),
    };


    const operationPayload = payloads[operation];
    if (!operationPayload) {
      console.warn(`[Cherry] No payload for operation: ${operation}`);
      return;
    }

    await dispatchTask({
      ...operationPayload,
      preferredBrowserMode: selectedPlatform === 'research' ? 'managed' : 'attached',
    });
  }

  const isAI = selectedPlatform==='chatgpt'||selectedPlatform==='gemini';
  const isGmail = selectedPlatform==='gmail';
  const isWA = selectedPlatform==='whatsapp';
  const isLI = selectedPlatform==='linkedin';

  return (
    <div className="workspace">
      {/* LEFT: Chat feed */}
      <div className="chat-pane">
        <div className="chat-header">
          <div style={{width:26,height:26,borderRadius:8,background:'var(--red-dim)',border:'1px solid rgba(229,57,53,0.2)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
            <selectedPlatformMeta.icon style={{width:13,height:13}}/>
          </div>
          <div>
            <div className="chat-header-title">Cherry AI — {selectedPlatformMeta.label}</div>
            <div className="chat-header-sub">Agentic task feed</div>
          </div>
          {/* ── Controls in header ── */}
          <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:8}}>
            <button
              onClick={()=>setShowHistory(h=>!h)}
              style={{background:showHistory?'rgba(255,255,255,0.08)':'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',color:'#fff',cursor:'pointer',fontSize:11,padding:'5px 10px',borderRadius:6,display:'flex',alignItems:'center',gap:5,fontWeight:500,transition:'all .15s'}}>
              🕐 History
              {sessionIndex.filter(s=>s.title!=='New chat').length > 0 &&
                <span style={{background:'var(--red)',color:'#fff',borderRadius:10,padding:'0 5px',fontSize:9,marginLeft:2}}>
                  {sessionIndex.filter(s=>s.title!=='New chat').length}
                </span>}
            </button>
            <button
              onClick={startNewChat}
              style={{background:'var(--red)',border:'none',color:'#fff',cursor:'pointer',fontSize:11,padding:'5px 12px',borderRadius:6,fontWeight:700,opacity:isTyping?0.5:1,transition:'opacity .15s'}}>
              + New chat
            </button>
          </div>
        </div>

        {/* LLM status bar */}
        <div className="llm-status">
          <div style={{width:7,height:7,borderRadius:'50%',flexShrink:0,
            background:llmOnline===null?'var(--text-3)':llmOnline?'var(--green)':'var(--red)',
            boxShadow:llmOnline?'0 0 5px var(--green)':'none'}}/>
          <span style={{fontSize:10}}>
            {llmOnline===null?'Checking LLM…':llmOnline?'Cherry LLM · Online':'LLM offline — run python3 llm_server.py'}
          </span>
        </div>

        {/* ── History panel (inline, toggles chat area) ─────────────────── */}
        {showHistory ? (
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderBottom:'1px solid var(--panel-border)',flexShrink:0}}>
              <span style={{fontSize:12,fontWeight:700,color:'var(--text)'}}>
                Chat history <span style={{color:'var(--text-3)',fontWeight:400}}>({sessionIndex.length} chats)</span>
              </span>
              <button onClick={()=>setShowHistory(false)} style={{background:'none',border:'1px solid var(--panel-border)',color:'var(--text-3)',cursor:'pointer',fontSize:11,padding:'3px 8px',borderRadius:4}}>✕ Close</button>
            </div>
            <div className="custom-scroll" style={{flex:1,overflowY:'auto',padding:8,display:'flex',flexDirection:'column',gap:4}}>
              {sessionIndex.length === 0 && (
                <div style={{textAlign:'center',color:'var(--text-3)',fontSize:12,marginTop:60,lineHeight:1.8}}>
                  No past chats yet.<br/>Start chatting to save history.
                </div>
              )}
              {sessionIndex.map(s => (
                <div key={s.id} onClick={()=>switchSession(s.id)}
                  style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',borderRadius:7,cursor:'pointer',
                    background:s.id===sessionId?'rgba(229,57,53,0.1)':'rgba(255,255,255,0.03)',
                    border:s.id===sessionId?'1px solid rgba(229,57,53,0.3)':'1px solid rgba(255,255,255,0.05)',transition:'all .1s'}}
                  onMouseEnter={e=>{if(s.id!==sessionId)e.currentTarget.style.background='rgba(255,255,255,0.06)'}}
                  onMouseLeave={e=>{if(s.id!==sessionId)e.currentTarget.style.background='rgba(255,255,255,0.03)'}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,color:s.id===sessionId?'var(--red)':'var(--text)',fontWeight:s.id===sessionId?600:400,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                      {s.id===sessionId && '● '}{s.title}
                    </div>
                    <div style={{fontSize:10,color:'var(--text-3)',marginTop:2}}>
                      {new Date(s.timestamp).toLocaleDateString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}
                    </div>
                  </div>
                  <button onClick={(e)=>deleteSession(s.id,e)}
                    style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',padding:'4px 7px',borderRadius:4,fontSize:14,flexShrink:0,opacity:.4,transition:'all .15s'}}
                    onMouseEnter={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.color='var(--red)'}}
                    onMouseLeave={e=>{e.currentTarget.style.opacity='.4';e.currentTarget.style.color='var(--text-3)'}}>
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
        <div className="chat-messages custom-scroll">
          <div className="ai-thread">
            {aiMessages.map(msg => (
              <div key={msg.id} className={`ai-msg ai-msg-${msg.role}`}>
                <div className="ai-role-label">
                  {msg.role === 'assistant' && <span className="ai-cherry-dot"/>}
                  {msg.role === 'assistant' ? 'Cherry' : 'You'}
                </div>
                {/* Show typing dots while connecting, streamed text once tokens arrive */}
                {msg.streaming && !msg.content ? (
                  <div className="ai-typing"><span/><span/><span/></div>
                ) : msg.content !== undefined && msg.content !== '' ? (
                  <div className="ai-bubble" style={msg.error?{borderColor:'rgba(229,57,53,.3)',color:'var(--red)'}:{}}>
                    {msg.content}
                    {msg.streaming && <span className="stream-cursor"/>}
                  </div>
                ) : null}
                {/* Suggestion cards — multi-tool action options from LLM */}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div style={{display:'flex',flexDirection:'column',gap:7,marginTop:6}}>
                    {msg.suggestions.map((sug, si) => (
                      <div key={si} className="tool-card">
                        <div className="tool-card-header">
                          <span style={{fontSize:14}}>{sug.mode==='continuous'?'🔄':'▶'}</span>
                          <span className="tool-card-name">{sug.label}</span>
                          <span className={`tool-card-mode ${sug.mode||'burst'}`}>{sug.mode==='continuous'?(()=>{const s=sug.cadenceSeconds,m=sug.cadenceMinutes;return s?s<60?`every ${s}s`:`every ${Math.round(s/60)}m`:m?`every ${m}m`:'continuous'})():'one-time'}</span>
                        </div>
                        <div className="tool-card-params">
                          {(sug.tools||[]).map((t,ti)=>(
                            <div key={ti} className="tool-param">
                              <span className="tool-param-key">{String(ti+1)}.</span>
                              <span className="tool-param-val">{t.tool?.replace(/_/g,' ')}
                                {t.params?.platform&&<span style={{opacity:.5}}> · {t.params.platform}</span>}
                                {t.params?.target&&<span style={{opacity:.5}}> → {t.params.target}</span>}
                                {t.params?.query&&<span style={{opacity:.5}}> "{t.params.query}"</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="tool-card-actions">
                          <button className="tool-run-btn approve" onClick={()=>executeSuggestion(sug)}>
                            {sug.mode==='continuous'?'🔄 Schedule':'▶ Run now'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            ))}
            <div ref={chatBottomRef}/>
          </div>
        </div>
        )}

        <div className="chat-input-wrap">
          <div className="chat-input-box">
            <textarea rows={1} placeholder="Talk to Cherry…" value={prompt}
              onChange={e=>{setPrompt(e.target.value);e.target.style.height='auto';e.target.style.height=e.target.scrollHeight+'px'}}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendAiMessage()}}}/>
            <button className="chat-send-btn" onClick={()=>sendAiMessage()} disabled={!prompt.trim()||isTyping}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1 14L8 2l7 12H9.5L8 9.5 6.5 14H1z"/></svg>
            </button>
          </div>
          <div className="chat-quick-prompts">
            {[['💰','Get me more sales'],['📢','Grow my brand'],['🔍','Research competitors'],['👁️','Monitor my inbox']].map(([ic,lb])=>(
              <button key={lb} className="quick-prompt-btn" onClick={()=>sendAiMessage(`${lb} on ${selectedPlatformMeta.label}`)}>{ic} {lb}</button>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT: Command Panel */}
      <div className="command-panel">
        <div className="command-panel-header">
          <span className="command-panel-title">Command Center</span>
          <div className="auto-toggle" style={{width:150}}>
            <button className={`auto-toggle-btn ${automationMode==='manual'?'active':''}`} onClick={()=>setAutomationMode('manual')}>Manual</button>
            <button className={`auto-toggle-btn ${automationMode==='auto'?'active':''}`} onClick={()=>setAutomationMode('auto')}>Auto</button>
          </div>
        </div>

        <div className="platform-tabs">
          {platformMeta.map(p=>(
            <button key={p.id} className={`platform-tab ${selectedPlatform===p.id?'active':''}`} onClick={()=>setSelectedPlatform(p.id)}>
              <div className="platform-tab-dot"/>{p.label}
            </button>
          ))}
        </div>

        <div className="command-scroll custom-scroll">
          <div className="cmd-section">
            <div className="cmd-section-title">{isAI?'Prompt Studio':'Lead Scraper'}</div>
            <div className="cmd-field">
              <label className="cmd-label">{isAI?'Subject / Prompt':'Keyword / Niche'}</label>
              <input className="cmd-input" placeholder={isAI?'A cinematic landscape…':'e.g. fintech founders'} value={query} onChange={e=>setQuery(e.target.value)}/>
            </div>
            <div className="cmd-field">
              <label className="cmd-label">{isAI?'Variations':'Max Results'}</label>
              <input className="cmd-input small" type="number" value={maxResults} onChange={e=>setMaxResults(e.target.value)}/>
            </div>
            {(supports('scrape_results')||supports('search'))&&<button className="cmd-btn primary" onClick={()=>runPlatformAction('execute_deep_scrape')}>🔍 Deep Scrape</button>}
            {supports('scrape_results')&&<button className="cmd-btn" onClick={()=>runPlatformAction('scrape_profiles')}>Search Results Scrape →</button>}
            {supports('scrape_followers')&&<button className="cmd-btn" onClick={()=>runPlatformAction('scrape_followers')}>Extract Competitor Audience →</button>}
          </div>

          <div className="divider"/>

          <div className="cmd-section">
            <div className="cmd-section-title">{isAI?'AI Options':'Outreach'}</div>
            <div className="cmd-field">
              <label className="cmd-label">{isAI?'Subject / Focus':'Target Username / Email'}</label>
              <input className="cmd-input" placeholder={isAI?'e.g. hospital at sunset':'username or email'} value={targetUsername} onChange={e=>setTargetUsername(e.target.value)}/>
            </div>
            <div className="cmd-field">
              <label className="cmd-label">Goal</label>
              <input className="cmd-input" placeholder="e.g. Get a meeting" value={goal} onChange={e=>setGoal(e.target.value)}/>
            </div>
            <div className="cmd-field">
              <label className="cmd-label">Tone</label>
              <input className="cmd-input" placeholder="e.g. Casual and brief" value={tone} onChange={e=>setTone(e.target.value)}/>
            </div>
            <div className="cmd-field">
              <label className="cmd-label">{isAI?'Reference File':'Attachment'}</label>
              <input className="cmd-input" placeholder="/path/to/file" value={attachmentPath} onChange={e=>setAttachmentPath(e.target.value)}/>
            </div>

            {isGmail&&<>
              <div className="cmd-field"><label className="cmd-label">Subject</label><input className="cmd-input" placeholder="AI picks if empty" value={emailSubject} onChange={e=>setEmailSubject(e.target.value)}/></div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,marginBottom:8}}>
                <div><label className="cmd-label">CC</label><input className="cmd-input small" placeholder="cc@…" value={emailCc} onChange={e=>setEmailCc(e.target.value)}/></div>
                <div><label className="cmd-label">BCC</label><input className="cmd-input small" placeholder="bcc@…" value={emailBcc} onChange={e=>setEmailBcc(e.target.value)}/></div>
              </div>
              <div className="cmd-field"><label className="cmd-label">Signature</label><textarea className="cmd-input" rows={2} style={{resize:'none'}} placeholder={"Best,\nYour Name"} value={emailSignature} onChange={e=>setEmailSignature(e.target.value)}/></div>
              <div style={{display:'flex',gap:5,marginBottom:5}}>
                <input className="cmd-input" style={{flex:1}} placeholder="Search Gmail…" value={gmailSearchQuery} onChange={e=>setGmailSearchQuery(e.target.value)}/>
                <button className="cmd-btn" style={{width:'auto',padding:'0 10px',marginBottom:0}} onClick={()=>runPlatformAction('gmail_search')}>🔍</button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:4,marginBottom:8}}>
                <button className="cmd-btn" style={{fontSize:10,padding:'6px 3px',marginBottom:0}} onClick={()=>runPlatformAction('gmail_get_context')}>📬 Inbox</button>
                <button className="cmd-btn" style={{fontSize:10,padding:'6px 3px',marginBottom:0}} onClick={()=>runPlatformAction('gmail_get_profile')}>👤 Profile</button>
                <button className="cmd-btn" style={{fontSize:10,padding:'6px 3px',marginBottom:0}} onClick={()=>runPlatformAction('gmail_reply')}>↩️ Reply</button>
              </div>
            </>}

            {supports('send_message')&&<>
              <button className="cmd-btn primary" onClick={()=>runPlatformAction(isGmail?'auto_dm':'auto_dm_contact')}>{isGmail?'✉️ Auto-Email':'💬 DM Contact'}</button>
              {!isGmail&&<button className="cmd-btn secondary" onClick={()=>runPlatformAction('auto_dm_new')}>💬 DM New Person</button>}
              {supports('send_image_dm')&&<button className="cmd-btn" onClick={()=>runPlatformAction('send_image_dm')}>🖼️ DM with Image</button>}
            </>}
            {isAI&&supports('ask')&&<button className="cmd-btn primary" onClick={()=>runPlatformAction('ask')}>💬 Ask Question</button>}
            {isAI&&supports('generate_image')&&<button className="cmd-btn secondary" onClick={()=>runPlatformAction('generate_image')}>🎨 Generate Image</button>}
            {isAI&&supports('upload_to_ai')&&<button className="cmd-btn" onClick={()=>runPlatformAction('upload_to_ai')}>📤 Upload Image to AI</button>}
            {isAI&&supports('generate_and_post')&&<button className="cmd-btn" onClick={()=>runPlatformAction('generate_and_post')}>🎨→📲 Generate &amp; Post</button>}
            {isAI&&supports('generate_and_dm')&&<button className="cmd-btn" onClick={()=>runPlatformAction('generate_and_dm')}>🎨→💬 Generate &amp; DM</button>}
            {supports('like_post')&&<button className="cmd-btn" onClick={()=>runPlatformAction('like_post')}>❤️ Like Post</button>}
            {supports('engage_post')&&<button className="cmd-btn" onClick={()=>runPlatformAction('engage_post')}>💬 AI Comment</button>}
            {supports('follow_user')&&<button className="cmd-btn" onClick={()=>runPlatformAction('follow_user')}>➕ Follow User</button>}
            {isLI&&supports('connect_swn')&&<>
              <button className="cmd-btn" onClick={()=>runPlatformAction('connect_swn')}>🤝 Connect (No Note)</button>
              <button className="cmd-btn" onClick={()=>runPlatformAction('connect_sn')}>🤝 Connect (With Note)</button>
            </>}
            {supports('publish_post')&&<button className="cmd-btn" onClick={()=>runPlatformAction('auto_post')}>📝 Auto-Post</button>}
            {supports('download_image')&&<button className="cmd-btn" onClick={()=>runPlatformAction('download_image')}>⬇️ Download Image</button>}
            {isWA&&<>
              {supports('open_status')&&<button className="cmd-btn" onClick={()=>runPlatformAction('open_status')}>👁️ View Status</button>}
              {supports('post_status')&&<button className="cmd-btn" onClick={()=>runPlatformAction('post_status')}>📸 Post Status</button>}
            </>}
          </div>

          {WORKFLOW_PRESETS.filter(p=>({find_leads:supports('scrape_results'),scrape_profiles:supports('scrape_results'),follow_user:supports('follow_user'),send_message:supports('send_message'),follow_and_message:supports('follow_user')&&supports('send_message'),lead_and_message:supports('scrape_results')&&supports('message_batch'),map_contacts:supports('map_contacts')})[p.id]).length>0&&<>
            <div className="divider"/>
            <div className="cmd-section">
              <div className="cmd-section-title">Workflow Presets</div>
              <div className="preset-grid">
                {WORKFLOW_PRESETS.filter(p=>({find_leads:supports('scrape_results'),scrape_profiles:supports('scrape_results'),follow_user:supports('follow_user'),send_message:supports('send_message'),follow_and_message:supports('follow_user')&&supports('send_message'),lead_and_message:supports('scrape_results')&&supports('message_batch'),map_contacts:supports('map_contacts')})[p.id]).map(p=>(
                  <button key={p.id} className="preset-btn" onClick={()=>runPlatformAction(p.id)}>
                    <span className="preset-btn-label">{p.label}</span>
                    <span className="preset-btn-desc">{p.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </>}

          <div className="divider"/>
          <div className="cmd-section">
            <div className="cmd-section-title">Bulk Actions</div>
            {supports('message_batch')&&<button className="cmd-btn" onClick={()=>runPlatformAction('bulk_dm_csv')}>📋 Bulk {isGmail?'Email':'DM'} from CSV</button>}
            {supports('engage_batch')&&<button className="cmd-btn" onClick={()=>runPlatformAction('bulk_engage_csv')}>📋 Bulk Engage from CSV</button>}
            {supports('follow_batch')&&<button className="cmd-btn" onClick={()=>runPlatformAction('bulk_follow_csv')}>📋 Bulk Follow from CSV</button>}
          </div>
        </div>
      </div>
    </div>
  );
}


      {/* 1. Full-Height AI Chat Section (The "Home Screen") */}
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
