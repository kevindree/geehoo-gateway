import { Router, Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { createError } from '../middleware/errorHandler'
import { requireUser } from '../middleware/auth'

export const apiKeysRouter = Router({ mergeParams: true })

const createKeySchema = z.object({
  label: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
})

// AES-256-GCM helpers — key derived from KEY_ENCRYPTION_SECRET env var
function getEncryptionKey(): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET ?? process.env.ADMIN_JWT_SECRET ?? ''
  return crypto.createHash('sha256').update(secret).digest()
}

function encryptKey(raw: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const enc = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}.${enc.toString('hex')}.${tag.toString('hex')}`
}

function decryptKey(stored: string): string {
  const [ivHex, encHex, tagHex] = stored.split('.')
  const iv = Buffer.from(ivHex, 'hex')
  const enc = Buffer.from(encHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

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
    const keyEncrypted = encryptKey(rawKey)

    const apiKey = await prisma.apiKey.create({
      data: {
        projectId: req.params.projectId,
        label: parsed.data.label,
        keyHash,
        keyPrefix,
        keyEncrypted,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
      },
      select: { id: true, label: true, keyPrefix: true, expiresAt: true, createdAt: true },
    })

    res.status(201).json({ data: { ...apiKey, key: rawKey } })
  } catch (err) {
    next(err)
  }
})

// Reveal the raw key — requires the caller's login password for verification
apiKeysRouter.post('/:keyId/reveal', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { password } = req.body as { password?: string }
    if (!password) return next(createError('Password is required', 400, 'VALIDATION_ERROR'))

    // Verify the requesting user's password
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      select: { passwordHash: true },
    })
    if (!user?.passwordHash) return next(createError('Cannot verify credentials', 403, 'FORBIDDEN'))

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) return next(createError('Incorrect password', 403, 'FORBIDDEN'))

    const apiKey = await prisma.apiKey.findFirst({
      where: { id: req.params.keyId, projectId: req.params.projectId },
      select: { keyEncrypted: true },
    })
    if (!apiKey) return next(createError('API key not found', 404, 'NOT_FOUND'))
    if (!apiKey.keyEncrypted) return next(createError('Key cannot be revealed (created before encryption was enabled)', 422, 'UNPROCESSABLE'))

    const rawKey = decryptKey(apiKey.keyEncrypted)
    res.json({ data: { key: rawKey } })
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

