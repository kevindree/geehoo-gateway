import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import { createError } from '../middleware/errorHandler'

export const internalRouter = Router()

// Guard: all routes under /internal require the shared service secret
internalRouter.use((req: Request, res: Response, next: NextFunction): void => {
  if (req.headers['x-internal-secret'] !== env.INTERNAL_SERVICE_SECRET) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid internal service secret' } })
    return
  }
  next()
})

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const DUMMY_HASH = '$2a$12$invalidhashpadding00000000000000000000000000000000000'

// POST /internal/projects/:projectId/auth/verify
// Called by gateway gateway_auth_verify node to authenticate an EndUser by credentials
internalRouter.post('/projects/:projectId/auth/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = credentialsSchema.safeParse(req.body)
    if (!parsed.success) {
      return next(createError('email and password are required', 400, 'VALIDATION_ERROR'))
    }
    const { email, password } = parsed.data
    const { projectId } = req.params

    const user = await prisma.endUser.findUnique({
      where: { projectId_email: { projectId, email } },
    })

    // Always run bcrypt to prevent timing-based user enumeration
    const hash = user?.passwordHash ?? DUMMY_HASH
    const valid = await bcrypt.compare(password, hash)

    if (!user || !valid) {
      return next(createError('Invalid credentials', 401, 'UNAUTHORIZED'))
    }

    res.json({ sub: user.id, email: user.email, projectId })
  } catch (err) {
    next(err)
  }
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

// POST /internal/projects/:projectId/auth/register
// Called by gateway gateway_auth_register node to create a new EndUser
internalRouter.post('/projects/:projectId/auth/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      return next(createError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'))
    }
    const { email, password } = parsed.data
    const { projectId } = req.params

    const project = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project) return next(createError('Project not found', 404, 'NOT_FOUND'))

    const existing = await prisma.endUser.findUnique({
      where: { projectId_email: { projectId, email } },
    })
    if (existing) return next(createError('Email already registered', 409, 'CONFLICT'))

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.endUser.create({
      data: { projectId, email, passwordHash },
      select: { id: true, email: true, projectId: true },
    })

    res.status(201).json({ sub: user.id, email: user.email, projectId: user.projectId })
  } catch (err) {
    next(err)
  }
})

const apiKeyVerifySchema = z.object({
  key: z.string().min(1),
})

// POST /internal/projects/:projectId/apikeys/verify
// Called by the gateway to validate an X-Api-Key header. Returns the matching
// ApiKey record (without sensitive fields) if valid, 401 otherwise.
internalRouter.post('/projects/:projectId/apikeys/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = apiKeyVerifySchema.safeParse(req.body)
    if (!parsed.success) {
      return next(createError('key is required', 400, 'VALIDATION_ERROR'))
    }
    const { projectId } = req.params
    const rawKey = parsed.data.key
    // Use prefix to narrow down candidates (avoid scanning every key in project)
    const keyPrefix = rawKey.slice(0, 12)

    const candidates = await prisma.apiKey.findMany({
      where: { projectId, keyPrefix, enabled: true },
      select: { id: true, label: true, keyHash: true, expiresAt: true },
    })

    // Always run at least one bcrypt to keep timing roughly constant
    const dummyHash = '$2a$12$invalidhashpadding00000000000000000000000000000000000'
    if (candidates.length === 0) {
      await bcrypt.compare(rawKey, dummyHash)
      return next(createError('Invalid API key', 401, 'UNAUTHORIZED'))
    }

    let matched: { id: string; label: string; expiresAt: Date | null } | null = null
    for (const candidate of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await bcrypt.compare(rawKey, candidate.keyHash)
      if (ok) {
        matched = { id: candidate.id, label: candidate.label, expiresAt: candidate.expiresAt }
        break
      }
    }

    if (!matched) {
      return next(createError('Invalid API key', 401, 'UNAUTHORIZED'))
    }
    if (matched.expiresAt && matched.expiresAt < new Date()) {
      return next(createError('API key expired', 401, 'UNAUTHORIZED'))
    }

    res.json({ id: matched.id, label: matched.label, projectId })
  } catch (err) {
    next(err)
  }
})
