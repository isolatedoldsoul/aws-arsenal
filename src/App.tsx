/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Terminal as TerminalIcon, 
  Settings, 
  Play, 
  CheckCircle2, 
  Download, 
  FolderOpen, 
  FileText,
  ChevronDown,
  Activity,
  User,
  ShieldCheck,
  Search,
  Clock,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import TerminalComponent from './components/Terminal';
import { generateHtmlReport, triggerHtmlDownload } from './utils/htmlReport';

interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  message: string;
}


const HelpModal = ({ onClose }: { onClose: () => void }) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div className="bg-surface-dim border border-outline-variant/20 rounded-3xl max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between p-6 border-b border-outline-variant/20">
        <div className="flex items-center gap-3">
          <img src="/Cloud_Arsenal_logo.jpeg" alt="" className="w-8 h-8 rounded-lg object-cover" />
          <div>
            <h2 className="font-headline font-bold text-lg text-on-surface">Cloud Arsenal — AWS Console</h2>
            <p className="text-xs text-on-surface-variant">Quick Reference</p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 text-on-surface-variant hover:text-on-surface transition-colors rounded-lg hover:bg-surface-container-highest">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <div className="p-6 space-y-6">
        {/* Auth methods */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-widest text-primary mb-3">Authentication Methods</h3>
          <div className="space-y-2.5">
            {[
              { mode: 'IAM Keys', desc: 'Direct access key + secret. Best for CI/CD or service accounts.' },
              { mode: 'AWS SSO', desc: 'Browser device-code flow via your org SSO portal. Requires sso_start_url in config.' },
              { mode: 'Assume Role', desc: 'Cross-account access. Requires a base credential + target role ARN.' },
              { mode: 'Instance Profile', desc: 'Automatic on EC2/ECS — no config needed when running on AWS.' },
            ].map(({ mode, desc }) => (
              <div key={mode} className="flex gap-3 text-sm">
                <span className="font-mono text-primary shrink-0 w-36">{mode}</span>
                <span className="text-on-surface-variant">{desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* S3 Storage */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-widest text-primary mb-3">Report Storage (config.json)</h3>
          <div className="bg-surface-container-low rounded-xl p-4 font-mono text-xs text-on-surface-variant mb-3 space-y-0.5">
            <div><span className="text-tertiary">"s3_upload"</span><span>: {'{'}</span></div>
            <div className="pl-4"><span className="text-tertiary">"enabled"</span><span>: true,</span></div>
            <div className="pl-4"><span className="text-tertiary">"mode"</span><span>: </span><span className="text-yellow-400">"env"</span><span className="opacity-50">  // env | keys</span></div>
            <div className="pl-4"><span className="text-tertiary">"bucket"</span><span>: </span><span className="text-yellow-400">"your-bucket-name"</span><span>,</span></div>
            <div className="pl-4"><span className="text-tertiary">"region"</span><span>: </span><span className="text-yellow-400">"us-east-1"</span></div>
            <div><span>{'}'}</span></div>
          </div>
          <div className="space-y-2.5">
            {[
              { mode: 'env', desc: 'Server uses IAM role / env vars / ~/.aws credentials. Best for EC2 or ECS deployments.' },
              { mode: 'keys', desc: 'Add access_key_id + secret_access_key to config.json. Good for simple self-hosted setups.' },
              { mode: 'disabled', desc: 'Set enabled: false. Reports download only — no scan history is persisted.' },
            ].map(({ mode, desc }) => (
              <div key={mode} className="flex gap-3 text-sm">
                <span className="font-mono text-yellow-500 shrink-0 w-20">{mode}</span>
                <span className="text-on-surface-variant">{desc}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Config file note */}
        <section className="bg-surface-container-low rounded-xl p-4 text-sm text-on-surface-variant">
          <span className="material-symbols-outlined text-base align-middle mr-2 text-primary">info</span>
          <span>The <span className="font-mono text-on-surface">config.json</span> file is excluded from git. Copy <span className="font-mono text-on-surface">config.example.json</span> and fill in your values to get started.</span>
        </section>

        {/* GitHub */}
        <section className="flex items-center gap-3 pt-2 border-t border-outline-variant/20">
          <span className="material-symbols-outlined text-on-surface-variant text-base">open_in_new</span>
          <a href="https://github.com/isolatedoldsoul/aws-arsenal" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline text-sm">
            GitHub — Full setup and configuration guide
          </a>
        </section>
      </div>
    </div>
  </div>
);

const HistoryTab = ({ sessionID, onView }: { sessionID: string | null, onView: (runId: string) => void }) => {
  const [history, setHistory] = useState<any[]>([]);
  const [s3Configured, setS3Configured] = useState(true);
  const [hasProfile, setHasProfile] = useState(true);
  const [loading, setLoading] = useState(!!sessionID);

  useEffect(() => {
    if (!sessionID) { setLoading(false); return; }
    fetch(`/api/history?session_id=${sessionID}`)
      .then(r => r.json())
      .then(data => {
        setHistory(data.history || []);
        setHasProfile(data.has_profile !== false);
        setS3Configured(data.s3_configured !== false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [sessionID]);

  if (loading) return <div className="p-8 text-on-surface-variant">Loading history...</div>;
  if (!hasProfile) return <div className="p-8 text-on-surface-variant">Session expired — please re-authenticate to view history.</div>;
  if (!s3Configured) return (
    <div className="p-8 max-w-xl">
      <div className="bg-surface-container-low border border-outline-variant/20 rounded-2xl p-6 space-y-4">
        <div className="flex items-start gap-4">
          <span className="material-symbols-outlined text-3xl text-on-surface-variant mt-0.5">cloud_off</span>
          <div>
            <h3 className="font-bold text-on-surface mb-1">Report history is disabled</h3>
            <p className="text-sm text-on-surface-variant">Scan reports are not being saved. Configure S3 storage in <span className="font-mono text-on-surface">config.json</span> to persist history across sessions.</p>
          </div>
        </div>
        <div className="bg-surface-container-highest rounded-xl p-4 font-mono text-xs text-on-surface-variant space-y-0.5">
          <div><span className="text-tertiary">"s3_upload"</span><span>: {'{'}</span></div>
          <div className="pl-4"><span className="text-tertiary">"enabled"</span><span>: </span><span className="text-green-400">true</span><span>,</span></div>
          <div className="pl-4"><span className="text-tertiary">"mode"</span><span>: </span><span className="text-yellow-400">"env"</span><span className="opacity-50">  // env | keys</span></div>
          <div className="pl-4"><span className="text-tertiary">"bucket"</span><span>: </span><span className="text-yellow-400">"your-bucket"</span><span>,</span></div>
          <div className="pl-4"><span className="text-tertiary">"region"</span><span>: </span><span className="text-yellow-400">"us-east-1"</span></div>
          <div><span>{'}'}</span></div>
        </div>
        <p className="text-xs text-on-surface-variant">Click the <span className="material-symbols-outlined text-xs align-middle">help</span> icon in the toolbar for full setup instructions.</p>
      </div>
    </div>
  );

  return (
    <div className="bg-surface-container-low rounded-3xl p-8 shadow-2xl border border-outline-variant/10">
      <h2 className="font-headline font-bold text-2xl uppercase tracking-tight mb-6">Scan History</h2>
      {history.length === 0 ? <p className="text-on-surface-variant">No history found.</p> : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest border-b border-outline-variant/20">
              <th className="pb-4">Date</th>
              <th className="pb-4">Run ID</th>
              <th className="pb-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h: any) => (
              <tr key={h.run_id} className="border-b border-outline-variant/10">
                <td className="py-4 text-xs font-mono">{h.date}</td>
                <td className="py-4 text-xs font-mono">{h.run_id}</td>
                <td className="py-4">
                  <button 
                    onClick={() => onView(h.run_id)}
                    className="text-primary hover:underline font-bold text-xs"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const LS_SSO_KEY = 'cloudops_sso_config';
const LS_SESSION_KEY = 'cloudops_session_id';

function loadSsoFromStorage() {
  try { return JSON.parse(localStorage.getItem(LS_SSO_KEY) || '{}'); } catch { return {}; }
}

export default function App() {
  const [sessionID, setSessionID] = useState<string | null>(null);

  // On mount: try to restore previous session from localStorage (page refresh recovery)
  useEffect(() => {
    const saved = localStorage.getItem(LS_SESSION_KEY);
    if (saved) {
      fetch(`/api/session/status?session_id=${saved}`)
        .then(r => r.json())
        .then(data => {
          if (data.valid) {
            setSessionID(saved);
            setIsAuthenticated(true);
            setIdentity(data.identity);
            setShowAuthFields(false);
            fetchAccounts(saved);
          } else {
            localStorage.removeItem(LS_SESSION_KEY);
            return fetch('/api/session/init').then(r => r.json()).then(d => setSessionID(d.session_id));
          }
        })
        .catch(() => {
          fetch('/api/session/init').then(r => r.json()).then(d => setSessionID(d.session_id));
        });
    } else {
      fetch('/api/session/init')
        .then(r => r.json())
        .then(data => setSessionID(data.session_id));
    }
  }, []);

  // SSO config — localStorage first, fallback to server config
  const [ssoConfig, setSsoConfig] = useState(() => {
    const saved = loadSsoFromStorage();
    return {
      ssoUrl: saved.ssoUrl || '',
      ssoSessionName: saved.ssoSessionName || '',
      ssoRegion: saved.ssoRegion || 'us-east-1',
    };
  });

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(cfg => {
        setSsoConfig(prev => ({
          ssoUrl: prev.ssoUrl || cfg.aws?.sso_start_url || '',
          ssoSessionName: prev.ssoSessionName || cfg.aws?.sso_session_name || '',
          ssoRegion: prev.ssoRegion || cfg.aws?.sso_region || 'us-east-1',
        }));
      })
      .catch(() => {});
  }, []);
  const [runId, setRunId] = useState<string | null>(null);
  const [showSsoTerminal, setShowSsoTerminal] = useState(false);
  const [ssoVerificationUrl, setSsoVerificationUrl] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const sessionIDRef = useRef<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [identity, setIdentity] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedAccounts, setScannedAccounts] = useState<Set<string>>(new Set());
  const [showHelp, setShowHelp] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [isGeneratingHtml, setIsGeneratingHtml] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [systemMetrics, setSystemMetrics] = useState({
    cpu: 12,
    mem: 45,
    latency: 85
  });
  const [selectedFinding, setSelectedFinding] = useState<any | null>(null);
  const [scanOptions, setScanOptions] = useState({
    service: 'KMS Zombie Keys',
    scope: 'all',
    accountID: '',
    idleDays: 30,
    verbose: true,
    skipS3: false,
    authMode: 'IAM' as 'IAM' | 'SSO' | 'SSO_ROLE',
    orgAccountId: '',
    managementRoleName: 'OrganizationAccountAccessRole',
    externalId: '',
    accessKey: '',
    secretKey: '',
    sessionToken: '',
    selectedAccounts: [] as string[],
    targetRoleName: 'OrganizationAccountAccessRole',
    regionMode: 'default' as 'default' | 'all' | 'custom',
    customRegions: '' as string,
    roleName: '',
    userCategory: 'Users' as 'Users' | 'CloudOps' | 'GlobalAdmin',
  });

  const [findings, setFindings] = useState<any[]>([]);
  const [metrics, setMetrics] = useState({
    total: 0,
    optimized: 0,
    savings: "$0.00",
    risk: "Low"
  });
  const [availableAccounts, setAvailableAccounts] = useState<any[]>([]);
  const [accountSummaries, setAccountSummaries] = useState<any[]>([]);
  const [isFetchingAccounts, setIsFetchingAccounts] = useState(false);
  const [showIndividualAccounts, setShowIndividualAccounts] = useState(false);
  const [showExternalId, setShowExternalId] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'logs' | 'results' | 'dashboard' | 'history'>('config');
  const [accountSearch, setAccountSearch] = useState('');
  const [accountPage, setAccountPage] = useState(1);
  const ACCOUNTS_PER_PAGE = 50;
  const [showAuthFields, setShowAuthFields] = useState(true);

  const logEndRef = useRef<HTMLDivElement>(null);

  // System metrics simulation
  useEffect(() => {
    const interval = setInterval(() => {
      setSystemMetrics({
        cpu: Math.floor(Math.random() * 15) + 5,
        mem: Math.floor(Math.random() * 10) + 40,
        latency: Math.floor(Math.random() * 50) + 60
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Keep ref in sync so reconnect handler can access current sessionID
  useEffect(() => { sessionIDRef.current = sessionID; }, [sessionID]);

  // Socket connection for summary
  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io();
      // Re-join session room after any reconnect (e.g. SSO terminal kept browser open)
      socketRef.current.on('connect', () => {
        if (sessionIDRef.current) {
          socketRef.current!.emit('join_session', { session_id: sessionIDRef.current });
        }
      });
    }
    const socket = socketRef.current;

    // Join session room
    if (sessionID) {
      socket.emit('join_session', { session_id: sessionID });
    }

    const handleSummaryResult = (data: any) => {
      setAccountSummaries(prev => {
        const existing = prev.findIndex(s => s.account_id === data.account_id);
        if (existing >= 0) {
          const newSummaries = [...prev];
          newSummaries[existing] = data;
          return newSummaries;
        }
        return [...prev, data];
      });
    };

    socket.on('summary_result', handleSummaryResult);

    return () => {
      socket.off('summary_result', handleSummaryResult);
    };
  }, [sessionID]);

  // Terminal login simulation
  const handleLogin = async () => {
    setIsAuthenticating(true);
    setLogs([]);
    
    const addLogEntry = (msg: string, level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR' = 'INFO') => {
      setLogs(prev => [...prev, {
        timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
        level,
        message: msg
      }]);
    };

    addLogEntry('Initiating AWS authentication sequence...', 'INFO');
    
    // Initial steps
    if (scanOptions.authMode === 'SSO_ROLE' && scanOptions.userCategory !== 'Users' && !scanOptions.orgAccountId) {
      addLogEntry('Error: Org Account ID is required for Role Switching mode.', 'ERROR');
      setIsAuthenticating(false);
      return;
    }

    try {
      // Create session with SSO config so backend knows sso_url, sso_region for account discovery
      const sessionRes = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_mode: scanOptions.authMode,
          access_key: scanOptions.accessKey,
          secret_key: scanOptions.secretKey,
          session_token: scanOptions.sessionToken,
          sso_url: ssoConfig.ssoUrl,
          sso_session_name: ssoConfig.ssoSessionName,
          sso_region: ssoConfig.ssoRegion,
          role_name: scanOptions.roleName || undefined,
          external_id: scanOptions.externalId || undefined,
          user_category: scanOptions.userCategory,
        })
      });
      const sessionData = await sessionRes.json();
      const newSessionId = sessionData.session_id;
      setSessionID(newSessionId);

      // Save SSO config to localStorage so it pre-fills next visit
      if (scanOptions.authMode === 'SSO' || scanOptions.authMode === 'SSO_ROLE') {
        localStorage.setItem(LS_SSO_KEY, JSON.stringify(ssoConfig));
      }

      if (scanOptions.authMode === 'SSO' || scanOptions.authMode === 'SSO_ROLE') {
        addLogEntry('Starting AWS SSO device authorization...', 'INFO');
        try {
          const ssoRes = await fetch(`/api/auth/sso-start?session_id=${newSessionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          const ssoData = await ssoRes.json();
          if (!ssoRes.ok) throw new Error(ssoData.detail || 'Failed to start SSO');
          setSsoVerificationUrl(ssoData.verificationUrl);
          addLogEntry('Authorize in your browser, then return here — validating automatically.', 'INFO');
          // Open browser automatically
          window.open(ssoData.verificationUrl, '_blank');
          // Listen for backend to signal token received
          socketRef.current?.once('sso_authorized', async () => {
            setSsoVerificationUrl(null);
            await validateSession(newSessionId, addLogEntry);
          });
          socketRef.current?.once('sso_error', (data: any) => {
            setSsoVerificationUrl(null);
            addLogEntry(`SSO error: ${data.error}`, 'ERROR');
            setIsAuthenticating(false);
          });
        } catch (e: any) {
          addLogEntry(`SSO start failed: ${e.message}`, 'ERROR');
          setIsAuthenticating(false);
        }
        return;
      }

      // If IAM, validate immediately
      await validateSession(newSessionId, addLogEntry);
    } catch (e: any) {
      addLogEntry(`Error: Network error during authentication: ${e.message}`, 'ERROR');
      setIsAuthenticating(false);
      setIdentity(null);
    }
  };

  const validateSession = async (sid: string, addLogEntry: any) => {
    try {
      addLogEntry('Validating credentials with AWS STS...', 'INFO');
      const res = await fetch('/api/auth/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sid })
      });
      const data = await res.json();
      
      if (data.authenticated) {
        addLogEntry(`✓ Identity verified: ${data.identity}`, 'SUCCESS');
        addLogEntry(`✓ Authentication context initialized.`, 'SUCCESS');
        setIsAuthenticated(true);
        setIdentity(data.identity);
        setShowAuthFields(false);
        localStorage.setItem(LS_SESSION_KEY, sid);

        if (scanOptions.scope === 'all') {
          fetchAccounts(sid);
        }
      } else {
        addLogEntry(`Error: ${data.error || 'Authentication failed.'}`, 'ERROR');
        setIsAuthenticated(false);
        setIdentity(null);
      }
    } catch (e: any) {
      addLogEntry(`Error: Network error during validation: ${e.message}`, 'ERROR');
      setIsAuthenticated(false);
      setIdentity(null);
    } finally {
      setIsAuthenticating(false);
    }
  };

  const fetchAccounts = async (sid: string = sessionID) => {
    setIsFetchingAccounts(true);
    const addLogEntry = (msg: string, level: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR' = 'INFO') => {
      setLogs(prev => [...prev, {
        timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
        level,
        message: msg
      }]);
    };

    addLogEntry('Fetching AWS Organization accounts...', 'INFO');
    try {
      const res = await fetch(`/api/accounts?session_id=${sid}`);
      const data = await res.json();
      if (data.accounts) {
        const accs = data.accounts.map((acc: any) => ({ id: acc.id, name: acc.name }));
        setAvailableAccounts(accs);
        addLogEntry(`✓ Discovered ${data.accounts.length} accounts.`, 'SUCCESS');

        // Pre-populate summary tab with loading placeholders so cards show immediately
        setAccountSummaries(accs.map((acc: any) => ({
          account_id: acc.id,
          account_name: acc.name,
          status: 'loading',
          current_month_spend: 0,
          last_month_spend: 0,
          change_pct: 0,
          top_services: [],
          resource_counts: { ec2: 0, s3: 0, rds: 0 }
        })));

        // Start summary fetch
        setActiveTab('dashboard');
        fetch('/api/accounts/summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sid,
            accounts: accs
          })
        });
      } else if (data.error) {
        addLogEntry(`Error fetching accounts: ${data.error}`, 'ERROR');
      }
    } catch (e: any) {
      console.error("Failed to fetch accounts", e);
      addLogEntry(`Error: Network error while fetching accounts.`, 'ERROR');
    } finally {
      setIsFetchingAccounts(false);
    }
  };

  // Socket connection
  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io();
    }
    const socket = socketRef.current;
    
    const handleScanLog = (data: any) => {
      if (data.run_id === runId) {
        const [level, ...msgParts] = data.log.split(' | ');
        const message = msgParts.join(' | ');
        setLogs(prev => [...prev, {
          timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
          level: (level.trim() as any) || 'INFO',
          message: message || data.log
        }]);

        // Track scanned accounts from "Scanning account X..." log lines
        const scanningMatch = data.log.match(/Scanning account (\d+)/);
        if (scanningMatch) {
          setScannedAccounts(prev => new Set([...prev, scanningMatch[1]]));
        }
        
        if (data.log.includes('SUCCESS | Scan completed') || data.log.includes('ERROR |') || data.log.includes('WARN | Scan aborted')) {
          setIsScanning(false);
          // Fetch final status
          fetch(`/api/scan/${runId}/status?session_id=${sessionID}`)
            .then(res => res.json())
            .then(statusData => {
              setFindings(statusData.results || []);
              setMetrics(statusData.metrics || { total: 0, optimized: 0, savings: "$0.00", risk: "Low" });
              if (statusData.status === 'completed') {
                setActiveTab('results');
              }
            });
        }
      }
    };

    const handleScanProgress = (data: any) => {
      if (data.run_id === runId) {
        setProgress(data.progress);
      }
    };

    socket.on('scan_log', handleScanLog);
    socket.on('scan_progress', handleScanProgress);

    return () => {
      socket.off('scan_log', handleScanLog);
      socket.off('scan_progress', handleScanProgress);
    };
  }, [runId]);

  const startScan = async () => {
    const hasManualCreds = scanOptions.authMode === 'IAM' 
      ? (scanOptions.accessKey && scanOptions.secretKey)
      : (scanOptions.authMode === 'SSO' || scanOptions.authMode === 'SSO_ROLE')
        ? (scanOptions.sessionToken || (scanOptions.accessKey && scanOptions.secretKey))
        : false;

    if (!isAuthenticated && !hasManualCreds) return;
    try {
      // Resolve active session — authenticated users reuse their session, no need to recreate
      let activeSid = sessionID;
      if (!isAuthenticated) {
        const sessionRes = await fetch('/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            auth_mode: scanOptions.authMode,
            access_key: scanOptions.accessKey,
            secret_key: scanOptions.secretKey,
            session_token: scanOptions.sessionToken,
            role_name: scanOptions.roleName || undefined,
            user_category: scanOptions.userCategory,
          })
        });
        const sessionData = await sessionRes.json();
        activeSid = sessionData.session_id;
        setSessionID(activeSid);
      }

      // Resolve regions
      const regions = scanOptions.regionMode === 'all'
        ? ['all']
        : scanOptions.regionMode === 'custom'
          ? scanOptions.customRegions.split(',').map(r => r.trim()).filter(Boolean)
          : [];

      // Start scan
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: activeSid,
          services: [scanOptions.service],
          scope: scanOptions.scope,
          accounts: scanOptions.scope === 'all'
            ? scanOptions.selectedAccounts
            : scanOptions.accountID ? [scanOptions.accountID] : [],
          idle_days: scanOptions.idleDays,
          regions,
        })
      });
      if (res.ok) {
        const data = await res.json();
        setRunId(data.run_id);
        setIsScanning(true);
        setScannedAccounts(new Set());
        setProgress(0);
        setLogs([]);
        setActiveTab('logs');
      }
    } catch (e) {
      console.error("Failed to start scan", e);
    }
  };

  const handleDownloadReport = () => {
    if (!runId || !sessionID) return;
    window.open(`/api/scan/${runId}/report/xlsx?session_id=${sessionID}`, '_blank');
  };

  const handleS3Upload = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      setLogs(prev => [...prev, {
        timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
        level: 'SUCCESS',
        message: 'Artifacts synchronized to S3 history bucket.'
      }]);
    }, 2500);
  };

  const stopScan = async () => {
    setIsScanning(false);
    setLogs(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
      level: 'WARN',
      message: 'Stopping scan engine...'
    }]);
    
    if (runId) {
      try {
        await fetch(`/api/scan/${runId}/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionID })
        });
      } catch (error) {
        console.error('Failed to stop scan on server:', error);
      }
    }
  };

  const resetScan = () => {
    setIsScanning(false);
    setProgress(0);
    setFindings([]);
    setMetrics({
      total: 0,
      optimized: 0,
      savings: "$0.00",
      risk: "Low"
    });
    setActiveTab('config');
    setLogs(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString('en-GB', { hour12: false }),
      level: 'INFO',
      message: 'Scan engine reset. Ready for new configuration.'
    }]);
  };

  const downloadCSV = () => {
    if (findings.length === 0) return;
    
    const headers = ['Resource ID', 'Type', 'Account', 'Status', 'Optimization', 'Action'];
    const csvContent = [
      headers.join(','),
      ...findings.map(f => [
        `"${f.id}"`,
        `"${f.type}"`,
        `"${f.account}"`,
        `"${f.status}"`,
        `"${f.optimization}"`,
        `"${f.action}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `aws-scan-results-${sessionID || Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadHTMLReport = async () => {
    if (findings.length === 0) return;
    setIsGeneratingHtml(true);
    try {
      const html = await generateHtmlReport(findings, { risk: metrics.risk }, scanOptions.service, identity);
      triggerHtmlDownload(html, scanOptions.service);
    } finally {
      setIsGeneratingHtml(false);
    }
  };

  return (
    <div className="flex h-screen bg-surface text-on-surface font-body selection:bg-primary/30 antialiased overflow-hidden">
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {/* Sidebar */}
      <aside className="w-20 lg:w-64 bg-surface-dim border-r border-outline-variant/20 flex flex-col transition-all duration-300 z-50">
        <div className="p-6 flex items-center gap-3">
          <img src="/Cloud_Arsenal_logo.jpeg" alt="Cloud Arsenal" className="w-10 h-10 rounded-xl object-cover shrink-0" />
          <div className="hidden lg:block overflow-hidden whitespace-nowrap">
            <h1 className="font-headline font-black text-xl text-primary tracking-tight leading-none">Cloud Arsenal</h1>
            <p className="text-[11px] text-on-surface-variant uppercase tracking-widest mt-1">AWS Console</p>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', active: activeTab === 'dashboard' },
            { id: 'config', label: 'Scan Config', icon: 'settings', active: activeTab === 'config' },
            { id: 'logs', label: 'Live Output', icon: 'terminal', active: activeTab === 'logs' },
            { id: 'results', label: 'Results', icon: 'analytics', active: activeTab === 'results' },
            { id: 'history', label: 'History', icon: 'history', active: activeTab === 'history' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              disabled={item.id !== 'config' && !isAuthenticated}
              className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl transition-all duration-200 group relative disabled:opacity-30 disabled:cursor-not-allowed ${
                item.active 
                  ? 'bg-primary/10 text-primary' 
                  : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
              }`}
            >
              <span className={`material-symbols-outlined text-2xl ${item.active ? 'text-primary' : 'text-on-surface-variant group-hover:text-on-surface'}`}>
                {item.icon}
              </span>
              <span className="hidden lg:block font-label text-sm uppercase tracking-widest font-bold">
                {item.label}
              </span>
              {item.active && (
                <motion.div 
                  layoutId="sidebar-active"
                  className="absolute left-0 w-1 h-6 bg-primary rounded-r-full"
                />
              )}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-outline-variant/10 space-y-4">
          <div className="hidden lg:block bg-surface-container-low p-4 rounded-2xl border border-outline-variant/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-on-surface-variant uppercase font-bold">System Load</span>
              <span className="text-[10px] font-mono text-primary">{systemMetrics.cpu}%</span>
            </div>
            <div className="h-1 w-full bg-surface-container-highest rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-primary"
                animate={{ width: `${systemMetrics.cpu}%` }}
              />
            </div>
          </div>
          
          <div className="flex items-center gap-3 px-2">
            <div className="w-10 h-10 rounded-xl bg-surface-container-highest flex items-center justify-center text-primary font-bold border border-outline-variant/20 shrink-0">
              {identity ? identity.charAt(0).toUpperCase() : '??'}
            </div>
            <div className="hidden lg:block overflow-hidden">
              <p className="text-xs font-bold text-on-surface truncate">{identity || 'Not Authenticated'}</p>
              <p className="text-[10px] text-on-surface-variant truncate">{isAuthenticated ? 'Active Session' : 'Guest'}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-surface-dim/80 backdrop-blur-md border-b border-outline-variant/20 flex items-center justify-between px-8 shrink-0 z-40">
          <div className="flex items-center gap-4">
            <h2 className="font-headline font-bold text-base uppercase tracking-[0.2em] text-on-surface-variant">
              {activeTab === 'config' ? 'Scan Configuration' : activeTab === 'logs' ? 'Live Execution Logs' : 'Audit Findings'}
            </h2>
            <div className="h-4 w-[1px] bg-outline-variant/30"></div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isAuthenticated ? 'bg-tertiary shadow-[0_0_8px_rgba(74,225,118,0.5)]' : 'bg-error shadow-[0_0_8px_rgba(255,180,171,0.5)]'}`}></div>
              <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">
                {isAuthenticated ? 'Session Active' : 'Authentication Required'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden sm:flex items-center gap-4 px-4 py-1.5 bg-surface-container-low rounded-xl border border-outline-variant/20">
              <div className="flex flex-col items-center">
                <span className="text-[8px] text-on-surface-variant uppercase font-bold">Latency</span>
                <span className="text-[10px] font-mono text-yellow-500">{systemMetrics.latency}ms</span>
              </div>
              <div className="w-[1px] h-4 bg-outline-variant/30"></div>
              <div className="flex flex-col items-center">
                <span className="text-[8px] text-on-surface-variant uppercase font-bold">Memory</span>
                <span className="text-[10px] font-mono text-tertiary">{systemMetrics.mem}%</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="p-2 text-on-surface-variant hover:text-primary transition-colors">
                <span className="material-symbols-outlined">notifications</span>
              </button>
              <button onClick={() => setShowHelp(true)} className="p-2 text-on-surface-variant hover:text-primary transition-colors" title="Help & Configuration Guide">
                <span className="material-symbols-outlined">help</span>
              </button>
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto p-12 custom-scrollbar">
          <div className="max-w-[1440px] mx-auto space-y-12 pb-24">
            {activeTab === 'history' ?
              <HistoryTab sessionID={sessionID} onView={(runId) => {
                setRunId(runId);
                setActiveTab('results');
                fetch(`/api/history/${runId}?session_id=${sessionID}`)
                  .then(r => r.json())
                  .then(data => {
                    setFindings(data.findings || []);
                    setMetrics(data.metrics || { total: 0, optimized: 0, savings: "$0.00", risk: "Low" });
                  })}} />
            :
              <div className="contents">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* Step 1: Authenticate (Bento Item) */}
                  <section className="lg:col-span-8 bg-surface-container-low rounded-3xl p-8 shadow-2xl border border-outline-variant/10 flex flex-col h-full">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary-container text-on-primary-container text-lg font-black shadow-lg">1</span>
                      <div>
                        <h2 className="font-headline font-bold text-2xl uppercase tracking-tight">Authentication</h2>
                        <p className="text-[11px] text-on-surface-variant uppercase tracking-wider font-bold">AWS SSO Session Management</p>
                      </div>
                    </div>
                    <AnimatePresence>
                      {isAuthenticated && (
                        <motion.span 
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="text-[11px] font-label uppercase tracking-widest text-tertiary font-bold flex items-center gap-2 bg-tertiary/10 px-4 py-2 rounded-full border border-tertiary/20"
                        >
                          <ShieldCheck className="w-4 h-4" />
                          Verified Identity
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="flex-grow bg-surface-container-lowest rounded-2xl overflow-hidden border border-outline-variant/20 shadow-inner flex flex-col min-h-[320px]">
                    <div className="bg-surface-container-high px-6 py-4 flex items-center justify-between border-b border-outline-variant/20">
                      <div className="flex items-center gap-4">
                        <div className="flex gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-error/40"></div>
                          <div className="w-3 h-3 rounded-full bg-yellow-500/40"></div>
                          <div className="w-3 h-3 rounded-full bg-tertiary/40"></div>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <select 
                            value={scanOptions.authMode}
                            onChange={(e) => {
                              const mode = e.target.value as any;
                              setScanOptions({
                                ...scanOptions,
                                authMode: mode,
                                // SSO_ROLE is not for Users — auto-switch to GlobalAdmin and pre-fill defaults
                                userCategory: mode === 'SSO_ROLE' && scanOptions.userCategory === 'Users' ? 'GlobalAdmin' : scanOptions.userCategory,
                                ...(mode === 'SSO_ROLE' ? {
                                  orgAccountId: '914245605480',
                                  roleName: 'ks-it-managed-automation',
                                  externalId: '7bFnUsJFYsW6Y72b9WwhLYxxbuVBtZTpN7uxUEVY',
                                  managementRoleName: 'ks-it-managed-automation',
                                } : {}),
                              });
                            }}
                            className="bg-transparent border-none text-[11px] font-mono text-on-surface-variant uppercase tracking-widest focus:ring-0 cursor-pointer hover:text-primary transition-colors outline-none"
                          >
                            <option value="IAM">IAM Credentials</option>
                            <option value="SSO">AWS SSO Token</option>
                            <option value="SSO_ROLE">SSO + Role Switch</option>
                          </select>
                        </div>
                      </div>
                      {(showAuthFields || !isAuthenticated) && (
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={handleLogin}
                            disabled={isAuthenticating}
                            className="bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-xl text-[11px] font-mono flex items-center gap-2 font-bold transition-all border border-primary/20 disabled:opacity-50"
                          >
                            <span className={`material-symbols-outlined text-base ${isAuthenticating ? 'animate-spin' : ''}`}>
                              {isAuthenticating ? 'sync' : 'terminal'}
                            </span>
                            {isAuthenticating ? 'Authenticating...' : 'Login'}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col h-full">
                      {ssoVerificationUrl ? (
                        <div className="flex-grow bg-[#0a0e14] flex flex-col items-center justify-center gap-4 p-8">
                          <span className="material-symbols-outlined text-primary text-4xl animate-pulse">open_in_browser</span>
                          <p className="text-xs text-on-surface-variant text-center">A browser tab opened for AWS SSO authorization.<br/>Approve access there — this will update automatically.</p>
                          <a
                            href={ssoVerificationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] font-mono text-primary underline break-all text-center"
                          >
                            {ssoVerificationUrl}
                          </a>
                          <p className="text-[9px] text-on-surface-variant">If the tab didn't open, click the link above.</p>
                        </div>
                      ) : (
                        <div className={`p-8 font-mono text-base text-tertiary-fixed leading-relaxed terminal-glow bg-[#0a0e14] overflow-y-auto max-h-[200px] ${!showAuthFields && isAuthenticated ? '' : 'flex-grow'}`}>
                          {logs.length === 0 && !isAuthenticating && (
                            <div className="flex gap-2">
                              <span className="text-primary-fixed-dim">$</span>
                              <span className="w-2 h-5 bg-tertiary-fixed/50 animate-pulse"></span>
                            </div>
                          )}
                          {logs.map((log, i) => (
                            <div key={i} className="mb-1.5">
                              {log.message.startsWith('$') ? (
                                <div className="flex gap-2">
                                  <span className="text-primary-fixed-dim">$</span>
                                  <span className="text-on-surface">{log.message.substring(2)}</span>
                                </div>
                              ) : (
                                <div className={log.level === 'SUCCESS' ? 'text-tertiary' : log.level === 'ERROR' ? 'text-error' : 'text-on-surface-variant'}>
                                  {log.message}
                                </div>
                              )}
                            </div>
                          ))}
                          {isAuthenticating && (
                            <div className="flex gap-2 mt-2">
                              <span className="text-primary-fixed-dim">$</span>
                              <span className="w-2 h-5 bg-tertiary-fixed/50 animate-pulse"></span>
                            </div>
                          )}
                        </div>
                      )}
                      
                      <AnimatePresence mode="wait">
                        {!showAuthFields && isAuthenticated ? (
                          <motion.div 
                            key="auth-summary"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="bg-surface-container-high p-4 border-t border-outline-variant/20 flex items-center justify-between"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-tertiary/10 flex items-center justify-center text-tertiary">
                                <ShieldCheck className="w-4 h-4" />
                              </div>
                              <div>
                                <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">Active Identity</p>
                                <p className="text-xs font-mono text-on-surface truncate max-w-[200px]">{identity?.split('/').pop() || 'Authenticated'}</p>
                              </div>
                            </div>
                            <button 
                              onClick={() => {
                                setShowAuthFields(true);
                                setIsAuthenticated(false);
                                setIdentity(null);
                              }}
                              className="text-[10px] text-primary hover:underline font-bold uppercase tracking-widest"
                            >
                              Change Credentials
                            </button>
                          </motion.div>
                        ) : (
                          <>
                            {scanOptions.authMode === 'IAM' && (
                              <motion.div 
                                key="iam-fields"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="bg-surface-container-high p-6 border-t border-outline-variant/20 space-y-4"
                              >
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-2">
                                    <label className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">Access Key ID</label>
                                    <input 
                                      type="text"
                                      value={scanOptions.accessKey}
                                      onChange={(e) => setScanOptions({...scanOptions, accessKey: e.target.value})}
                                      placeholder="AKIA..."
                                      className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 text-xs font-mono text-on-surface focus:border-primary outline-none"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <label className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">Secret Access Key</label>
                                    <input 
                                      type="password"
                                      value={scanOptions.secretKey}
                                      onChange={(e) => setScanOptions({...scanOptions, secretKey: e.target.value})}
                                      placeholder="••••••••••••"
                                      className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 text-xs font-mono text-on-surface focus:border-primary outline-none"
                                    />
                                  </div>
                                </div>
                              </motion.div>
                            )}

                            {(scanOptions.authMode === 'SSO' || scanOptions.authMode === 'SSO_ROLE') && (
                              <motion.div 
                                key="sso-fields"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="bg-surface-container-high p-6 border-t border-outline-variant/20 space-y-4"
                              >
                                {/* SSO login — terminal-driven for all categories, no manual paste */}
                                {(scanOptions.userCategory === 'GlobalAdmin' || scanOptions.userCategory === 'CloudOps') ? (
                                  <div className="bg-tertiary/5 border border-tertiary/20 rounded-xl p-4 flex items-start gap-3">
                                    <span className="material-symbols-outlined text-tertiary text-lg mt-0.5">verified</span>
                                    <div>
                                      <p className="text-[10px] text-tertiary font-bold uppercase tracking-widest mb-1">SSO Pre-Configured · {ssoConfig.ssoSessionName || 'CloudScriptSSO'}</p>
                                      <p className="text-[10px] text-on-surface-variant">Click <strong className="text-on-surface">Terminal</strong> — your browser will open for authorization, then all accounts load automatically. No commands needed.</p>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                      <div className="space-y-1 md:col-span-2">
                                        <label className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">SSO Portal URL</label>
                                        <input
                                          type="text"
                                          value={ssoConfig.ssoUrl}
                                          onChange={(e) => setSsoConfig({...ssoConfig, ssoUrl: e.target.value})}
                                          placeholder="https://your-org.awsapps.com/start"
                                          className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 text-xs font-mono text-on-surface focus:border-primary outline-none"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <label className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">SSO Region</label>
                                        <input
                                          type="text"
                                          value={ssoConfig.ssoRegion}
                                          onChange={(e) => setSsoConfig({...ssoConfig, ssoRegion: e.target.value})}
                                          placeholder="us-east-1"
                                          className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 text-xs font-mono text-on-surface focus:border-primary outline-none"
                                        />
                                      </div>
                                      <div className="space-y-1">
                                        <label className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">Session Name</label>
                                        <input
                                          type="text"
                                          value={ssoConfig.ssoSessionName}
                                          onChange={(e) => setSsoConfig({...ssoConfig, ssoSessionName: e.target.value})}
                                          placeholder="my-sso"
                                          className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 text-xs font-mono text-on-surface focus:border-primary outline-none"
                                        />
                                      </div>
                                    </div>
                                    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                                      <p className="text-[10px] text-on-surface-variant">Click <strong className="text-on-surface">Login</strong> — your browser will open for AWS SSO authorization, then all your permitted accounts load automatically.</p>
                                    </div>
                                  </>
                                )}

                              </motion.div>
                            )}
                            {/* Common fields — hidden for SSO (per-account creds handled automatically) */}
                            {scanOptions.authMode !== 'SSO' && (
                            <motion.div
                              key="common-fields"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="bg-surface-container-high p-6 border-t border-outline-variant/20 space-y-4"
                            >
                              {/* SSO_ROLE: User Category (GlobalAdmin/CloudOps) + org account + role + external ID */}
                              {scanOptions.authMode === 'SSO_ROLE' && (
                                <div className="space-y-4">
                                  <div className="space-y-2">
                                    <label className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">User Category</label>
                                    <select
                                      value={scanOptions.userCategory}
                                      onChange={(e) => {
                                        const cat = e.target.value as any;
                                        setScanOptions({
                                          ...scanOptions,
                                          userCategory: cat,
                                          orgAccountId: '914245605480',
                                          roleName: 'ks-it-managed-automation',
                                          externalId: '7bFnUsJFYsW6Y72b9WwhLYxxbuVBtZTpN7uxUEVY',
                                          managementRoleName: 'ks-it-managed-automation',
                                        });
                                      }}
                                      className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 text-xs font-mono text-on-surface focus:border-primary outline-none cursor-pointer"
                                    >
                                      <option value="CloudOps">CloudOps</option>
                                      <option value="GlobalAdmin">GlobalAdmin</option>
                                    </select>
                                  </div>
                                  <div className="space-y-2">
                                    <label className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">Org Management Account ID</label>
                                    <input
                                      type="text"
                                      value={scanOptions.orgAccountId}
                                      onChange={(e) => setScanOptions({...scanOptions, orgAccountId: e.target.value})}
                                      placeholder="123456789012"
                                      className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 text-xs font-mono text-on-surface focus:border-primary outline-none"
                                    />
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                      <label className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">Role Name <span className="text-outline-variant normal-case">(management &amp; cross-account)</span></label>
                                      <input
                                        type="text"
                                        value={scanOptions.roleName}
                                        onChange={(e) => setScanOptions({...scanOptions, roleName: e.target.value})}
                                        placeholder="ks-it-managed-automation"
                                        className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 text-xs font-mono text-on-surface focus:border-primary outline-none"
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <label className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">External ID</label>
                                      <div className="relative">
                                        <input
                                          type={showExternalId ? 'text' : 'password'}
                                          value={scanOptions.externalId}
                                          onChange={(e) => setScanOptions({...scanOptions, externalId: e.target.value})}
                                          placeholder="ExternalID-123"
                                          className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 pr-10 text-xs font-mono text-on-surface focus:border-primary outline-none"
                                        />
                                        <button type="button" onClick={() => setShowExternalId(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors">
                                          <span className="material-symbols-outlined text-base">{showExternalId ? 'visibility_off' : 'visibility'}</span>
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* IAM — optional cross-account role + external ID (single account, no category needed) */}
                              {scanOptions.authMode === 'IAM' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-2">
                                    <label className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">Cross-Account Role Name <span className="text-outline-variant normal-case">(optional)</span></label>
                                    <input
                                      type="text"
                                      value={scanOptions.roleName}
                                      onChange={(e) => setScanOptions({...scanOptions, roleName: e.target.value})}
                                      placeholder="OrganizationAccountAccessRole"
                                      className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 text-xs font-mono text-on-surface focus:border-primary outline-none"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <label className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">External ID <span className="text-outline-variant normal-case">(optional)</span></label>
                                    <div className="relative">
                                      <input
                                        type={showExternalId ? 'text' : 'password'}
                                        value={scanOptions.externalId}
                                        onChange={(e) => setScanOptions({...scanOptions, externalId: e.target.value})}
                                        placeholder="ExternalID-123"
                                        className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 pr-10 text-xs font-mono text-on-surface focus:border-primary outline-none"
                                      />
                                      <button type="button" onClick={() => setShowExternalId(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors">
                                        <span className="material-symbols-outlined text-base">{showExternalId ? 'visibility_off' : 'visibility'}</span>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </motion.div>
                            )}
                          </>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </section>

                {/* Quick Stats / Info (Bento Item) */}
                <div className="lg:col-span-4 grid grid-rows-2 gap-8">
                  <div className="bg-surface-container-low rounded-3xl p-8 border border-outline-variant/10 flex flex-col justify-center relative overflow-hidden group shadow-xl">
                    <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                      <Database className="w-24 h-24" />
                    </div>
                    <p className="font-label text-[11px] uppercase tracking-widest text-on-surface-variant mb-2 font-bold">Session Context</p>
                    <h3 className="text-4xl font-black font-headline text-primary tracking-tight">{isAuthenticated ? sessionID : 'NO SESSION'}</h3>
                    <div className="mt-6 flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${isAuthenticated ? 'bg-tertiary shadow-[0_0_8px_rgba(74,225,118,0.4)]' : 'bg-outline-variant'}`}></div>
                      <span className="text-[11px] font-mono text-on-surface-variant font-bold uppercase tracking-widest">
                        {isAuthenticated ? 'Active Session' : 'Login Required'}
                      </span>
                    </div>
                  </div>
                  <div className="bg-surface-container-low rounded-3xl p-8 border border-outline-variant/10 flex flex-col justify-center relative overflow-hidden group shadow-xl">
                    <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                      <User className="w-24 h-24" />
                    </div>
                    <p className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant mb-2 font-bold">Identity</p>
                    <h3 className="text-2xl font-black font-headline text-on-surface truncate tracking-tight">
                      {isAuthenticated ? (identity?.split('/').pop() || 'Authenticated') : 'UNAUTHENTICATED'}
                    </h3>
                    <div className="mt-6 flex items-center gap-3">
                      <ShieldCheck className={`w-5 h-5 ${isAuthenticated ? 'text-tertiary' : 'text-outline-variant'}`} />
                      <span className="text-[10px] font-mono text-on-surface-variant font-bold uppercase tracking-widest">
                        {isAuthenticated ? 'Role: Administrator' : 'Access: Restricted'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-surface-container-low rounded-3xl shadow-2xl border border-outline-variant/10 overflow-hidden flex flex-col min-h-[600px]">
                <div className="p-10 flex-grow">
                  <AnimatePresence mode="wait">
                    {activeTab === 'config' && (
                  <motion.div 
                    key="config"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-8"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                      {/* Service Selection Card */}
                      <div className="bg-surface-container rounded-3xl p-8 border border-outline-variant/10 shadow-lg flex flex-col gap-6">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                            <span className="material-symbols-outlined">category</span>
                          </div>
                          <h3 className="font-headline font-bold text-lg">Resource Type</h3>
                        </div>
                        <div className="space-y-4">
                          <div className="relative group">
                            <select 
                              value={scanOptions.service}
                              onChange={(e) => setScanOptions({...scanOptions, service: e.target.value})}
                              className="w-full bg-surface-container-high border border-outline-variant/30 text-on-surface p-4 pr-10 focus:ring-2 focus:ring-primary/50 focus:border-primary appearance-none rounded-2xl cursor-pointer transition-all hover:bg-surface-container-highest outline-none"
                            >
                              <option value="KMS Zombie Keys">KMS Keys</option>
                            <option value="Unused ALBs">ALB / NLB</option>
                            <option value="EC2 Instances">EC2 Instances</option>
                            <option value="S3 Buckets">S3 Buckets</option>
                            <option value="EIP Addresses">EIP Addresses</option>
                            <option value="EIP Unassociated">EIP Unassociated</option>
                          </select>
                          <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface-variant group-hover:text-primary transition-colors">
                            expand_more
                          </span>
                        </div>
                        <p className="text-[11px] text-on-surface-variant leading-relaxed px-1">
                          Select the AWS resource type to audit for potential zombie or stale states.
                        </p>
                      </div>
                    </div>

                    {/* Scope Selection Card */}
                    <div className="bg-surface-container rounded-3xl p-8 border border-outline-variant/10 shadow-lg flex flex-col gap-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-tertiary/10 flex items-center justify-center text-tertiary">
                          <span className="material-symbols-outlined">scope</span>
                        </div>
                        <h3 className="font-headline font-bold text-lg">Scan Scope</h3>
                      </div>
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 gap-3">
                          <button 
                            onClick={() => setScanOptions({...scanOptions, scope: 'single'})}
                            className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
                              scanOptions.scope === 'single' 
                                ? 'bg-primary/10 border-primary text-primary' 
                                : 'bg-surface-container-high border-outline-variant/30 text-on-surface hover:bg-surface-container-highest'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className="material-symbols-outlined text-xl">person</span>
                              <span className="text-sm font-bold">Single Account</span>
                            </div>
                            {scanOptions.scope === 'single' && <span className="material-symbols-outlined text-sm">check_circle</span>}
                          </button>
                          <button 
                            onClick={() => setScanOptions({...scanOptions, scope: 'all'})}
                            className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
                              scanOptions.scope === 'all' 
                                ? 'bg-primary/10 border-primary text-primary' 
                                : 'bg-surface-container-high border-outline-variant/30 text-on-surface hover:bg-surface-container-highest'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className="material-symbols-outlined text-xl">corporate_fare</span>
                              <span className="text-sm font-bold">Organization</span>
                            </div>
                            {scanOptions.scope === 'all' && <span className="material-symbols-outlined text-sm">check_circle</span>}
                          </button>
                        </div>
                        <AnimatePresence>
                          {scanOptions.scope === 'single' && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <input 
                                className="w-full bg-surface-container-lowest border border-outline-variant/30 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none p-4 text-xs font-mono text-on-surface rounded-2xl mt-2" 
                                placeholder="Enter Account ID (12 digits)" 
                                type="text" 
                                value={scanOptions.accountID}
                                onChange={(e) => setScanOptions({...scanOptions, accountID: e.target.value})}
                              />
                            </motion.div>
                          )}
                          {scanOptions.scope === 'all' && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden space-y-4 mt-2"
                            >
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <label className="text-[10px] text-on-surface-variant uppercase font-bold tracking-widest">
                                    Select Accounts
                                    {availableAccounts.length > 0 && (
                                      <span className="ml-2 text-primary normal-case font-normal">({availableAccounts.length} total)</span>
                                    )}
                                  </label>
                                  <div className="flex items-center gap-4">
                                    <div className="relative">
                                      <Search className="w-3 h-3 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                                      <input
                                        type="text"
                                        value={accountSearch}
                                        onChange={(e) => { setAccountSearch(e.target.value); setAccountPage(1); }}
                                        placeholder="Search all accounts..."
                                        className="bg-surface-container-lowest border border-outline-variant/30 rounded-lg pl-8 pr-3 py-1 text-[10px] text-on-surface focus:border-primary outline-none w-44"
                                      />
                                    </div>
                                    <button
                                      onClick={fetchAccounts}
                                      className="text-[10px] text-primary uppercase font-bold hover:underline"
                                    >
                                      Refresh List
                                    </button>
                                  </div>
                                </div>

                                {(() => {
                                  const filtered = availableAccounts.filter(acc =>
                                    acc.name.toLowerCase().includes(accountSearch.toLowerCase()) ||
                                    acc.id.includes(accountSearch)
                                  );
                                  const totalPages = Math.ceil(filtered.length / ACCOUNTS_PER_PAGE);
                                  const pageAccounts = filtered.slice((accountPage - 1) * ACCOUNTS_PER_PAGE, accountPage * ACCOUNTS_PER_PAGE);
                                  const allPageSelected = pageAccounts.length > 0 && pageAccounts.every(a => scanOptions.selectedAccounts.includes(a.id));

                                  return (
                                    <>
                                      <div className="max-h-[320px] overflow-y-auto bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-2 space-y-1 custom-scrollbar">
                                        {isFetchingAccounts ? (
                                          <div className="p-4 text-center text-xs text-on-surface-variant animate-pulse">Fetching accounts...</div>
                                        ) : availableAccounts.length === 0 ? (
                                          <div className="p-4 text-center space-y-3">
                                            <p className="text-xs text-on-surface-variant italic">No accounts discovered.</p>
                                            <button
                                              onClick={handleLogin}
                                              disabled={isAuthenticating}
                                              className="bg-primary/10 text-primary hover:bg-primary/20 px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-50 flex items-center gap-2"
                                            >
                                              <span className={`material-symbols-outlined text-sm ${isAuthenticating ? 'animate-spin' : ''}`}>
                                                {isAuthenticating ? 'sync' : 'terminal'}
                                              </span>
                                              {isAuthenticating ? 'Authenticating...' : 'Login to Fetch'}
                                            </button>
                                          </div>
                                        ) : filtered.length === 0 ? (
                                          <div className="p-4 text-center text-xs text-on-surface-variant italic">No accounts match "{accountSearch}"</div>
                                        ) : (
                                          pageAccounts.map(acc => (
                                            <label key={acc.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-container-high cursor-pointer transition-colors group">
                                              <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all flex-shrink-0 ${scanOptions.selectedAccounts.includes(acc.id) ? 'bg-primary border-primary' : 'border-outline-variant'}`}>
                                                {scanOptions.selectedAccounts.includes(acc.id) && <span className="material-symbols-outlined text-[10px] text-on-primary">check</span>}
                                              </div>
                                              <input
                                                type="checkbox"
                                                className="hidden"
                                                checked={scanOptions.selectedAccounts.includes(acc.id)}
                                                onChange={(e) => {
                                                  const newSelected = e.target.checked
                                                    ? [...scanOptions.selectedAccounts, acc.id]
                                                    : scanOptions.selectedAccounts.filter(id => id !== acc.id);
                                                  setScanOptions({...scanOptions, selectedAccounts: newSelected});
                                                }}
                                              />
                                              <div className="flex flex-col min-w-0">
                                                <span className="text-xs font-bold text-on-surface group-hover:text-primary transition-colors truncate">{acc.name}</span>
                                                <span className="text-[10px] font-mono text-on-surface-variant">{acc.id}</span>
                                              </div>
                                            </label>
                                          ))
                                        )}
                                      </div>

                                      {/* Pagination + select-page controls */}
                                      {filtered.length > ACCOUNTS_PER_PAGE && (
                                        <div className="flex items-center justify-between pt-1">
                                          <div className="flex items-center gap-2">
                                            <button
                                              onClick={() => {
                                                const ids = pageAccounts.map(a => a.id);
                                                const newSelected = allPageSelected
                                                  ? scanOptions.selectedAccounts.filter(id => !ids.includes(id))
                                                  : [...new Set([...scanOptions.selectedAccounts, ...ids])];
                                                setScanOptions({...scanOptions, selectedAccounts: newSelected});
                                              }}
                                              className="text-[10px] text-primary font-bold uppercase tracking-widest hover:underline"
                                            >
                                              {allPageSelected ? 'Deselect page' : 'Select page'}
                                            </button>
                                            {scanOptions.selectedAccounts.length > 0 && (
                                              <span className="text-[10px] text-on-surface-variant">· {scanOptions.selectedAccounts.length} selected</span>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <span className="text-[10px] font-mono text-on-surface-variant">
                                              {(accountPage - 1) * ACCOUNTS_PER_PAGE + 1}–{Math.min(accountPage * ACCOUNTS_PER_PAGE, filtered.length)} of {filtered.length}
                                            </span>
                                            <button
                                              onClick={() => setAccountPage(p => Math.max(1, p - 1))}
                                              disabled={accountPage === 1}
                                              className="w-6 h-6 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high disabled:opacity-30 transition-colors"
                                            >
                                              <span className="material-symbols-outlined text-[14px]">chevron_left</span>
                                            </button>
                                            <span className="text-[10px] font-mono text-on-surface font-bold">{accountPage}/{totalPages}</span>
                                            <button
                                              onClick={() => setAccountPage(p => Math.min(totalPages, p + 1))}
                                              disabled={accountPage === totalPages}
                                              className="w-6 h-6 rounded-lg bg-surface-container flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high disabled:opacity-30 transition-colors"
                                            >
                                              <span className="material-symbols-outlined text-[14px]">chevron_right</span>
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    {/* Region Card */}
                    <div className="bg-surface-container rounded-3xl p-8 border border-outline-variant/10 shadow-lg flex flex-col gap-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400">
                          <span className="material-symbols-outlined">public</span>
                        </div>
                        <h3 className="font-headline font-bold text-lg">Regions</h3>
                      </div>
                      <div className="space-y-3">
                        {(['default', 'all', 'custom'] as const).map(mode => (
                          <label key={mode} className="flex items-center gap-3 cursor-pointer group p-3 rounded-xl hover:bg-surface-container-high transition-colors">
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${scanOptions.regionMode === mode ? 'border-primary bg-primary' : 'border-outline-variant'}`}>
                              {scanOptions.regionMode === mode && <div className="w-1.5 h-1.5 rounded-full bg-on-primary" />}
                            </div>
                            <input type="radio" className="hidden" checked={scanOptions.regionMode === mode} onChange={() => setScanOptions({...scanOptions, regionMode: mode})} />
                            <span className="text-xs font-bold text-on-surface group-hover:text-primary transition-colors capitalize">
                              {mode === 'default' ? 'Default region (from config)' : mode === 'all' ? 'All regions' : 'Custom'}
                            </span>
                          </label>
                        ))}
                        {scanOptions.regionMode === 'custom' && (
                          <input
                            type="text"
                            value={scanOptions.customRegions}
                            onChange={(e) => setScanOptions({...scanOptions, customRegions: e.target.value})}
                            placeholder="us-west-2, ap-southeast-1, eu-west-1"
                            className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3 text-xs font-mono text-on-surface focus:border-primary outline-none"
                          />
                        )}
                      </div>
                    </div>

                    {/* Optimization Card */}
                    <div className="bg-surface-container rounded-3xl p-8 border border-outline-variant/10 shadow-lg flex flex-col gap-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-yellow-500/10 flex items-center justify-center text-yellow-500">
                          <span className="material-symbols-outlined">tune</span>
                        </div>
                        <h3 className="font-headline font-bold text-lg">Optimization</h3>
                      </div>
                      <div className="space-y-6">
                        <div className="space-y-2">
                          <div className="flex justify-between items-center px-1">
                            <label className="text-xs text-on-surface-variant font-bold uppercase tracking-wider">Idle Threshold</label>
                            <span className="text-xs font-mono text-primary font-bold">{scanOptions.idleDays} Days</span>
                          </div>
                          <input 
                            type="range"
                            min="1"
                            max="90"
                            value={scanOptions.idleDays}
                            onChange={(e) => setScanOptions({...scanOptions, idleDays: parseInt(e.target.value)})}
                            className="w-full h-1.5 bg-surface-container-highest rounded-lg appearance-none cursor-pointer accent-primary"
                          />
                        </div>
                        <div className="space-y-3">
                          <label className="flex items-center gap-3 cursor-pointer group p-3 rounded-xl hover:bg-surface-container-high transition-colors">
                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${scanOptions.verbose ? 'bg-primary border-primary' : 'border-outline-variant'}`}>
                              {scanOptions.verbose && <span className="material-symbols-outlined text-xs text-on-primary">check</span>}
                            </div>
                            <input 
                              type="checkbox" 
                              checked={scanOptions.verbose}
                              onChange={(e) => setScanOptions({...scanOptions, verbose: e.target.checked})}
                              className="hidden" 
                            />
                            <span className="text-xs font-bold text-on-surface group-hover:text-primary transition-colors">Verbose Logging</span>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer group p-3 rounded-xl hover:bg-surface-container-high transition-colors">
                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${scanOptions.skipS3 ? 'bg-primary border-primary' : 'border-outline-variant'}`}>
                              {scanOptions.skipS3 && <span className="material-symbols-outlined text-xs text-on-primary">check</span>}
                            </div>
                            <input 
                              type="checkbox" 
                              checked={scanOptions.skipS3}
                              onChange={(e) => setScanOptions({...scanOptions, skipS3: e.target.checked})}
                              className="hidden" 
                            />
                            <span className="text-xs font-bold text-on-surface group-hover:text-primary transition-colors">Skip S3 Artifact Upload</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-center pt-8">
                    <button 
                      onClick={isScanning ? stopScan : startScan}
                      disabled={!isScanning && (!isAuthenticated && !(
                        (scanOptions.authMode === 'IAM' && scanOptions.accessKey && scanOptions.secretKey) || 
                        ((scanOptions.authMode === 'SSO' || scanOptions.authMode === 'SSO_ROLE') && (scanOptions.sessionToken || (scanOptions.accessKey && scanOptions.secretKey)))
                      ))}
                      className={`relative overflow-hidden font-headline font-black px-12 py-5 rounded-3xl flex items-center gap-4 transition-all active:scale-95 group shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed ${
                        isScanning 
                          ? 'bg-error text-on-error hover:bg-error/80 hover:shadow-error/30' 
                          : 'bg-primary-container hover:bg-primary text-on-primary hover:shadow-primary/30'
                      }`}
                    >
                      <AnimatePresence mode="wait">
                        {isScanning ? (
                          <motion.div
                            key="scanning"
                            initial={{ opacity: 0, scale: 0.5 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 1.5 }}
                          >
                            <span className="material-symbols-outlined text-2xl">stop</span>
                          </motion.div>
                        ) : (
                          <motion.div
                            key="start"
                            initial={{ opacity: 0, scale: 0.5 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 1.5 }}
                          >
                            <span className="material-symbols-outlined text-2xl group-hover:translate-x-1 transition-transform">play_arrow</span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <span className="tracking-[0.15em] uppercase text-sm">
                        {isScanning ? 'Stop Scan' : 'Start Scan Engine'}
                      </span>
                    </button>
                  </div>
                </motion.div>
              )}

              {activeTab === 'dashboard' && (
                <motion.div 
                  key="dashboard"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.05 }}
                  className="space-y-8"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-headline font-bold uppercase tracking-tight">Account Dashboard</h2>
                    <div className="flex items-center gap-3">
                      {accountSummaries.length > 0 && (
                        <button
                          onClick={() => setShowIndividualAccounts(v => !v)}
                          className="bg-surface-container-high hover:bg-surface-container border border-outline-variant/30 text-on-surface-variant hover:text-on-surface px-4 py-2 rounded-xl text-[11px] font-mono flex items-center gap-2 font-bold transition-all"
                        >
                          <span className="material-symbols-outlined text-base">{showIndividualAccounts ? 'summarize' : 'table_rows'}</span>
                          {showIndividualAccounts ? 'Show Summary' : 'Individual Breakdown'}
                        </button>
                      )}
                      <button
                        onClick={() => fetchAccounts(sessionID)}
                        className="bg-primary/10 hover:bg-primary/20 text-primary px-4 py-2 rounded-xl text-[11px] font-mono flex items-center gap-2 font-bold transition-all border border-primary/20"
                      >
                        <span className="material-symbols-outlined text-base">refresh</span>
                        Refresh
                      </button>
                    </div>
                  </div>

                  {accountSummaries.length === 0 && (
                    <p className="text-xs text-on-surface-variant italic">
                      {isAuthenticated ? 'Fetching account summaries... results will appear here as they load.' : 'Log in to view account summaries.'}
                    </p>
                  )}

                  {/* Aggregate summary view (default) */}
                  {!showIndividualAccounts && accountSummaries.length > 0 && (() => {
                    const active = accountSummaries.filter(s => s.status === 'Active');
                    const denied = accountSummaries.filter(s => s.status === 'Access Denied');
                    const loading = accountSummaries.filter(s => s.status === 'loading');
                    const totalCurrentSpend = active.reduce((sum, s) => sum + (s.current_month_spend || 0), 0);
                    const totalLastSpend = active.reduce((sum, s) => sum + (s.last_month_spend || 0), 0);
                    const totalEC2 = active.reduce((sum, s) => sum + (s.resource_counts?.ec2 || 0), 0);
                    const totalS3 = active.reduce((sum, s) => sum + (s.resource_counts?.s3 || 0), 0);
                    const totalRDS = active.reduce((sum, s) => sum + (s.resource_counts?.rds || 0), 0);
                    // Aggregate top services across all accounts
                    const serviceMap: Record<string, number> = {};
                    active.forEach(s => s.top_services?.forEach((svc: any) => {
                      serviceMap[svc.service] = (serviceMap[svc.service] || 0) + (svc.spend || 0);
                    }));
                    const topServices = Object.entries(serviceMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
                    return (
                      <div className="space-y-6">
                        {/* KPI row */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="bg-surface-container rounded-2xl p-5 border border-outline-variant/10">
                            <p className="text-[9px] uppercase tracking-widest text-on-surface-variant font-bold mb-2">Total Accounts</p>
                            <p className="text-3xl font-mono font-black text-on-surface">{accountSummaries.length}</p>
                            <p className="text-[10px] text-on-surface-variant mt-1">
                              {active.length} active{denied.length > 0 ? ` · ${denied.length} denied` : ''}{loading.length > 0 ? ` · ${loading.length} loading` : ''}
                            </p>
                          </div>
                          <div className="bg-surface-container rounded-2xl p-5 border border-outline-variant/10">
                            <p className="text-[9px] uppercase tracking-widest text-on-surface-variant font-bold mb-2">Current Month Spend</p>
                            <p className="text-3xl font-mono font-black text-on-surface">${totalCurrentSpend.toFixed(2)}</p>
                            <p className="text-[10px] text-on-surface-variant mt-1">Last month ${totalLastSpend.toFixed(2)}</p>
                          </div>
                          <div className="bg-surface-container rounded-2xl p-5 border border-outline-variant/10">
                            <p className="text-[9px] uppercase tracking-widest text-on-surface-variant font-bold mb-2">Total Resources</p>
                            <p className="text-3xl font-mono font-black text-on-surface">{totalEC2 + totalS3 + totalRDS}</p>
                            <p className="text-[10px] text-on-surface-variant mt-1">EC2 {totalEC2} · S3 {totalS3} · RDS {totalRDS}</p>
                          </div>
                          <div className={`rounded-2xl p-5 border ${denied.length > 0 ? 'bg-error/5 border-error/20' : 'bg-surface-container border-outline-variant/10'}`}>
                            <p className="text-[9px] uppercase tracking-widest text-on-surface-variant font-bold mb-2">Access Denied</p>
                            <p className={`text-3xl font-mono font-black ${denied.length > 0 ? 'text-error' : 'text-on-surface'}`}>{denied.length}</p>
                            <p className="text-[10px] text-on-surface-variant mt-1">{denied.length > 0 ? 'accounts inaccessible' : 'all accounts accessible'}</p>
                          </div>
                        </div>

                        {/* Top services */}
                        {topServices.length > 0 && (
                          <div className="bg-surface-container rounded-2xl p-6 border border-outline-variant/10">
                            <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mb-4">Top Services by Spend (All Accounts)</p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              {topServices.map(([svc, spend]) => (
                                <div key={svc} className="flex items-center justify-between bg-surface-container-lowest rounded-xl px-4 py-3 border border-outline-variant/10">
                                  <span className="text-xs text-on-surface truncate max-w-[130px]" title={svc}>{svc}</span>
                                  <span className="text-xs font-mono font-bold text-on-surface-variant ml-2">${spend.toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Denied accounts list */}
                        {denied.length > 0 && (
                          <div className="bg-error/5 rounded-2xl p-5 border border-error/15">
                            <p className="text-[10px] uppercase tracking-widest text-error font-bold mb-3">Inaccessible Accounts</p>
                            <div className="space-y-2">
                              {denied.map(s => (
                                <div key={s.account_id} className="flex items-center justify-between text-xs">
                                  <span className="font-mono text-on-surface-variant">{s.account_id}</span>
                                  <span className="text-on-surface truncate max-w-[200px]">{s.account_name}</span>
                                  <span className="text-error/70 font-mono text-[10px] truncate max-w-[200px]">{s.hint || 'Access Denied'}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Individual account breakdown (toggle) */}
                  {showIndividualAccounts && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {accountSummaries.map((summary) => (
                      <div key={summary.account_id} className="bg-surface-container rounded-3xl p-6 border border-outline-variant/10 shadow-lg flex flex-col gap-4 hover:border-primary/30 transition-colors">
                        <div className="flex items-center justify-between border-b border-outline-variant/10 pb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                              <span className="material-symbols-outlined">cloud</span>
                            </div>
                            <div>
                              <h3 className="font-bold text-sm text-on-surface">{summary.account_name || `Account ${summary.account_id}`}</h3>
                              <p className="text-[10px] font-mono text-on-surface-variant">{summary.account_id}</p>
                            </div>
                          </div>
                          {summary.status === 'loading' && (
                            <span className="material-symbols-outlined text-primary animate-spin">sync</span>
                          )}
                          {summary.status === 'Access Denied' && (
                            <span className="material-symbols-outlined text-error" title={summary.hint || 'Access Denied'}>error</span>
                          )}
                          {summary.status === 'Active' && (
                            <span className="material-symbols-outlined text-tertiary">check_circle</span>
                          )}
                        </div>

                        {summary.status === 'Access Denied' && summary.hint && (
                          <p className="text-[10px] text-error/80 font-mono leading-relaxed">{summary.hint}</p>
                        )}

                        {summary.status === 'Active' && (
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div className="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant/10">
                                <p className="text-[9px] uppercase tracking-widest text-on-surface-variant font-bold mb-1">Current Spend</p>
                                <p className="text-lg font-mono font-bold text-on-surface">${summary.current_month_spend?.toFixed(2) || '0.00'}</p>
                              </div>
                              <div className="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant/10">
                                <p className="text-[9px] uppercase tracking-widest text-on-surface-variant font-bold mb-1">Last Month</p>
                                <p className="text-lg font-mono font-bold text-on-surface-variant">${summary.last_month_spend?.toFixed(2) || '0.00'}</p>
                              </div>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mb-2">Top Services</p>
                              <div className="space-y-2">
                                {summary.top_services?.map((svc: any, i: number) => (
                                  <div key={i} className="flex items-center justify-between text-xs">
                                    <span className="text-on-surface truncate max-w-[150px]" title={svc.service}>{svc.service}</span>
                                    <span className="font-mono text-on-surface-variant">${svc.spend?.toFixed(2) || '0.00'}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className="border-t border-outline-variant/10 pt-4">
                              <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mb-2">Resources</p>
                              <div className="flex gap-4">
                                <div className="flex items-center gap-2">
                                  <span className="material-symbols-outlined text-[14px] text-on-surface-variant">dns</span>
                                  <span className="text-xs font-mono font-bold">{summary.resource_counts?.ec2 || 0}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="material-symbols-outlined text-[14px] text-on-surface-variant">folder</span>
                                  <span className="text-xs font-mono font-bold">{summary.resource_counts?.s3 || 0}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="material-symbols-outlined text-[14px] text-on-surface-variant">database</span>
                                  <span className="text-xs font-mono font-bold">{summary.resource_counts?.rds || 0}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {summary.status !== 'Active' && summary.status !== 'loading' && summary.status !== 'Access Denied' && (
                          <div className="bg-error/10 text-error p-3 rounded-xl text-xs border border-error/20">
                            {summary.status}
                          </div>
                        )}
                      </div>
                    ))}
                    {accountSummaries.length === 0 && !isFetchingAccounts && (
                      <div className="col-span-full flex flex-col items-center justify-center p-12 bg-surface-container border border-outline-variant/10 rounded-3xl border-dashed">
                        <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-4 opacity-50">dashboard</span>
                        <p className="text-sm text-on-surface-variant font-bold">No account data available.</p>
                        <p className="text-xs text-on-surface-variant mt-2">Authenticate and fetch accounts to view the summary.</p>
                      </div>
                    )}
                  </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'logs' && (
                <motion.div 
                  key="logs"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.05 }}
                  className="flex flex-col h-full space-y-6"
                >
                  <div className="flex items-center gap-6 bg-surface-container p-6 rounded-3xl border border-outline-variant/10 shadow-lg">
                    <div className="flex-grow">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Overall Progress</span>
                        <span className="text-sm font-mono text-primary font-black">{Math.floor(progress)}%</span>
                      </div>
                      <div className="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden p-0.5">
                        <motion.div 
                          className="h-full bg-gradient-to-r from-primary-container to-primary rounded-full shadow-[0_0_15px_rgba(37,99,235,0.4)]"
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-3 bg-surface-container-high px-6 py-3 rounded-2xl border border-outline-variant/20">
                      <div className="flex flex-col items-end">
                        <span className="text-[8px] text-on-surface-variant uppercase font-bold">Status</span>
                        <span className="text-xs font-bold text-tertiary uppercase tracking-wider">{isScanning ? 'Running' : 'Idle'}</span>
                      </div>
                      <div className="w-2 h-2 rounded-full bg-tertiary animate-pulse shadow-[0_0_8px_rgba(74,225,118,0.5)]"></div>
                    </div>
                  </div>

                  <div className="bg-[#0a0e14] rounded-3xl flex-grow overflow-hidden border border-outline-variant/20 shadow-2xl flex flex-col relative group">
                    <div className="bg-surface-container-high/50 backdrop-blur-md px-6 py-3 flex items-center justify-between border-b border-outline-variant/20">
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-primary text-lg">terminal</span>
                        <span className="text-[10px] font-mono text-on-surface-variant uppercase tracking-widest">Execution Stream — {sessionID}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
                          <span className="text-[9px] font-mono text-on-surface-variant uppercase">Connected</span>
                        </div>
                        <button className="text-on-surface-variant hover:text-primary transition-colors">
                          <span className="material-symbols-outlined text-sm">content_copy</span>
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex-grow overflow-y-auto p-8 font-mono text-[11px] leading-relaxed terminal-glow custom-scrollbar">
                      {logs.filter(l => !l.message.includes('aws sso') && !l.message.includes('Identity')).map((log, i) => (
                        <div key={i} className="flex gap-4 group/line hover:bg-white/5 transition-colors rounded px-2 py-1">
                          <span className="text-outline-variant/50 shrink-0 tabular-nums">[{log.timestamp}]</span>
                          <span className={`shrink-0 font-bold w-14 text-center rounded text-[9px] py-0.5 ${
                            log.level === 'SUCCESS' ? 'bg-tertiary/10 text-tertiary' : 
                            log.level === 'WARN' ? 'bg-yellow-500/10 text-yellow-500' : 
                            log.level === 'ERROR' ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary'
                          }`}>{log.level}</span>
                          <span className="text-on-surface/90 break-all">{log.message}</span>
                        </div>
                      ))}
                      {isScanning && (
                        <div className="flex gap-4 items-center px-2 py-1">
                          <span className="text-outline-variant/50">[{new Date().toLocaleTimeString('en-GB', { hour12: false })}]</span>
                          <span className="w-1.5 h-4 bg-tertiary/50 animate-pulse"></span>
                        </div>
                      )}
                      <div ref={logEndRef} />
                    </div>

                    <div className="absolute bottom-6 right-8 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                        className="bg-primary/20 hover:bg-primary/30 text-primary p-2 rounded-full backdrop-blur-md border border-primary/30 shadow-lg"
                      >
                        <span className="material-symbols-outlined">arrow_downward</span>
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'results' && (
                <motion.div 
                  key="results"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.02 }}
                  className="space-y-10"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Stats Grid */}
                    <div className="lg:col-span-8 grid grid-cols-2 gap-6">
                      {[
                        { label: 'Total Resources', value: metrics.total.toString(), color: 'text-primary', border: 'border-primary/40', icon: 'inventory_2' },
                        { label: 'Regions', value: new Set(findings.map((f: any) => f.region)).size.toString(), color: 'text-tertiary', border: 'border-tertiary/40', icon: 'public' },
                        { label: 'Accounts', value: (scannedAccounts.size || new Set(findings.map((f: any) => f.account)).size).toString(), color: 'text-yellow-500', border: 'border-yellow-500/40', icon: 'manage_accounts' },
                        { label: 'Risk Level', value: metrics.risk, color: metrics.risk === 'High' ? 'text-error' : 'text-primary', border: 'border-error/40', icon: 'security' }
                      ].map((stat, i) => (
                        <div 
                          key={i}
                          className={`bg-surface-container p-8 border border-outline-variant/10 rounded-3xl flex flex-col items-center justify-center shadow-xl hover:bg-surface-container-high transition-all group hover:-translate-y-1 relative overflow-hidden`}
                        >
                          <div className={`absolute top-0 left-0 w-1 h-full ${stat.color.replace('text-', 'bg-')}`}></div>
                          <span className="material-symbols-outlined text-4xl opacity-10 absolute right-6 top-6 group-hover:scale-110 transition-transform">{stat.icon}</span>
                          <span className="font-label text-[10px] text-on-surface-variant uppercase tracking-[0.2em] mb-3 group-hover:text-on-surface transition-colors font-bold">{stat.label}</span>
                          <span className={`font-headline text-5xl font-black ${stat.color} tabular-nums tracking-tighter`}>{stat.value}</span>
                        </div>
                      ))}
                    </div>

                    {/* Simple Visualization */}
                    <div className="lg:col-span-4 bg-surface-container p-8 rounded-3xl border border-outline-variant/10 flex flex-col items-center justify-center relative overflow-hidden shadow-xl">
                      <h4 className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant mb-8 font-bold">Health Distribution</h4>
                      <div className="relative w-48 h-48">
                        <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                          <path
                            className="text-tertiary/10"
                            strokeDasharray="100, 100"
                            strokeWidth="4"
                            stroke="currentColor"
                            fill="transparent"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                          <path
                            className="text-tertiary"
                            strokeDasharray="77, 100"
                            strokeWidth="4"
                            stroke="currentColor"
                            fill="transparent"
                            strokeLinecap="round"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                          <path
                            className="text-error"
                            strokeDasharray="8, 100"
                            strokeDashoffset="-77"
                            strokeWidth="4"
                            stroke="currentColor"
                            strokeLinecap="round"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                          <path
                            className="text-yellow-500"
                            strokeDasharray="15, 100"
                            strokeDashoffset="-85"
                            strokeWidth="4"
                            stroke="currentColor"
                            strokeLinecap="round"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-4xl font-black text-on-surface tracking-tighter">{metrics.total}</span>
                          <span className="text-[9px] text-on-surface-variant uppercase tracking-widest font-bold">Total</span>
                        </div>
                      </div>
                      <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-3 w-full">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full bg-tertiary"></div>
                          <span className="text-[10px] text-on-surface-variant uppercase font-bold">Healthy</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full bg-error"></div>
                          <span className="text-[10px] text-on-surface-variant uppercase font-bold">Zombie</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
                          <span className="text-[10px] text-on-surface-variant uppercase font-bold">Stale</span>
                        </div>
                      </div>
                      
                      {/* Regional Distribution Bar Chart */}
                      <div className="mt-10 w-full space-y-4">
                        <h5 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant border-b border-outline-variant/20 pb-2">Regional Load</h5>
                        {[
                          { region: 'us-east-1', val: 45, color: 'bg-primary' },
                          { region: 'us-west-2', val: 30, color: 'bg-tertiary' },
                          { region: 'eu-west-1', val: 15, color: 'bg-yellow-500' },
                          { region: 'ap-south-1', val: 10, color: 'bg-error' }
                        ].map((r, i) => (
                          <div key={i} className="space-y-1.5">
                            <div className="flex justify-between text-[9px] font-mono text-on-surface-variant uppercase font-bold">
                              <span>{r.region}</span>
                              <span>{r.val}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${r.val}%` }}
                                className={`h-full ${r.color} shadow-[0_0_8px_rgba(0,0,0,0.3)]`}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Detailed Findings Table */}
                  <div className="bg-surface-container rounded-3xl border border-outline-variant/10 overflow-hidden shadow-2xl">
                    <div className="bg-surface-container-high px-8 py-5 border-b border-outline-variant/20 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-primary">inventory</span>
                        <h3 className="font-headline font-bold text-sm uppercase tracking-widest">Resource Inventory</h3>
                      </div>
                      <div className="flex items-center gap-6">
                        <button
                          onClick={downloadCSV}
                          disabled={findings.length === 0}
                          className="text-[10px] font-mono text-on-surface-variant hover:text-primary transition-colors flex items-center gap-2 font-bold uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <span className="material-symbols-outlined text-sm">download</span>
                          Download CSV
                        </button>
                        <div className="h-4 w-[1px] bg-outline-variant/30"></div>
                        <button
                          onClick={downloadHTMLReport}
                          disabled={findings.length === 0 || isGeneratingHtml}
                          className="text-[10px] font-mono text-on-surface-variant hover:text-primary transition-colors flex items-center gap-2 font-bold uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <span className="material-symbols-outlined text-sm">{isGeneratingHtml ? 'sync' : 'html'}</span>
                          {isGeneratingHtml ? 'Building...' : 'Download HTML'}
                        </button>
                        <div className="h-4 w-[1px] bg-outline-variant/30"></div>
                        <button 
                          onClick={resetScan}
                          className="text-[10px] font-mono text-on-surface-variant hover:text-primary transition-colors flex items-center gap-2 font-bold uppercase tracking-widest"
                        >
                          <span className="material-symbols-outlined text-sm">refresh</span>
                          New Scan
                        </button>
                        <div className="h-4 w-[1px] bg-outline-variant/30"></div>
                        <span className="text-[10px] font-mono text-on-surface-variant uppercase font-bold tracking-widest">Showing {findings.length} findings</span>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-surface-container-lowest/30">
                            <th className="px-8 py-5 text-[10px] font-label uppercase tracking-widest text-on-surface-variant border-b border-outline-variant/10 font-bold">Resource ID</th>
                            <th className="px-8 py-5 text-[10px] font-label uppercase tracking-widest text-on-surface-variant border-b border-outline-variant/10 font-bold">Type</th>
                            <th className="px-8 py-5 text-[10px] font-label uppercase tracking-widest text-on-surface-variant border-b border-outline-variant/10 font-bold">Account</th>
                            <th className="px-8 py-5 text-[10px] font-label uppercase tracking-widest text-on-surface-variant border-b border-outline-variant/10 font-bold">Status</th>
                            <th className="px-8 py-5 text-[10px] font-label uppercase tracking-widest text-on-surface-variant border-b border-outline-variant/10 font-bold">Optimization</th>
                            <th className="px-8 py-5 text-[10px] font-label uppercase tracking-widest text-on-surface-variant border-b border-outline-variant/10 font-bold text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/10">
                          {findings.map((f, i) => (
                            <tr key={i} className="hover:bg-white/2 transition-colors group">
                              <td className="px-8 py-5 font-mono text-xs text-on-surface font-bold">
                                <div className="flex flex-col">
                                  <span>{f.id}</span>
                                  <span className="text-[10px] text-on-surface-variant font-normal truncate max-w-[200px]">{f.resource}</span>
                                </div>
                              </td>
                              <td className="px-8 py-5 text-xs text-on-surface-variant font-medium">{f.type}</td>
                              <td className="px-8 py-5 font-mono text-xs text-on-surface-variant">{f.account}</td>
                              <td className="px-8 py-5">
                                <span className={`text-[9px] font-black uppercase px-3 py-1 rounded-full border ${
                                  f.status === 'Active' || f.status === 'running' ? 'bg-tertiary/10 text-tertiary border-tertiary/20' : 'bg-error/10 text-error border-error/20'
                                }`}>
                                  {f.status}
                                </span>
                              </td>
                              <td className="px-8 py-5 text-xs text-on-surface-variant font-mono">{f.optimization}</td>
                              <td className="px-8 py-5 text-right">
                                <button 
                                  onClick={() => setSelectedFinding(f)}
                                  className="bg-primary/10 hover:bg-primary text-primary hover:text-on-primary px-4 py-1.5 rounded-full text-[10px] uppercase font-black tracking-widest transition-all"
                                >
                                  {f.action}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-8 pt-4">
                    <button
                      onClick={handleDownloadReport}
                      disabled={isGeneratingReport}
                      className="bg-surface-container-high hover:bg-primary text-on-surface hover:text-on-primary font-label text-[11px] uppercase tracking-widest px-12 py-5 border border-outline-variant/20 flex items-center gap-3 rounded-3xl transition-all active:scale-95 shadow-xl group disabled:opacity-50"
                    >
                      {isGeneratingReport ? (
                        <span className="material-symbols-outlined animate-spin">sync</span>
                      ) : (
                        <span className="material-symbols-outlined group-hover:-translate-y-1 transition-transform">download</span>
                      )}
                      {isGeneratingReport ? 'Generating...' : 'Download Excel Report'}
                    </button>
                    <button
                      onClick={downloadHTMLReport}
                      disabled={findings.length === 0 || isGeneratingHtml}
                      className="bg-surface-container-high hover:bg-primary text-on-surface hover:text-on-primary font-label text-[11px] uppercase tracking-widest px-12 py-5 border border-outline-variant/20 flex items-center gap-3 rounded-3xl transition-all active:scale-95 shadow-xl group disabled:opacity-50"
                    >
                      {isGeneratingHtml ? (
                        <span className="material-symbols-outlined animate-spin">sync</span>
                      ) : (
                        <span className="material-symbols-outlined group-hover:-translate-y-1 transition-transform">html</span>
                      )}
                      {isGeneratingHtml ? 'Building...' : 'Download HTML Report'}
                    </button>
                    <button 
                      onClick={handleS3Upload}
                      disabled={isUploading}
                      className="bg-surface-container-high hover:bg-tertiary text-on-surface hover:text-on-tertiary font-label text-[11px] uppercase tracking-widest px-12 py-5 border border-outline-variant/20 flex items-center gap-3 rounded-3xl transition-all active:scale-95 shadow-xl group disabled:opacity-50"
                    >
                      {isUploading ? (
                        <span className="material-symbols-outlined animate-spin">sync</span>
                      ) : (
                        <span className="material-symbols-outlined group-hover:-translate-y-1 transition-transform">cloud_upload</span>
                      )}
                      {isUploading ? 'Syncing...' : 'Sync to S3 Bucket'}
                    </button>
                    <button className="bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label text-[11px] uppercase tracking-widest px-12 py-5 border border-outline-variant/20 flex items-center gap-3 rounded-3xl transition-all active:scale-95 shadow-xl group">
                      <span className="material-symbols-outlined group-hover:rotate-12 transition-transform">description</span>
                      Download Full Log
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    }
  </div>
</main>
</div>

      {/* Finding Details Modal */}
      <AnimatePresence>
        {selectedFinding && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedFinding(null)}
              className="absolute inset-0 bg-surface-dim/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="relative w-full max-w-2xl bg-surface-container-low rounded-[40px] border border-outline-variant/30 shadow-2xl overflow-hidden"
            >
              <div className="bg-surface-container-high px-10 py-8 border-b border-outline-variant/20 flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                    <span className="material-symbols-outlined text-3xl">inventory_2</span>
                  </div>
                  <div>
                    <h3 className="font-headline font-black text-2xl text-on-surface tracking-tight leading-none">Resource Details</h3>
                    <p className="text-[10px] text-on-surface-variant uppercase tracking-[0.2em] mt-2 font-mono font-bold opacity-70">{selectedFinding.id}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedFinding(null)}
                  className="w-12 h-12 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-all hover:rotate-90 active:scale-90"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="p-10 space-y-10">
                <div className="grid grid-cols-2 gap-x-12 gap-y-8">
                  <div className="space-y-2">
                    <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-[0.15em] opacity-60">Resource Type</p>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-xl">category</span>
                      <p className="text-xl font-headline font-black text-on-surface">{selectedFinding.type}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-[0.15em] opacity-60">Account ID</p>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-on-surface-variant text-xl">account_balance</span>
                      <p className="text-xl font-mono font-bold text-on-surface tracking-tight">{selectedFinding.account}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-[0.15em] opacity-60">Region</p>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-on-surface-variant text-xl">public</span>
                      <p className="text-xl font-headline font-black text-on-surface">{selectedFinding.region}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-[0.15em] opacity-60">Last Activity</p>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-yellow-500 text-xl">history</span>
                      <p className="text-xl font-headline font-black text-on-surface">{selectedFinding.lastUsed}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-surface-container-highest/50 rounded-3xl p-8 border border-outline-variant/20 space-y-4">
                  <div className="flex items-center gap-3 text-tertiary">
                    <span className="material-symbols-outlined">lightbulb</span>
                    <h4 className="font-headline font-black text-lg tracking-tight">Recommended Action</h4>
                  </div>
                  <p className="text-on-surface-variant leading-relaxed text-sm">
                    This resource has been identified as a <span className="text-on-surface font-bold">Zombie Resource</span> due to inactivity for over {scanOptions.idleDays} days. We recommend decommissioning this resource to reduce cloud sprawl and unnecessary costs.
                  </p>
                </div>

                <div className="flex gap-4 pt-4">
                  <button className="flex-1 bg-error text-on-error font-label text-[11px] uppercase tracking-widest py-5 rounded-3xl flex items-center justify-center gap-3 hover:opacity-90 transition-all active:scale-95 shadow-xl shadow-error/20">
                    <span className="material-symbols-outlined">delete_forever</span>
                    Decommission Resource
                  </button>
                  <button className="flex-1 bg-surface-container-highest text-on-surface font-label text-[11px] uppercase tracking-widest py-5 rounded-3xl flex items-center justify-center gap-3 hover:bg-outline-variant/20 transition-all active:scale-95 border border-outline-variant/30">
                    <span className="material-symbols-outlined">verified</span>
                    Mark as Exception
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
