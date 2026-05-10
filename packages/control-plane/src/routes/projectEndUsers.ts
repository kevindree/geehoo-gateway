import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { createError } from '../middleware/errorHandler'

export const projectEndUsersRouter = Router({ mergeParams: true })

projectEndUsersRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.endUser.findMany({
      where: { projectId: req.params.projectId },
      select: { id: true, email: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ data: users })
  } catch (err) {
    next(err)
  }
})

const createEndUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

projectEndUsersRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createEndUserSchema.safeParse(req.body)
    if (!parsed.success) return next(createError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'))
    const { email, password } = parsed.data
    const projectId = req.params.projectId

    const existing = await prisma.endUser.findUnique({
      where: { projectId_email: { projectId, email } },
    })
    if (existing) return next(createError('Email already registered', 409, 'CONFLICT'))

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.endUser.create({
      data: { projectId, email, passwordHash },
      select: { id: true, email: true, createdAt: true },
    })

    res.status(201).json({ data: user })
  } catch (err) {
    next(err)
  }
})

projectEndUsersRouter.delete('/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId, userId } = req.params

    const user = await prisma.endUser.findFirst({ where: { id: userId, projectId } })
    if (!user) return next(createError('End user not found', 404, 'NOT_FOUND'))

    await prisma.endUser.delete({ where: { id: userId } })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})
