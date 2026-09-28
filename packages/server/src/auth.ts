import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { config } from './config';
import { rateLimit, clientIp } from './security';

const MIN_PW = 8;
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: 8, key: (req) => 'login:' + clientIp(req) + ':' + String(req.body?.email || ''), message: 'Too many sign-in attempts. Please wait a few minutes and try again.' });
const signupLimiter = rateLimit({ windowMs: 60 * 60_000, max: 5, key: (req) => 'signup:' + clientIp(req), message: 'Too many sign-up attempts from this location. Please try again later.' });

export function signToken(uid: string, tid: string): string {
  return jwt.sign({ uid, tid }, config.jwtSecret, { expiresIn: '7d' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' });
  try {
    const payload = jwt.verify(h.slice(7), config.jwtSecret) as { uid: string; tid: string };
    req.user = { uid: payload.uid, tid: payload.tid };
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}

export const authRouter = Router();

authRouter.post('/signup', signupLimiter, (req, res) => {
  const { email, password, orgName } = req.body ?? {};
  if (!email || !String(email).includes('@')) {
    return res.status(400).json({ error: 'a valid email is required' });
  }
  if (!password || String(password).length < MIN_PW) {
    return res.status(400).json({ error: `password must be at least ${MIN_PW} characters` });
  }
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
    return res.status(409).json({ error: 'email already registered' });
  }
  const now = Date.now();
  const tenantId = randomUUID();
  const enrollToken = randomUUID().replace(/-/g, '');
  const name = orgName || String(email).split('@')[1] || 'My Org';
  db.prepare('INSERT INTO tenants (id,name,enroll_token,created_at) VALUES (?,?,?,?)').run(tenantId, name, enrollToken, now);
  const uid = randomUUID();
  db.prepare('INSERT INTO users (id,tenant_id,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)').run(
    uid, tenantId, email, bcrypt.hashSync(String(password), 10), 'owner', now,
  );
  res.json({ token: signToken(uid, tenantId), user: { id: uid, email, role: 'owner' }, tenant: { id: tenantId, name, enrollToken } });
});

authRouter.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body ?? {};
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email) as
    | { id: string; tenant_id: string; email: string; password_hash: string; role: string }
    | undefined;
  if (!user || !bcrypt.compareSync(String(password ?? ''), user.password_hash)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  res.json({ token: signToken(user.id, user.tenant_id), user: { id: user.id, email: user.email, role: user.role } });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id,email,role FROM users WHERE id=?').get(req.user!.uid) as { id: string; email: string; role: string };
  const tenant = db.prepare('SELECT id,name,enroll_token FROM tenants WHERE id=?').get(req.user!.tid) as { id: string; name: string; enroll_token: string };
  res.json({ user, tenant: { id: tenant.id, name: tenant.name, enrollToken: tenant.enroll_token } });
});

/** Change your own password (requires the current one). */
authRouter.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!newPassword || String(newPassword).length < MIN_PW) {
    return res.status(400).json({ error: `new password must be at least ${MIN_PW} characters` });
  }
  const user = db.prepare('SELECT id,password_hash FROM users WHERE id=?').get(req.user!.uid) as { id: string; password_hash: string } | undefined;
  if (!user || !bcrypt.compareSync(String(currentPassword ?? ''), user.password_hash)) {
    return res.status(401).json({ error: 'current password is incorrect' });
  }
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(String(newPassword), 10), user.id);
  res.json({ ok: true });
});
