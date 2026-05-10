import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import { createError } from '../middleware/errorHandler'

export const endUsersRouter = Router()

const registerSchema = z.object({
  workspaceSlug: z.string().min(1),
  projectSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const tokenSchema = z.object({
  workspaceSlug: z.string().min(1),
  projectSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
})

const DUMMY_HASH = '$2a$12$invalidhashpadding00000000000000000000000000000000000'

async function findActiveProject(workspaceSlug: string, projectSlug: string) {
  const ws = await prisma.workspace.findUnique({ where: { slug: workspaceSlug } })
  if (!ws || ws.status !== 'ACTIVE') return null
  return prisma.project.findFirst({
    where: { workspaceId: ws.id, slug: projectSlug, status: 'ACTIVE' },
  })
}

// POST /api/end-users/register
endUsersRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) return next(createError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'))

    const { workspaceSlug, projectSlug, email, password } = parsed.data
    const project = await findActiveProject(workspaceSlug, projectSlug)
    if (!project) return next(createError('Project not found', 404, 'NOT_FOUND'))

    const existing = await prisma.endUser.findUnique({
      where: { projectId_email: { projectId: project.id, email } },
    })
    if (existing) return next(createError('Email already registered', 409, 'CONFLICT'))

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.endUser.create({
      data: { projectId: project.id, email, passwordHash },
      select: { id: true, email: true, createdAt: true },
    })

    res.status(201).json({ data: user })
  } catch (err) {
    next(err)
  }
})

// POST /api/end-users/token
endUsersRouter.post('/token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = tokenSchema.safeParse(req.body)
    if (!parsed.success) return next(createError('Invalid request body', 400, 'VALIDATION_ERROR'))

    const { workspaceSlug, projectSlug, email, password } = parsed.data
    const project = await findActiveProject(workspaceSlug, projectSlug)
    if (!project) {
      await bcrypt.compare(password, DUMMY_HASH)
      return next(createError('Invalid credentials', 401, 'UNAUTHORIZED'))
    }

    const user = await prisma.endUser.findUnique({
      where: { projectId_email: { projectId: project.id, email } },
    })
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH)
      return next(createError('Invalid credentials', 401, 'UNAUTHORIZED'))
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) return next(createError('Invalid credentials', 401, 'UNAUTHORIZED'))

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        projectId: project.id,
        projectSlug: project.slug,
        workspaceSlug,
      },
      env.GATEWAY_JWT_SECRET,
      { expiresIn: '24h' },
    )

    res.json({ token, expiresIn: 86400 })
  } catch (err) {
    next(err)
  }
})
