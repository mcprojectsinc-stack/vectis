import type { Request, Response, NextFunction } from 'express';

// Small in-memory fixed-window rate limiter (no external deps). Good enough to blunt
// credential-stuffing/brute force on a single-process deployment; swap for Redis if scaled out.
interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();

export function rateLimit(opts: { windowMs: number; max: number; key: (req: Request) => string; message?: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const k = `${opts.key(req)}`;
    let b = buckets.get(k);
    if (!b || b.resetAt < now) { b = { count: 0, resetAt: now + opts.windowMs }; buckets.set(k, b); }
    b.count++;
    if (b.count > opts.max) {
      const retry = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: opts.message || `Too many attempts. Try again in ${retry}s.` });
    }
    next();
  };
}

export function clientIp(req: Request): string {
  const xf = (req.headers['x-forwarded-for'] as string) || '';
  return (xf.split(',')[0] || req.socket.remoteAddress || 'unknown').trim();
}

// Periodically drop expired buckets so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
}, 10 * 60_000).unref?.();

// Baseline security headers (helmet-lite, no dependency).
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}
