import { useState, useEffect, useRef } from 'react';
import './index.css';

const parseUsernamesFromCsv = (text) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return [];
  }

  return lines
    .slice(1)
    .map((line) => {
      const firstCol = line.split(',')[0];
      return firstCol ? firstCol.replace(/^["'@]+|["']+$/g, '').trim() : '';
    })
    .filter(Boolean);
};

// Pure SVG Icons
const InstagramIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm5.25-8.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"/>
  </svg>
);

const LinkedinIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
  </svg>
);

const SettingsIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm9.953-2.915a10.021 10.021 0 0 0-.256-1.545l-2.02-.387a7.025 7.025 0 0 0-.825-1.996l1.246-1.637a9.972 9.972 0 0 0-1.092-1.092l-1.637 1.246a7.02 7.02 0 0 0-1.996-.826l-.387-2.02A10.02 10.02 0 0 0 13.441 2h-2.882a10.021 10.021 0 0 0-1.545.256l-.387 2.02a7.02 7.02 0 0 0-1.996.825l-1.637-1.246a9.972 9.972 0 0 0-1.092 1.092l1.246 1.637a7.02 7.02 0 0 0-.826 1.996l-2.02.387A10.02 10.02 0 0 0 2 10.559v2.882c.045.518.13 1.037.256 1.545l2.02.387a7.02 7.02 0 0 0 .825 1.996l-1.246 1.637c.3.393.633.766 1.092 1.092l1.637-1.246a7.02 7.02 0 0 0 1.996.826l.387 2.02c.508.126 1.027.211 1.545.256h2.882c.518-.045 1.037-.13 1.545-.256l.387-2.02a7.02 7.02 0 0 0 1.996-.825l1.637 1.246c.393-.3.766-.633 1.092-1.092l-1.246-1.637a7.02 7.02 0 0 0 .826-1.996l2.02-.387c.126-.508.211-1.027.256-1.545v-2.882zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/>
  </svg>
);

const XIcon = () => (<svg viewBox="0 0 24 24"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>);
const FacebookIcon = () => (<svg viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>);
const GmailIcon = () => (<svg viewBox="0 0 24 24"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>);
const SearchIcon = () => (<svg viewBox="0 0 24 24"><path d="M23.707 20.879l-5.632-5.632A9.972 9.972 0 0 0 20 9.999a10 10 0 1 0-10 10 9.972 9.972 0 0 0 5.247-1.925l5.632 5.632a2 2 0 1 0 2.828-2.828ZM2 9.999a8 8 0 1 1 8 8 8.01 8.01 0 0 1-8-8Z"/></svg>);

