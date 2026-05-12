import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { redis } from '../lib/redis'
import { logger } from '../lib/logger'
import { createError } from '../middleware/errorHandler'
import { signUserJwt, requireUser } from '../middleware/auth'
import { generateOpaqueToken, hashToken } from '../lib/tokens'
import { sendActivationEmail, sendPasswordResetEmail } from '../lib/mailer'

export const authRouter = Router()

const DUMMY_HASH = '$2a$12$invalidhashpadding00000000000000000000000000000000000'

// =====================================================
// Rate limiting (Redis fixed window)
// =====================================================

async function rateLimit(req: Request, res: Response, key: string, max: number, windowSec: number): Promise<boolean> {
  try {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
    const fullKey = `rl:auth:${key}:${ip}`
    const count = await redis.incr(fullKey)
    if (count === 1) await redis.expire(fullKey, windowSec)
    if (count > max) {
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } })
      return false
    }
    return true
  } catch (err) {
    // If Redis is down, do not block auth — but log the issue
    logger.warn({ err, key }, 'Rate-limit check failed (Redis unreachable)')
    return true
  }
}

// =====================================================
// POST /auth/register
// =====================================================
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  displayName: z.string().min(1).max(80).optional(),
})

authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await rateLimit(req, res, 'register', 5, 3600))) return

    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      return next(createError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'))
    }
    const email = parsed.data.email.trim().toLowerCase()
    const { password, displayName } = parsed.data

    const existing = await prisma.user.findUnique({ where: { email } })
    // Generic response to prevent user enumeration
    const okResponse = { message: 'If the email is valid, an activation link has been sent.' }

    if (existing) {
      // If pending activation, regenerate token and resend (still generic to caller)
      if (existing.status === 'PENDING_ACTIVATION') {
        await issueActivationToken(existing.id, email)
      }
      return res.status(202).json(okResponse)
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: { email, passwordHash, displayName, status: 'PENDING_ACTIVATION' },
    })
    await issueActivationToken(user.id, email)
    res.status(202).json(okResponse)
  } catch (err) {
    next(err)
  }
})

async function issueActivationToken(userId: string, email: string): Promise<void> {
  const { raw, hash } = generateOpaqueToken(32)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
  await prisma.emailToken.create({
    data: { userId, type: 'ACTIVATION', tokenHash: hash, expiresAt },
  })
  try {
    await sendActivationEmail(email, raw)
  } catch (err) {
    logger.error({ err, userId }, 'Failed to send activation email')
  }
}

// =====================================================
// POST /auth/resend-activation
// =====================================================
authRouter.post('/resend-activation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await rateLimit(req, res, 'resend', 3, 3600))) return
    const parsed = z.object({ email: z.string().email() }).safeParse(req.body)
    if (!parsed.success) return next(createError('Invalid email', 400, 'VALIDATION_ERROR'))
    const email = parsed.data.email.trim().toLowerCase()
    const user = await prisma.user.findUnique({ where: { email } })
    const ok = { message: 'If the email is valid and pending activation, a new link has been sent.' }
    if (user && user.status === 'PENDING_ACTIVATION') {
      await issueActivationToken(user.id, email)
    }
    res.status(202).json(ok)
  } catch (err) {
    next(err)
  }
})

// =====================================================
// POST /auth/activate
// =====================================================
authRouter.post('/activate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await rateLimit(req, res, 'activate', 20, 3600))) return
    const parsed = z.object({ token: z.string().min(10) }).safeParse(req.body)
    if (!parsed.success) return next(createError('Invalid token', 400, 'VALIDATION_ERROR'))

    const tokenHash = hashToken(parsed.data.token)
    const record = await prisma.emailToken.findUnique({ where: { tokenHash } })
    if (!record || record.type !== 'ACTIVATION' || record.consumedAt || record.expiresAt < new Date()) {
      return next(createError('Token is invalid or expired', 400, 'INVALID_TOKEN'))
    }
    if (!record.userId) {
      return next(createError('Token is invalid', 400, 'INVALID_TOKEN'))
    }

    const user = await prisma.$transaction(async (tx) => {
      // Re-check token under the transaction to avoid double-consume races.
      const fresh = await tx.emailToken.findUnique({ where: { id: record.id } })
      if (!fresh || fresh.consumedAt || fresh.expiresAt < new Date()) {
        throw createError('Token is invalid or expired', 400, 'INVALID_TOKEN')
      }
      await tx.emailToken.update({ where: { id: fresh.id }, data: { consumedAt: new Date() } })
      return tx.user.update({
        where: { id: fresh.userId! },
        data: { status: 'ACTIVE', emailVerifiedAt: new Date() },
      })
    })

    const jwtToken = signUserJwt({ sub: user.id, email: user.email, systemRole: user.systemRole })
    res.json({ token: jwtToken, user: { id: user.id, email: user.email, systemRole: user.systemRole, displayName: user.displayName } })
  } catch (err) {
    next(err)
  }
})

