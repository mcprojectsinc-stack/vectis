import nodemailer from 'nodemailer';

export interface SmtpCfg { host: string; port: number; secure: boolean; user: string; pass: string; from: string }

export async function sendEmail(cfg: SmtpCfg, to: string, subject: string, text: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port || 587,
    secure: !!cfg.secure, // true for 465, false for 587/STARTTLS
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  await transport.sendMail({ from: cfg.from || cfg.user, to, subject, text });
}

export async function verifySmtp(cfg: SmtpCfg): Promise<void> {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port || 587,
    secure: !!cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  await transport.verify();
}