const UniversalPlatformModule = ({ platformId, title, activeTask, progress, onStart, onStop }) => {
  const [targetSearch, setTargetSearch] = useState('tech');
  const [targetUser, setTargetUser] = useState('');
  const [goal, setGoal] = useState('Get a meeting');
  const [tone, setTone] = useState('Casual and brief');
  const [attachmentAsset, setAttachmentAsset] = useState('');
  const [maxLimit, setMaxLimit] = useState(15);
  const [bulkLimit, setBulkLimit] = useState(10);
  const [minFollowers, setMinFollowers] = useState('');
  const [maxFollowers, setMaxFollowers] = useState('');
  const [csvUsernames, setCsvUsernames] = useState([]);
  const [csvFileLabel, setCsvFileLabel] = useState('');
  const [followBeforeDM, setFollowBeforeDM] = useState(false);
  const fileInputRef = useRef(null);

  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target.result || '');
      const list = parseUsernamesFromCsv(text);
      setCsvUsernames(list);
      setCsvFileLabel(list.length > 0 ? `${file.name} • ${list.length} usernames loaded` : `${file.name} • no usernames found`);
    };
    reader.readAsText(file);
    e.target.value = null; // reset for same file uploads
  };

  const startCsvAction = (type) => {
    if (csvUsernames.length === 0) {
      return;
    }

    const limit = Math.min(bulkLimit, csvUsernames.length);
    const limitedUsernames = csvUsernames.slice(0, limit);

    onStart('engage', `${platformId}_${type}`, {
      usernameList: limitedUsernames,
      userGoal: goal,
      tonePrompt: tone,
      attachmentUrl: attachmentAsset,
      maxLimit: limit,
      followFirst: followBeforeDM && type.includes('dm'),
    });
  };
  
  return (
    <>
      <div className="section">
        <span className="section-title">{title} - Lead Scraper Engine</span>
        <div className="card">
          <div className="input-group">
            <label>Target Keyword/Niche</label>
            <input type="text" className="input-field" value={targetSearch} onChange={(e)=>setTargetSearch(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Max Profiles to Scrape</label>
            <input type="number" className="input-field" value={maxLimit} onChange={(e)=>setMaxLimit(parseInt(e.target.value)||1)} min="1" max="1000" />
          </div>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
            <div className="input-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Min Followers</label>
              <input type="number" className="input-field" value={minFollowers} onChange={(e)=>setMinFollowers(e.target.value)} placeholder="e.g. 1000" min="0" />
            </div>
            <div className="input-group" style={{ flex: 1, marginBottom: 0 }}>
              <label>Max Followers</label>
              <input type="number" className="input-field" value={maxFollowers} onChange={(e)=>setMaxFollowers(e.target.value)} placeholder="e.g. 50000" min="0" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <button disabled={activeTask !== null} className="btn-primary" onClick={() => onStart('scrape', `${platformId}_scrape`, { hashtag: targetSearch, maxLimit, minFollowers: minFollowers ? parseInt(minFollowers) : null, maxFollowers: maxFollowers ? parseInt(maxFollowers) : null })}>
              Execute Deep Scrape
            </button>
            {activeTask === 'scrape' && (
              <button className="btn-primary" style={{ backgroundColor: 'var(--apple-red)' }} onClick={onStop}>
                STOP
              </button>
            )}
          </div>
          {activeTask === 'scrape' && progress.total > 0 && typeof progress.current !== 'undefined' && (
             <div style={{ width: '100%', marginTop: '10px' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#888', marginBottom: '4px' }}>
                 <span>Scraping...</span>
                 <span>{progress.current} / {progress.total}</span>
               </div>
               <div style={{ width: '100%', backgroundColor: '#222', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                 <div style={{ width: `${Math.min(100, Math.max(0, (progress.current / progress.total) * 100))}%`, backgroundColor: 'var(--accent-color)', height: '100%', transition: 'width 0.3s ease' }}></div>
               </div>
             </div>
          )}
        </div>
      </div>

      <div className="section">
        <span className="section-title">{title} - Auto-Engagement Suite</span>
        <div className="card">
          <div className="input-group">
            <label>Target Username</label>
            <input type="text" className="input-field" value={targetUser} onChange={(e)=>setTargetUser(e.target.value)} />
          </div>
          <div className="input-group">
            <label>LLM Goal (For DMs/Comments)</label>
            <input type="text" className="input-field" value={goal} onChange={(e)=>setGoal(e.target.value)} />
          </div>
          <div className="input-group">
            <label>LLM Tone</label>
            <input type="text" className="input-field" value={tone} onChange={(e)=>setTone(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Attachment Asset Path (Optional)</label>
            <input type="text" className="input-field" placeholder="/absolute/path/to/image.png" value={attachmentAsset} onChange={(e)=>setAttachmentAsset(e.target.value)} />
          </div>
          <div className="input-group">
            <label>Feed Usernames From CSV</label>
            <input type="file" accept=".csv" ref={fileInputRef} style={{ display: 'none' }} onChange={handleCsvUpload} />
            <button disabled={activeTask !== null} className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
              Upload Username CSV
            </button>
            <div className="helper-text">
              {csvFileLabel || csvUsernames.length > 0 ? `${csvUsernames.length} usernames loaded` : 'Use a CSV where the first column contains usernames.'}
            </div>
          </div>
          
          {/* Bulk Action Settings */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px', padding: '10px', backgroundColor: '#1a1a1a', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '12px', color: '#aaa' }}>Bulk Limit:</label>
              <input 
                type="number" 
                style={{ width: '60px', padding: '4px 8px', background: '#222', border: '1px solid #333', borderRadius: '4px', color: '#fff', fontSize: '12px' }}
                value={bulkLimit} 
                onChange={(e)=>setBulkLimit(Math.max(1, parseInt(e.target.value)||1))} 
                min="1" 
                max="100"
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#aaa', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={followBeforeDM} 
                onChange={(e) => setFollowBeforeDM(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              Follow first, then DM
            </label>
          </div>

          {/* Single Actions */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
            <button disabled={activeTask !== null} className="btn-primary" onClick={() => onStart('engage', `${platformId}_dm`, { username: targetUser, userGoal: goal, tonePrompt: tone, attachmentUrl: attachmentAsset, followFirst: followBeforeDM })}>
              Auto-DM
            </button>
            <button disabled={activeTask !== null} className="btn-primary" onClick={() => onStart('engage', `${platformId}_engage`, { username: targetUser, userGoal: goal, tonePrompt: tone })}>
              Like + AI Comment
            </button>
            <button disabled={activeTask !== null} className="btn-primary" onClick={() => onStart('engage', `${platformId}_follow`, { username: targetUser })}>
              Follow User
            </button>
            <button disabled={activeTask !== null} className="btn-primary" onClick={() => onStart('engage', `${platformId}_post`, { userGoal: goal, tonePrompt: tone, attachmentUrl: attachmentAsset })}>
              Auto-Post
            </button>
            {activeTask === 'engage' && (
              <button className="btn-primary" style={{ backgroundColor: 'var(--apple-red)' }} onClick={onStop}>
                STOP
              </button>
            )}
          </div>
          
          {/* Bulk Actions - Only show if CSV loaded */}
          {csvUsernames.length > 0 && (
            <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#1a1a1a', borderRadius: '8px', border: '1px solid #333' }}>
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Bulk Actions ({Math.min(bulkLimit, csvUsernames.length)} of {csvUsernames.length} users)
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button disabled={activeTask !== null} className="btn-secondary" onClick={() => startCsvAction('csv_dm')} style={{ backgroundColor: followBeforeDM ? '#4a4a2a' : undefined }}>
                  {followBeforeDM ? 'Follow + DM' : 'Bulk DM'}
                </button>
                <button disabled={activeTask !== null} className="btn-secondary" onClick={() => startCsvAction('csv_engage')}>
                  Bulk Engage
                </button>
                <button disabled={activeTask !== null} className="btn-secondary" onClick={() => startCsvAction('csv_follow')}>
                  Bulk Follow
                </button>
              </div>
            </div>
          )}
          {activeTask === 'engage' && progress.total > 0 && typeof progress.current !== 'undefined' && (
             <div style={{ width: '100%', marginTop: '10px' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#888', marginBottom: '4px' }}>
                 <span>Working...</span>
                 <span>{progress.current} / {progress.total}</span>
               </div>
               <div style={{ width: '100%', backgroundColor: '#222', height: '6px', borderRadius: '3px', overflow: 'hidden' }}>
                 <div style={{ width: `${Math.min(100, Math.max(0, (progress.current / progress.total) * 100))}%`, backgroundColor: 'var(--accent-color)', height: '100%', transition: 'width 0.3s ease' }}></div>
               </div>
             </div>
          )}
        </div>
      </div>
    </>
  );
};

function App() {
  const [tab, setTab] = useState('instagram');
  const [activeTask, setActiveTask] = useState(null); // 'scrape' or 'engage'
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  
  // License state
  const [licenseStatus, setLicenseStatus] = useState('checking');
  const [licenseCode, setLicenseCode] = useState('');
  const [serverUrl, setServerUrl] = useState('http://localhost:8080');
  const [showLicenseModal, setShowLicenseModal] = useState(false);
  
  // Load saved server URL on mount
  useEffect(() => {
    chrome.storage.local.get(['cherry_server_url'], (result) => {
      if (result.cherry_server_url) {
        setServerUrl(result.cherry_server_url);
      }
    });
  }, []);
  
  useEffect(() => {
    // Check license status on mount
    checkLicense();
  }, []);
  
  const checkLicense = async () => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ action: 'CHECK_LICENSE' }, (res) => {
        if (res?.isActive) {
          setLicenseStatus('active');
          setShowLicenseModal(false);
        } else {
          setLicenseStatus(res?.status || 'inactive');
          setShowLicenseModal(true);
        }
      });
    }
  };
  
  const [isActivating, setIsActivating] = useState(false);
  
  const activateLicense = async () => {
    if (!licenseCode || !serverUrl) return;
    
    // Save server URL
    await chrome.storage.local.set({ cherry_server_url: serverUrl });
    
    setIsActivating(true);
    setStatusMsg('Connecting to license server...');
    setErrorMsg('');
    
    console.log('[Cherry UI] Starting activation with code:', licenseCode, 'server:', serverUrl);
    
    chrome.runtime.sendMessage({ 
      action: 'ACTIVATE_LICENSE', 
      code: licenseCode,
      serverUrl: serverUrl
    }, (res) => {
      setIsActivating(false);
      console.log('[Cherry UI] Activation response:', res);
      
      if (chrome.runtime.lastError) {
        console.error('[Cherry UI] Runtime error:', chrome.runtime.lastError);
        setErrorMsg('Error: ' + chrome.runtime.lastError.message);
        return;
      }
      
      if (!res) {
        setErrorMsg('No response from background. Check console for errors.');
        return;
      }
      
      if (res.success) {
        setLicenseStatus('active');
        setShowLicenseModal(false);
        setStatusMsg('✓ License activated!');
        setErrorMsg('');
      } else {
        setErrorMsg(res.message || 'Activation failed. Is admin extension installed?');
      }
    });
  };
  
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      const listener = (msg) => {
        if (msg.action === 'PROGRESS') {
          setProgress({ current: msg.current, total: msg.total });
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => chrome.runtime.onMessage.removeListener(listener);
    }
  }, []);

  const startEngine = (taskCategory, type, customPayload) => {
    setActiveTask(taskCategory);
    setProgress({ current: 0, total: customPayload?.maxLimit || 15 });
    setStatusMsg('Waking engine...');
    setErrorMsg('');
    
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({
          action: 'START_ENGINE',
          type: type,
          payload: customPayload || {}
        }, (res) => {
          setActiveTask(null);
          setProgress({ current: 0, total: 0 });
          if (chrome.runtime.lastError) {
            setErrorMsg(chrome.runtime.lastError.message);
            setStatusMsg('');
          } else if (res?.status?.startsWith('Error')) {
            setErrorMsg(res.status);
            setStatusMsg('');
          } else {
            // CSV is downloaded by the service worker via chrome.downloads.download()
            // We just display the status here
            setStatusMsg(res?.status || 'Done.');
          }
        });
      } else {
        setTimeout(() => { setActiveTask(null); setStatusMsg('Simulated run ok.'); }, 2000);
      }
    } catch (e) {
      setActiveTask(null);
      setErrorMsg(e.toString());
      setStatusMsg('');
    }
  };

  const stopEngine = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ action: 'ABORT_ENGINE' });
      setStatusMsg('Aborting engine safely...');
      setActiveTask(null);
    }
  };

  return (
    <div className="app-container">
      <header>
        <div className="nav-bar" style={{ overflowX: 'auto', paddingBottom: '4px' }}>
          <button className={`nav-icon ${tab === 'instagram' ? 'active' : ''}`} onClick={() => { setTab('instagram'); setStatusMsg(''); setErrorMsg(''); }}>
            <InstagramIcon />
          </button>
          <button className={`nav-icon ${tab === 'twitter' ? 'active' : ''}`} onClick={() => { setTab('twitter'); setStatusMsg(''); setErrorMsg(''); }}>
            <XIcon />
          </button>
          <button className={`nav-icon ${tab === 'linkedin' ? 'active' : ''}`} onClick={() => { setTab('linkedin'); setStatusMsg(''); setErrorMsg(''); }}>
            <LinkedinIcon />
          </button>
          <button className={`nav-icon ${tab === 'facebook' ? 'active' : ''}`} onClick={() => { setTab('facebook'); setStatusMsg(''); setErrorMsg(''); }}>
            <FacebookIcon />
          </button>
          <button className={`nav-icon ${tab === 'gmail' ? 'active' : ''}`} onClick={() => { setTab('gmail'); setStatusMsg(''); setErrorMsg(''); }}>
            <GmailIcon />
          </button>
          <button className={`nav-icon ${tab === 'ddg' ? 'active' : ''}`} onClick={() => { setTab('ddg'); setStatusMsg(''); setErrorMsg(''); }}>
            <SearchIcon />
          </button>
          <button className={`nav-icon ${tab === 'settings' ? 'active' : ''}`} onClick={() => { setTab('settings'); setStatusMsg(''); setErrorMsg(''); }}>
            <SettingsIcon />
          </button>
        </div>
      </header>

      <div className="content-layer" style={{ overflowY: 'auto' }}>
        {errorMsg && <div className="error-box" style={{ marginBottom: '16px' }}>{errorMsg}</div>}
        {statusMsg && <div className="status-box" style={{ marginBottom: '16px' }}>{statusMsg}</div>}

        {tab === 'instagram' && (
          <UniversalPlatformModule platformId="ig" title="Instagram" activeTask={activeTask} progress={progress} onStart={startEngine} onStop={stopEngine} />
        )}

        {tab === 'linkedin' && (
          <UniversalPlatformModule platformId="li" title="LinkedIn" activeTask={activeTask} progress={progress} onStart={startEngine} onStop={stopEngine} />
        )}

        {tab === 'twitter' && (
          <UniversalPlatformModule platformId="twitter" title="X/Twitter" activeTask={activeTask} progress={progress} onStart={startEngine} onStop={stopEngine} />
        )}

        {tab === 'facebook' && (
          <UniversalPlatformModule platformId="fb" title="Facebook" activeTask={activeTask} progress={progress} onStart={startEngine} onStop={stopEngine} />
        )}

        {tab === 'gmail' && (
          <UniversalPlatformModule platformId="gmail" title="Gmail" activeTask={activeTask} progress={progress} onStart={startEngine} onStop={stopEngine} />
        )}

        {tab === 'ddg' && (
          <UniversalPlatformModule platformId="ddg" title="DuckDuckGo" activeTask={activeTask} progress={progress} onStart={startEngine} onStop={stopEngine} />
        )}

        {tab === 'settings' && (
          <div className="section">
            <span className="section-title">System Properties</span>
            <div className="card">
              <div className="input-group">
                <label>Stealth Engine Cooldowns</label>
                <input type="text" className="input-field" defaultValue="15s - 45s (Dynamic)" disabled />
              </div>
              <div className="input-group" style={{ marginTop: '12px' }}>
                <label>LLM Active Pipeline</label>
                <input type="text" className="input-field" defaultValue="Cherry AI Engine (TinyLlama GGUF)" disabled />
              </div>
              <div className="input-group" style={{ marginTop: '12px' }}>
                <label>License Server IP/URL</label>
                <input 
                  type="text" 
                  className="input-field" 
                  value={serverUrl} 
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://192.168.1.100:8080"
                />
                <p style={{ color: '#666', fontSize: '11px', marginTop: '4px' }}>
                  Enter the admin laptop's IP address (e.g., http://192.168.1.100:8080)
                </p>
              </div>
              <div style={{ marginTop: '12px' }}>
                <label>License Status: </label>
                <span style={{ 
                  color: licenseStatus === 'active' ? '#34C759' : 
                         licenseStatus === 'checking' ? '#FF9500' : '#FF3B30',
                  fontWeight: 'bold'
                }}>
                  {licenseStatus === 'active' ? '✓ ACTIVE' : 
                   licenseStatus === 'checking' ? '⏳ CHECKING' : 
                   licenseStatus === 'pending_activation' ? '⚠ PENDING ACTIVATION' :
                   licenseStatus === 'revoked' ? '❌ REVOKED' : '✗ INACTIVE'}
                </span>
              </div>
            </div>
          </div>
        )}
        
        {/* License Activation Modal */}
        {showLicenseModal && (
          <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              backgroundColor: '#1a1a1a',
              padding: '30px',
              borderRadius: '12px',
              width: '90%',
              maxWidth: '400px',
              textAlign: 'center'
            }}>
              <h2 style={{ color: '#007AFF', marginBottom: '20px' }}>🔐 License Required</h2>
              <p style={{ color: '#888', marginBottom: '20px', fontSize: '14px' }}>
                This extension requires activation. Please enter your license code or contact your administrator.
              </p>
              <div style={{ marginBottom: '15px' }}>
                <input
                  type="password"
                  placeholder="Enter license code"
                  value={licenseCode}
                  onChange={(e) => setLicenseCode(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px',
                    backgroundColor: '#2a2a2a',
                    border: '1px solid #333',
                    borderRadius: '6px',
                    color: '#fff',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <p style={{ color: '#666', fontSize: '12px', marginBottom: '15px' }}>
                Make sure the admin has started the license server on their laptop.
              </p>
              <button
                onClick={activateLicense}
                disabled={!licenseCode || !serverUrl || isActivating}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: licenseCode && serverUrl && !isActivating ? '#007AFF' : '#333',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '16px',
                  cursor: licenseCode && serverUrl && !isActivating ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold'
                }}
              >
                {isActivating ? 'Activating...' : 'Activate'}
              </button>
              
              {errorMsg && (
                <p style={{ color: '#FF3B30', marginTop: '15px', fontSize: '13px' }}>
                  {errorMsg}
                </p>
              )}
              {licenseStatus === 'revoked' && (
                <p style={{ color: '#FF3B30', marginTop: '15px', fontSize: '13px' }}>
                  ⚠️ Your license has been revoked. Please contact your administrator.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
