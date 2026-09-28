import { getSetting, setSetting } from '../db';
import { encryptSecret, decryptSecret } from '../crypto';
import { sendSlack } from './slack';
import { sendEmail, verifySmtp, type SmtpCfg } from './email';

// Notification channel config lives in settings; secrets (Slack URL, SMTP pass) are
// encrypted at rest and never returned to the browser.
export interface NotifyPublic {
  slackEnabled: boolean; slackHasUrl: boolean;
  emailEnabled: boolean;
  smtp: { host: string; port: number; secure: boolean; user: string; from: string; hasPass: boolean };
}

interface NotifyStored {
  slackEnabled?: boolean; emailEnabled?: boolean;
  smtp?: { host?: string; port?: number; secure?: boolean; user?: string; from?: string };
}

function read(tenantId: string): NotifyStored {
  try { return JSON.parse(getSetting(tenantId, 'notify', '') || '{}'); } catch { return {}; }
}

export function readNotifyPublic(tenantId: string): NotifyPublic {
  const s = read(tenantId);
  const smtp = s.smtp || {};
  return {
    slackEnabled: !!s.slackEnabled,
    slackHasUrl: !!getSetting(tenantId, 'notify_slack_url', ''),
    emailEnabled: !!s.emailEnabled,
    smtp: {
      host: smtp.host || '', port: smtp.port || 587, secure: !!smtp.secure,
      user: smtp.user || '', from: smtp.from || '',
      hasPass: !!getSetting(tenantId, 'notify_smtp_pass', ''),
    },
  };
}

export function writeNotify(tenantId: string, input: any): void {
  const cur = read(tenantId);
  const smtp = input.smtp || {};
  const merged: NotifyStored = {
    slackEnabled: input.slackEnabled ?? cur.slackEnabled ?? false,
    emailEnabled: input.emailEnabled ?? cur.emailEnabled ?? false,
    smtp: {
      host: smtp.host ?? cur.smtp?.host ?? '',
      port: Number(smtp.port ?? cur.smtp?.port ?? 587),
      secure: smtp.secure ?? cur.smtp?.secure ?? false,
      user: smtp.user ?? cur.smtp?.user ?? '',
      from: smtp.from ?? cur.smtp?.from ?? '',
    },
  };
  setSetting(tenantId, 'notify', JSON.stringify(merged));
  if (typeof input.slackUrl === 'string' && input.slackUrl.trim()) setSetting(tenantId, 'notify_slack_url', encryptSecret(input.slackUrl.trim()));
  if (typeof input.smtpPass === 'string' && input.smtpPass.trim()) setSetting(tenantId, 'notify_smtp_pass', encryptSecret(input.smtpPass.trim()));
}

function smtpConfig(tenantId: string): SmtpCfg | null {
  const s = read(tenantId);
  const smtp = s.smtp || {};
  if (!s.emailEnabled || !smtp.host) return null;
  return {
    host: smtp.host, port: smtp.port || 587, secure: !!smtp.secure,
    user: smtp.user || '', from: smtp.from || smtp.user || '',
    pass: decryptSecret(getSetting(tenantId, 'notify_smtp_pass', '')),
  };
}

/** Best-effort fan-out of a notification to the tenant's configured channels. */
export function dispatch(tenantId: string, opts: { recipient?: string | null; subject: string; text: string }): void {
  const s = read(tenantId);
  // Slack
  if (s.slackEnabled) {
    const url = decryptSecret(getSetting(tenantId, 'notify_slack_url', ''));
    if (url) sendSlack(url, `*${opts.subject}*\n${opts.text}`).catch(() => {});
  }
  // Email (to the ticket's assignee/recipient if it looks like an address)
  const smtp = smtpConfig(tenantId);
  const to = opts.recipient && /@/.test(opts.recipient) ? opts.recipient : (smtp?.from || '');
  if (smtp && to) sendEmail(smtp, to, `[Vectis] ${opts.subject}`, opts.text).catch(() => {});
}

export async function testChannel(tenantId: string, channel: string, input: any): Promise<{ ok: boolean; error?: string }> {
  try {
    if (channel === 'slack') {
      const url = (input.slackUrl && input.slackUrl.trim()) || decryptSecret(getSetting(tenantId, 'notify_slack_url', ''));
      if (!url) return { ok: false, error: 'no Slack webhook URL set' };
      await sendSlack(url, ':white_check_mark: Vectis test message — notifications are connected.');
      return { ok: true };
    }
    if (channel === 'email') {
      const s = read(tenantId); const smtp = s.smtp || {};
      const cfg: SmtpCfg = {
        host: input.smtp?.host || smtp.host || '', port: Number(input.smtp?.port || smtp.port || 587),
        secure: input.smtp?.secure ?? smtp.secure ?? false, user: input.smtp?.user || smtp.user || '',
        from: input.smtp?.from || smtp.from || '', pass: (input.smtpPass && input.smtpPass.trim()) || decryptSecret(getSetting(tenantId, 'notify_smtp_pass', '')),
      };
      if (!cfg.host) return { ok: false, error: 'enter an SMTP host first' };
      await verifySmtp(cfg);
      return { ok: true };
    }
    return { ok: false, error: 'unknown channel' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
