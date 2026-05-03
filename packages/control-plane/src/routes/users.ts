import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { AdminRole } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { createError } from '../middleware/errorHandler'

export const usersRouter = Router()

const createUserSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  role: z.nativeEnum(AdminRole).default('PROJECT_ADMIN'),
})

usersRouter.get('/', async (_req, res, next) => {
  try {
    const users = await prisma.adminUser.findMany({
      select: { id: true, username: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ data: users })
  } catch (err) {
    next(err)
  }
})

usersRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createUserSchema.safeParse(req.body)
    if (!parsed.success) {
      return next(createError(parsed.error.message, 400, 'VALIDATION_ERROR'))
    }

    const existing = await prisma.adminUser.findUnique({
      where: { username: parsed.data.username },
    })
    if (existing) return next(createError('Username already exists', 409, 'CONFLICT'))

    const passwordHash = await bcrypt.hash(parsed.data.password, 12)
    const user = await prisma.adminUser.create({
      data: { username: parsed.data.username, passwordHash, role: parsed.data.role },
      select: { id: true, username: true, role: true, createdAt: true },
    })
    res.status(201).json({ data: user })
  } catch (err) {
    next(err)
  }
})
