import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';

interface Integ { id: string; kind: string; provider: string; status: string; created_at: number }
interface ProviderMeta { id: string; name: string; needsKey: boolean; needsBaseUrl: boolean; modelHint: string }
interface AIConfig { provider: string; model: string; baseUrl: string; enabled: boolean; hasKey: boolean; enabledEffective: boolean }

const CONNECTORS = [
  { provider: 'mock', name: 'Demo tickets (Generic)', desc: 'Built-in sample ITSM tickets — no credentials. Best for trying the autopilot.', attachable: true },
  { provider: 'servicenow', name: 'ServiceNow', desc: 'ITSM & change management via the Table API.', attachable: false },
  { provider: 'zendesk', name: 'Zendesk', desc: 'Support tickets via the Zendesk API.', attachable: false },
  { provider: 'freshservice', name: 'Freshservice', desc: 'ITSM tickets via the Freshservice API.', attachable: false },
];

export default function Integrations() {
  const [integs, setIntegs] = useState<Integ[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api('/integrations').then(setIntegs).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);

  const ticketing = integs.find((i) => i.kind === 'ticketing');

  async function attach() {
    setBusy(true);
    try { await api('/integrations/ticketing', { method: 'POST', body: JSON.stringify({ provider: 'mock' }) }); load(); } catch { /* */ } finally { setBusy(false); }
  }
  async function detach(id: string) {
    setBusy(true);
    try { await api(`/integrations/${id}`, { method: 'DELETE' }); load(); } catch { /* */ } finally { setBusy(false); }
  }

  return (
    <div className="integrations">
      <AISettings />

      <NotificationSettings />

      <JiraSettings />

      <h2 className="sec-title">Ticketing &amp; change management</h2>
      <p className="muted intro">
        Attach your ticketing / change-management system. Once connected, Vectis reads open tickets, triages them by
        severity and precedence, then the autopilot works each one — notifying the assignee, documenting what it did,
        and closing or escalating it. <b>Jira</b> connects in the panel above.
      </p>
      <div className="conn-grid">
        {CONNECTORS.map((c) => {
          const connected = ticketing?.provider === c.provider;
          return (
            <div className={`conn-card ${connected ? 'connected' : ''}`} key={c.provider}>
              <div className="conn-top">
                <div className="conn-logo">{c.name[0]}</div>
                {connected && <span className="badge ok"><span className="dot" aria-hidden>✓</span>Connected</span>}
              </div>
              <div className="conn-name">{c.name}</div>
              <div className="conn-desc muted small">{c.desc}</div>
              <div className="conn-foot">
                {c.attachable ? (
                  connected ? (
                    <button className="ghost sm" disabled={busy} onClick={() => detach(ticketing!.id)}>Detach</button>
                  ) : (
                    <button className="primary sm" disabled={busy || !!ticketing} onClick={attach}>
                      {ticketing ? 'Ticketing attached' : 'Attach'}
                    </button>
                  )
                ) : (
                  <button className="ghost sm" disabled title="Adapter scaffolded — add API credentials to enable">Configure…</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {ticketing && (
        <p className="muted small">Ticketing connected. Head to <b>Tickets</b> to watch the autopilot work the queue.</p>
      )}

      <AccountSecurity />
    </div>
  );
}

function AISettings() {
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [cfg, setCfg] = useState<AIConfig | null>(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<ProviderMeta[]>('/ai/providers').then(setProviders).catch(() => {});
    api<AIConfig>('/ai/config').then((c) => {
      setCfg(c);
      setProvider(c.provider); setModel(c.model); setBaseUrl(c.baseUrl); setEnabled(c.enabled || !c.provider);
    }).catch(() => {});
  }, []);

  const meta = providers.find((p) => p.id === provider);

  async function save() {
    setBusy(true); setMsg('');
    try {
      const c = await api<AIConfig>('/ai/config', { method: 'POST', body: JSON.stringify({ provider, model, baseUrl, enabled, apiKey: apiKey || undefined }) });
      setCfg(c); setApiKey('');
      setMsg('Saved.');
    } catch (e) { setMsg(`⚠️ ${(e as Error).message}`); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setMsg('Testing…');
    try {
      const r = await api<{ ok: boolean; reply?: string; error?: string }>('/ai/config/test', { method: 'POST', body: JSON.stringify({ provider, model, baseUrl, apiKey: apiKey || undefined }) });
      setMsg(r.ok ? `✓ Connection OK${r.reply ? ` — replied “${r.reply}”` : ''}` : `⚠️ ${r.error}`);
    } catch (e) { setMsg(`⚠️ ${(e as Error).message}`); } finally { setBusy(false); }
  }

  return (
    <div className="ai-settings panel">
      <div className="ai-head">
        <div>
          <h2 className="sec-title" style={{ margin: 0 }}>AI provider</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Connect any AI to power diagnosis, the assistant, auto-documentation, and natural-language actions.
          </p>
        </div>
        {cfg && (
          <span className={`badge ${cfg.enabledEffective ? 'ok' : ''}`}>
            <span className="dot" aria-hidden>{cfg.enabledEffective ? '✓' : '○'}</span>
            {cfg.enabledEffective ? `Active · ${cfg.provider}` : 'Not connected'}
          </span>
        )}
      </div>

      <div className="ai-form">
        <label className="fld">
          <span>Provider</span>
          <select value={provider} onChange={(e) => { setProvider(e.target.value); setMsg(''); }}>
            <option value="">Select…</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        {provider && provider !== 'mock' && (
          <label className="fld">
            <span>Model</span>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={meta?.modelHint || 'model id'} />
          </label>
        )}

        {meta?.needsBaseUrl && (
          <label className="fld">
            <span>{provider === 'azure' ? 'Azure endpoint' : 'Base URL'}</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider === 'azure' ? 'https://<resource>.openai.azure.com' : provider === 'copilot' ? 'http://localhost:4141/v1' : 'http://localhost:11434/v1'} />
          </label>
        )}

        {meta?.needsKey && (
          <label className="fld">
            <span>API key {cfg?.hasKey && <em className="muted small">(saved — leave blank to keep)</em>}</span>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={cfg?.hasKey ? '••••••••' : 'paste key'} autoComplete="off" />
          </label>
        )}

        {(provider === 'custom' || provider === 'copilot') && (
          <label className="fld">
            <span>API key <em className="muted small">(optional — gateway may carry its own auth)</em></span>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={cfg?.hasKey ? '••••••••' : 'optional'} autoComplete="off" />
          </label>
        )}

        {provider === 'copilot' && (
          <p className="fld muted small" style={{ gridColumn: '1 / -1', margin: 0 }}>
            GitHub retired the direct Models API; reach Copilot by running an OpenAI-compatible Copilot gateway
            (it uses your Copilot subscription) and pointing Base URL at it, e.g. <code>http://localhost:4141/v1</code>.
            Azure AI Foundry works too — pick “Azure OpenAI / AI Foundry”.
          </p>
        )}

        {provider && (
          <label className="fld inline">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>Enabled — let the autopilot and assistant use this provider</span>
          </label>
        )}
      </div>

      <div className="ai-actions">
        <button className="primary sm" disabled={busy || !provider} onClick={save}>Save</button>
        <button className="ghost sm" disabled={busy || !provider} onClick={test}>Test connection</button>
        {msg && <span className="ai-msg small">{msg}</span>}
      </div>
      <p className="muted small ai-note">Keys are stored server-side for your workspace and never sent back to the browser. The built-in demo AI needs no key.</p>
    </div>
  );
}

/* ------------------------------- Notifications ------------------------------- */
interface NotifyCfg {
  slackEnabled: boolean; slackHasUrl: boolean;
  emailEnabled: boolean;
  smtp: { host: string; port: number; secure: boolean; user: string; from: string; hasPass: boolean };
}

function NotificationSettings() {
  const [cfg, setCfg] = useState<NotifyCfg | null>(null);
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackUrl, setSlackUrl] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [from, setFrom] = useState('');
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<NotifyCfg>('/notify/config').then((c) => {
      setCfg(c);
      setSlackEnabled(c.slackEnabled); setEmailEnabled(c.emailEnabled);
      setHost(c.smtp.host); setPort(c.smtp.port); setSecure(c.smtp.secure);
      setUser(c.smtp.user); setFrom(c.smtp.from);
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const active = (cfg?.slackEnabled && cfg?.slackHasUrl) || (cfg?.emailEnabled && !!cfg?.smtp.host);

  async function save() {
    setBusy(true); setMsg('');
    try {
      const c = await api<NotifyCfg>('/notify/config', {
        method: 'POST',
        body: JSON.stringify({
          slackEnabled, slackUrl: slackUrl || undefined, emailEnabled,
          smtp: { host, port, secure, user, from }, smtpPass: pass || undefined,
        }),
      });
      setCfg(c); setSlackUrl(''); setPass(''); setMsg('Saved.');
    } catch (e) { setMsg(`⚠️ ${(e as Error).message}`); } finally { setBusy(false); }
  }
  async function testCh(channel: 'slack' | 'email') {
    setBusy(true); setMsg(`Testing ${channel}…`);
    try {
      await api('/notify/test', {
        method: 'POST',
        body: JSON.stringify({ channel, slackUrl: slackUrl || undefined, smtp: { host, port, secure, user, from }, smtpPass: pass || undefined }),
      });
      setMsg(channel === 'slack' ? '✓ Slack test sent — check your channel.' : '✓ SMTP verified — credentials are good.');
    } catch (e) { setMsg(`⚠️ ${(e as Error).message}`); } finally { setBusy(false); }
  }

  return (
    <div className="ai-settings panel">
      <div className="ai-head">
        <div>
          <h2 className="sec-title" style={{ margin: 0 }}>Notifications</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Where the autopilot sends resolution and escalation alerts. Both channels are optional.
          </p>
        </div>
        <span className={`badge ${active ? 'ok' : ''}`}>
          <span className="dot" aria-hidden>{active ? '✓' : '○'}</span>
          {active ? 'Active' : 'Not connected'}
        </span>
      </div>

      <div className="ai-form">
        <label className="fld inline" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={slackEnabled} onChange={(e) => setSlackEnabled(e.target.checked)} />
          <span>Slack — post alerts to an incoming webhook</span>
        </label>
        {slackEnabled && (
          <label className="fld" style={{ gridColumn: '1 / -1' }}>
            <span>Webhook URL {cfg?.slackHasUrl && <em className="muted small">(saved — leave blank to keep)</em>}</span>
            <input type="password" value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)} placeholder={cfg?.slackHasUrl ? '••••••••' : 'https://hooks.slack.com/services/…'} autoComplete="off" />
          </label>
        )}

        <label className="fld inline" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={emailEnabled} onChange={(e) => setEmailEnabled(e.target.checked)} />
          <span>Email — send alerts over your SMTP server</span>
        </label>
        {emailEnabled && (
          <>
            <label className="fld"><span>SMTP host</span><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.example.com" /></label>
            <label className="fld"><span>Port</span><input type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 587)} placeholder="587" /></label>
            <label className="fld"><span>Username</span><input value={user} onChange={(e) => setUser(e.target.value)} placeholder="bot@example.com" autoComplete="off" /></label>
            <label className="fld"><span>Password {cfg?.smtp.hasPass && <em className="muted small">(saved — blank keeps)</em>}</span><input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={cfg?.smtp.hasPass ? '••••••••' : 'app password'} autoComplete="off" /></label>
            <label className="fld"><span>From address</span><input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Vectis &lt;alerts@example.com&gt;" /></label>
            <label className="fld inline"><input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} /><span>Use TLS on connect (port 465)</span></label>
          </>
        )}
      </div>

      <div className="ai-actions">
        <button className="primary sm" disabled={busy} onClick={save}>Save</button>
        {slackEnabled && <button className="ghost sm" disabled={busy} onClick={() => testCh('slack')}>Test Slack</button>}
        {emailEnabled && <button className="ghost sm" disabled={busy} onClick={() => testCh('email')}>Test email</button>}
        {msg && <span className="ai-msg small">{msg}</span>}
      </div>
      <p className="muted small ai-note">Webhook URLs and SMTP passwords are encrypted at rest and never returned to the browser.</p>
    </div>
  );
}

/* ---------------------------------- Jira ---------------------------------- */
interface JiraCfg { enabled: boolean; baseUrl: string; email: string; jql: string; hasToken: boolean }

function JiraSettings() {
  const [cfg, setCfg] = useState<JiraCfg | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [jql, setJql] = useState('');
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<JiraCfg>('/jira/config').then((c) => {
      setCfg(c); setEnabled(c.enabled); setBaseUrl(c.baseUrl); setEmail(c.email); setJql(c.jql);
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const connected = !!(cfg?.enabled && cfg?.baseUrl && cfg?.hasToken);

  async function save() {
    setBusy(true); setMsg('');
    try {
      const c = await api<JiraCfg>('/jira/config', { method: 'POST', body: JSON.stringify({ enabled, baseUrl, email, jql, token: token || undefined }) });
      setCfg(c); setToken(''); setMsg('Saved.');
    } catch (e) { setMsg(`⚠️ ${(e as Error).message}`); } finally { setBusy(false); }
  }
  async function sync() {
    setBusy(true); setMsg('Syncing…');
    try {
      const r = await api<{ synced?: number; error?: string }>('/jira/sync', { method: 'POST' });
      setMsg(r?.error ? `⚠️ ${r.error}` : `✓ Synced ${r?.synced ?? 0} issue(s) into the queue.`);
    } catch (e) { setMsg(`⚠️ ${(e as Error).message}`); } finally { setBusy(false); }
  }

  return (
    <div className="ai-settings panel">
      <div className="ai-head">
        <div>
          <h2 className="sec-title" style={{ margin: 0 }}>Jira Service Management</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Sync open Jira issues into the queue; the autopilot works them and comments resolutions back to Jira.
          </p>
        </div>
        <span className={`badge ${connected ? 'ok' : ''}`}>
          <span className="dot" aria-hidden>{connected ? '✓' : '○'}</span>
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="ai-form">
        <label className="fld inline" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Enabled — sync every minute and push resolutions back</span>
        </label>
        <label className="fld"><span>Base URL</span><input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://your-org.atlassian.net" /></label>
        <label className="fld"><span>Account email</span><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ops@your-org.com" autoComplete="off" /></label>
        <label className="fld"><span>API token {cfg?.hasToken && <em className="muted small">(saved — blank keeps)</em>}</span><input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={cfg?.hasToken ? '••••••••' : 'Atlassian API token'} autoComplete="off" /></label>
        <label className="fld"><span>JQL filter</span><input value={jql} onChange={(e) => setJql(e.target.value)} placeholder="statusCategory != Done ORDER BY priority DESC" /></label>
      </div>

      <div className="ai-actions">
        <button className="primary sm" disabled={busy} onClick={save}>Save</button>
        <button className="ghost sm" disabled={busy || !connected} onClick={sync}>Sync now</button>
        {msg && <span className="ai-msg small">{msg}</span>}
      </div>
      <p className="muted small ai-note">
        Create a token at <code>id.atlassian.com → Security → API tokens</code>. Tokens are encrypted at rest and never returned to the browser.
      </p>
    </div>
  );
}

/* ---------------------------- Account & security ---------------------------- */
function AccountSecurity() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function change() {
    setMsg('');
    if (next.length < 8) { setMsg('⚠️ New password must be at least 8 characters.'); return; }
    if (next !== confirm) { setMsg('⚠️ New passwords do not match.'); return; }
    setBusy(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: current, newPassword: next }) });
      setCurrent(''); setNext(''); setConfirm(''); setMsg('✓ Password updated.');
    } catch (e) { setMsg(`⚠️ ${(e as Error).message}`); } finally { setBusy(false); }
  }

  return (
    <div className="ai-settings panel">
      <div className="ai-head">
        <div>
          <h2 className="sec-title" style={{ margin: 0 }}>Account &amp; security</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>Change the password for your workspace owner account.</p>
        </div>
      </div>
      <div className="ai-form">
        <label className="fld"><span>Current password</span><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
        <label className="fld"><span>New password</span><input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" placeholder="at least 8 characters" /></label>
        <label className="fld"><span>Confirm new password</span><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></label>
      </div>
      <div className="ai-actions">
        <button className="primary sm" disabled={busy || !current || !next} onClick={change}>Update password</button>
        {msg && <span className="ai-msg small">{msg}</span>}
      </div>
    </div>
  );
}
