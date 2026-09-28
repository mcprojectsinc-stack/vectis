import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import logoUrl from '../assets/vectis-logo.png';

export default function Login() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await signup(email, password, orgName);
    } catch (e) {
      setErr((e as Error).message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <img className="auth-logo" src={logoUrl} alt="Vectis" />
        <p className="muted sub">Enterprise infrastructure troubleshooting, on autopilot</p>

        <div className="seg">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign in</button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Create account</button>
        </div>

        {mode === 'signup' && (
          <label>
            Organization
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Inc" />
          </label>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>

        {err && <div className="error">{err}</div>}
        <button className="primary" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        {mode === 'login' && (
          <p className="hint muted">
            New here? <button type="button" className="linklike" onClick={() => setMode('signup')}>Create your workspace</button>
          </p>
        )}
      </form>
      <p className="auth-by muted">A product of <strong>MCprojects INC</strong></p>
    </div>
  );
}
