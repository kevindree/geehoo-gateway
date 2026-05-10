import nodemailer, { Transporter } from 'nodemailer'
import { env } from './env'
import { logger } from './logger'

interface MailMessage {
  to: string
  subject: string
  html: string
  text: string
}

let transporter: Transporter | null = null

function getTransporter(): Transporter | null {
  if (transporter) return transporter
  if (!env.SMTP_HOST || !env.SMTP_PORT) return null

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  })
  return transporter
}

async function sendMail(msg: MailMessage): Promise<void> {
  const tx = getTransporter()
  if (!tx) {
    if (env.NODE_ENV === 'production') {
      throw new Error('SMTP not configured in production')
    }
    // Dev fallback — log full message including link so developers can use it.
    logger.info(
      { to: msg.to, subject: msg.subject, body: msg.text },
      '[DEV MAIL] SMTP not configured — email content logged to stdout',
    )
    return
  }
  await tx.sendMail({
    from: env.SMTP_FROM ?? 'no-reply@geehoo-gateway.local',
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

export async function sendActivationEmail(to: string, rawToken: string): Promise<void> {
  const link = `${env.APP_PUBLIC_URL.replace(/\/$/, '')}/activate?token=${encodeURIComponent(rawToken)}`
  await sendMail({
    to,
    subject: 'Activate your geehoo-gateway account',
    text: `Welcome to geehoo-gateway!\n\nClick the link below to activate your account (expires in 24 hours):\n${link}\n\nIf you did not sign up, ignore this email.`,
    html: `<p>Welcome to geehoo-gateway!</p><p><a href="${escapeHtml(link)}">Activate your account</a> (expires in 24 hours)</p><p>If you did not sign up, ignore this email.</p>`,
  })
}

export async function sendPasswordResetEmail(to: string, rawToken: string): Promise<void> {
  const link = `${env.APP_PUBLIC_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(rawToken)}`
  await sendMail({
    to,
    subject: 'Reset your geehoo-gateway password',
    text: `Click the link below to reset your password (expires in 1 hour):\n${link}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Click the link below to reset your password (expires in 1 hour):</p><p><a href="${escapeHtml(link)}">Reset password</a></p><p>If you did not request this, ignore this email.</p>`,
  })
}

export async function sendInvitationEmail(params: {
  to: string
  rawToken: string
  workspaceName: string
  inviterEmail: string
}): Promise<void> {
  const { to, rawToken, workspaceName, inviterEmail } = params
  const link = `${env.APP_PUBLIC_URL.replace(/\/$/, '')}/invitations/accept?token=${encodeURIComponent(rawToken)}`
  await sendMail({
    to,
    subject: `You're invited to join "${workspaceName}" on geehoo-gateway`,
    text: `${inviterEmail} has invited you to join the workspace "${workspaceName}".\n\nClick to accept (expires in 7 days):\n${link}`,
    html: `<p><strong>${escapeHtml(inviterEmail)}</strong> has invited you to join the workspace <strong>${escapeHtml(workspaceName)}</strong>.</p><p><a href="${escapeHtml(link)}">Accept invitation</a> (expires in 7 days)</p>`,
  })
}
