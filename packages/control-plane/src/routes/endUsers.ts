import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import { createError } from '../middleware/errorHandler'

export const endUsersRouter = Router()

const registerSchema = z.object({
  projectSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const tokenSchema = z.object({
  projectSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
})

// POST /api/end-users/register
// Public — registers an API consumer scoped to a project
endUsersRouter.post('/register', async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body)
    if (!parsed.success) {
      return next(createError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'))
    }

    const { projectSlug, email, password } = parsed.data

    const project = await prisma.project.findUnique({
      where: { slug: projectSlug, status: 'ACTIVE' },
    })
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
// Public — returns a JWT signed with GATEWAY_JWT_SECRET for use on protected gateway routes
endUsersRouter.post('/token', async (req, res, next) => {
  try {
    const parsed = tokenSchema.safeParse(req.body)
    if (!parsed.success) {
      return next(createError('Invalid request body', 400, 'VALIDATION_ERROR'))
    }

    const { projectSlug, email, password } = parsed.data

    const project = await prisma.project.findUnique({
      where: { slug: projectSlug, status: 'ACTIVE' },
    })
    if (!project) {
      // Prevent timing-based project enumeration
      await bcrypt.compare(password, '$2a$12$invalidhashpadding000000000000000000000000000000000000')
      return next(createError('Invalid credentials', 401, 'UNAUTHORIZED'))
    }

    const user = await prisma.endUser.findUnique({
      where: { projectId_email: { projectId: project.id, email } },
    })
    if (!user) {
      await bcrypt.compare(password, '$2a$12$invalidhashpadding000000000000000000000000000000000000')
      return next(createError('Invalid credentials', 401, 'UNAUTHORIZED'))
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return next(createError('Invalid credentials', 401, 'UNAUTHORIZED'))
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, projectId: project.id, projectSlug: project.slug },
      env.GATEWAY_JWT_SECRET,
      { expiresIn: '24h' },
    )

    res.json({ token, expiresIn: 86400 })
  } catch (err) {
    next(err)
  }
})
