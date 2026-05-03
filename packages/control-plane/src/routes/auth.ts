import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import { createError } from '../middleware/errorHandler'

export const authRouter = Router()

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

authRouter.post('/login', async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
      return next(createError('Invalid request body', 400, 'VALIDATION_ERROR'))
    }

    const { username, password } = parsed.data

    const user = await prisma.adminUser.findUnique({ where: { username } })
    if (!user) {
      // Constant-time response to prevent username enumeration
      await bcrypt.compare(password, '$2a$12$invalidhashpadding000000000000000000000000000000000000')
      return next(createError('Invalid credentials', 401, 'UNAUTHORIZED'))
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return next(createError('Invalid credentials', 401, 'UNAUTHORIZED'))
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      env.ADMIN_JWT_SECRET,
      { expiresIn: '8h' },
    )

    res.json({ token, role: user.role, username: user.username })
  } catch (err) {
    next(err)
  }
})