// =====================================================
// POST /auth/login
// =====================================================
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) })

authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await rateLimit(req, res, 'login', 10, 600))) return
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) return next(createError('Invalid request body', 400, 'VALIDATION_ERROR'))

    const email = parsed.data.email.trim().toLowerCase()
    const user = await prisma.user.findUnique({ where: { email } })

    if (!user || !user.passwordHash) {
      // Constant-time response to prevent enumeration
      await bcrypt.compare(parsed.data.password, DUMMY_HASH)
      return next(createError('Invalid credentials', 401, 'UNAUTHORIZED'))
    }

    const valid = await bcrypt.compare(parsed.data.password, user.passwordHash)
    if (!valid) return next(createError('Invalid credentials', 401, 'UNAUTHORIZED'))

    if (user.status === 'PENDING_ACTIVATION') {
      return next(createError('Please activate your account via the email link first', 403, 'PENDING_ACTIVATION'))
    }
    if (user.status === 'SUSPENDED') {
      return next(createError('Account suspended', 403, 'SUSPENDED'))
    }

    const jwtToken = signUserJwt({ sub: user.id, email: user.email, systemRole: user.systemRole })
    res.json({
      token: jwtToken,
      user: { id: user.id, email: user.email, systemRole: user.systemRole, displayName: user.displayName },
    })
  } catch (err) {
    next(err)
  }
})

// =====================================================
// POST /auth/forgot-password
// =====================================================
authRouter.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await rateLimit(req, res, 'forgot', 5, 3600))) return
    const parsed = z.object({ email: z.string().email() }).safeParse(req.body)
    if (!parsed.success) return next(createError('Invalid email', 400, 'VALIDATION_ERROR'))
    const email = parsed.data.email.trim().toLowerCase()
    const user = await prisma.user.findUnique({ where: { email } })
    const ok = { message: 'If the email exists, a reset link has been sent.' }
    if (user && user.status !== 'SUSPENDED') {
      const { raw, hash } = generateOpaqueToken(32)
      await prisma.emailToken.create({
        data: { userId: user.id, type: 'PASSWORD_RESET', tokenHash: hash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      })
      try {
        await sendPasswordResetEmail(email, raw)
      } catch (err) {
        logger.error({ err }, 'Failed to send password reset email')
      }
    }
    res.status(202).json(ok)
  } catch (err) {
    next(err)
  }
})

// =====================================================
// POST /auth/reset-password
// =====================================================
authRouter.post('/reset-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await rateLimit(req, res, 'reset', 10, 3600))) return
    const parsed = z
      .object({ token: z.string().min(10), password: z.string().min(12, 'Password must be at least 12 characters') })
      .safeParse(req.body)
    if (!parsed.success) return next(createError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'))

    const tokenHash = hashToken(parsed.data.token)
    const record = await prisma.emailToken.findUnique({ where: { tokenHash } })
    if (!record || record.type !== 'PASSWORD_RESET' || record.consumedAt || record.expiresAt < new Date() || !record.userId) {
      return next(createError('Token is invalid or expired', 400, 'INVALID_TOKEN'))
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    await prisma.$transaction(async (tx) => {
      const fresh = await tx.emailToken.findUnique({ where: { id: record.id } })
      if (!fresh || fresh.consumedAt || fresh.expiresAt < new Date()) {
        throw createError('Token is invalid or expired', 400, 'INVALID_TOKEN')
      }
      await tx.emailToken.update({ where: { id: fresh.id }, data: { consumedAt: new Date() } })
      await tx.user.update({ where: { id: fresh.userId! }, data: { passwordHash, status: 'ACTIVE' } })
    })

    res.json({ message: 'Password updated. Please log in.' })
  } catch (err) {
    next(err)
  }
})

// =====================================================
// GET /auth/me  — current user profile + workspace memberships
// =====================================================

authRouter.get('/me', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: {
        id: true,
        email: true,
        displayName: true,
        systemRole: true,
        status: true,
        memberships: {
          select: {
            role: true,
            joinedAt: true,
            workspace: { select: { id: true, slug: true, name: true, status: true } },
          },
        },
      },
    })
    if (!user) return next(createError('User not found', 404, 'NOT_FOUND'))
    res.json({ data: user })
  } catch (err) {
    next(err)
  }
})

// =====================================================
// PATCH /auth/me  — update own profile (displayName)
// =====================================================
const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(80).nullable(),
})

authRouter.patch('/me', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateMeSchema.safeParse(req.body)
    if (!parsed.success) return next(createError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'))
    const user = await prisma.user.update({
      where: { id: req.user!.sub },
      data: { displayName: parsed.data.displayName },
      select: { id: true, email: true, displayName: true, systemRole: true, status: true },
    })
    res.json({ data: user })
  } catch (err) {
    next(err)
  }
})
