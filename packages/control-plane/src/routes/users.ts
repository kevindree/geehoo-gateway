import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { createError } from '../middleware/errorHandler'
import { requireSuperAdmin } from '../middleware/auth'

// System-admin user management — SUPER_ADMIN only
export const usersRouter = Router()

usersRouter.use(requireSuperAdmin)

usersRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        systemRole: true,
        status: true,
        createdAt: true,
        _count: { select: { memberships: true, ownedWorkspaces: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ data: users })
  } catch (err) {
    next(err)
  }
})

usersRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = z
      .object({
        systemRole: z.enum(['SUPER_ADMIN', 'USER']).optional(),
        status: z.enum(['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED']).optional(),
      })
      .safeParse(req.body)
    if (!parsed.success) return next(createError('Invalid body', 400, 'VALIDATION_ERROR'))
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: parsed.data,
      select: { id: true, email: true, systemRole: true, status: true, displayName: true },
    })
    res.json({ data: user })
  } catch (err) {
    next(err)
  }
})
