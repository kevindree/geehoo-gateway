import { Router, Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { createError } from '../middleware/errorHandler'

export const apiKeysRouter = Router({ mergeParams: true })

const createKeySchema = z.object({
  label: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
})

apiKeysRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { projectId: req.params.projectId },
      select: {
        id: true,
        label: true,
        keyPrefix: true,
        enabled: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ data: keys })
  } catch (err) {
    next(err)
  }
})

apiKeysRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createKeySchema.safeParse(req.body)
    if (!parsed.success) return next(createError(parsed.error.message, 400, 'VALIDATION_ERROR'))

    const rawKey = `agk_${crypto.randomBytes(32).toString('hex')}`
    const keyPrefix = rawKey.slice(0, 12)
    const keyHash = await bcrypt.hash(rawKey, 12)

    const apiKey = await prisma.apiKey.create({
      data: {
        projectId: req.params.projectId,
        label: parsed.data.label,
        keyHash,
        keyPrefix,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
      },
      select: { id: true, label: true, keyPrefix: true, expiresAt: true, createdAt: true },
    })

    res.status(201).json({ data: { ...apiKey, key: rawKey } })
  } catch (err) {
    next(err)
  }
})

apiKeysRouter.delete('/:keyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.apiKey.findFirst({
      where: { id: req.params.keyId, projectId: req.params.projectId },
    })
    if (!existing) return next(createError('API key not found', 404, 'NOT_FOUND'))
    await prisma.apiKey.delete({ where: { id: req.params.keyId } })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})
