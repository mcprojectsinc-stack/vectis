import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { api } from './lib/api';
import Login from './pages/Login';
import Overview from './pages/Dashboard';
import Tickets from './pages/Tickets';
import Integrations from './pages/Integrations';
import AgentSetup from './pages/AgentSetup';
import Assistant from './pages/Assistant';
import { IconOverview, IconTickets, IconIntegrations, IconAgents, IconAssistant, IconBell } from './components/icons';
import iconUrl from './assets/vectis-icon.png';

type View = 'overview' | 'tickets' | 'assistant' | 'integrations' | 'agents';

interface Notif { id: string; recipient: string; message: string; created_at: number }

export default function App() {
  const { user, tenant, loading, logout } = useAuth();
  const [view, setView] = useState<View>('overview');
  const [summary, setSummary] = useState<any>(null);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [askInit, setAskInit] = useState<string | null>(null);

  const askVectis = (q?: string) => { setAskInit(q ?? null); setView('assistant'); };

  useEffect(() => {
    if (!user) return;
    const load = () => {
      api('/summary').then(setSummary).catch(() => {});
      api('/notifications').then(setNotifs).catch(() => {});
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [user]);

  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Login />;

  const openTickets = summary?.tickets?.open ?? 0;
  const unread = summary?.unreadNotifications ?? 0;
  const nav: { v: View; label: string; icon: ReactNode; badge?: number }[] = [
    { v: 'overview', label: 'Overview', icon: <IconOverview /> },
    { v: 'tickets', label: 'Tickets', icon: <IconTickets />, badge: openTickets },
    { v: 'assistant', label: 'Assistant', icon: <IconAssistant /> },
    { v: 'integrations', label: 'Integrations', icon: <IconIntegrations /> },
    { v: 'agents', label: 'Agents', icon: <IconAgents /> },
  ];
  const titles: Record<View, string> = { overview: 'Overview', tickets: 'Tickets', assistant: 'AI Assistant', integrations: 'Integrations', agents: 'Agents' };

  function toggleNotifs() {
    setNotifOpen((o) => {
      if (!o && unread > 0) api('/notifications/read', { method: 'POST' }).catch(() => {});
      return !o;
    });
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-brand">
          <img className="side-logo" src={iconUrl} alt="" />
          <span>Vectis</span>
        </div>
        <nav className="side-nav">
          {nav.map((n) => (
            <button key={n.v} className={view === n.v ? 'active' : ''} onClick={() => setView(n.v)}>
              <span className="ic">{n.icon}</span>
              <span className="lbl">{n.label}</span>
              {n.badge ? <span className="nav-badge">{n.badge}</span> : null}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <div className="avatar">{(user.email[0] || '?').toUpperCase()}</div>
            <div className="su-meta">
              <div className="su-org">{tenant?.name}</div>
              <div className="su-mail">{user.email}</div>
            </div>
          </div>
          <button className="ghost side-signout" onClick={logout}>Sign out</button>
          <div className="side-by">A product of <strong>MCprojects INC</strong></div>
        </div>
      </aside>

      <div className="content">
        <header className="content-header">
          <h1>{titles[view]}</h1>
          <div className="head-actions">
            <button className="ask-btn" onClick={() => askVectis()} title="Ask Vectis">
              <IconAssistant /> <span>Ask Vectis</span>
            </button>
            <span className="env-pill live"><span className="live-dot" aria-hidden />{tenant?.name || 'Live'}</span>
            <div className="bell-wrap">
              <button className="bell" onClick={toggleNotifs} aria-label="Notifications">
                <IconBell />
                {unread > 0 && <span className="bell-dot">{unread > 9 ? '9+' : unread}</span>}
              </button>
              {notifOpen && (
                <div className="notif-pop">
                  <div className="np-head">Notifications</div>
                  {notifs.length ? (
                    notifs.slice(0, 14).map((n) => (
                      <div className="np-item" key={n.id}>
                        <div className="np-msg">{n.message}</div>
                        <div className="np-meta muted small">
                          {n.recipient} · {new Date(n.created_at).toLocaleTimeString()}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="np-empty muted">No notifications yet.</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content-body">
          {view === 'overview' && <Overview onAsk={askVectis} />}
          {view === 'tickets' && <Tickets />}
          {view === 'assistant' && <Assistant initialQuestion={askInit} onConsumed={() => setAskInit(null)} />}
          {view === 'integrations' && <Integrations />}
          {view === 'agents' && <AgentSetup />}
        </main>
      </div>
    </div>
  );
}
