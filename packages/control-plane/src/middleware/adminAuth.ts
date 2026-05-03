import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../lib/env'
import { AdminRole } from '@prisma/client'

export interface AdminTokenPayload {
  sub: string
  username: string
  role: AdminRole
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminTokenPayload
    }
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } })
    return
  }

  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, env.ADMIN_JWT_SECRET) as AdminTokenPayload
    req.admin = payload
    next()
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } })
  }
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAdmin(req, res, () => {
    if (req.admin?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Super admin required' } })
      return
    }
    next()
  })
}
