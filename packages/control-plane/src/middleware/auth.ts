import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../lib/env'
import { prisma } from '../lib/prisma'
import { SystemRole, WorkspaceRole, Workspace } from '@prisma/client'

export interface UserTokenPayload {
  sub: string
  email: string
  systemRole: SystemRole
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserTokenPayload
      workspace?: Workspace
      workspaceRole?: WorkspaceRole
    }
  }
}

export function signUserJwt(payload: UserTokenPayload, expiresIn: string = '8h'): string {
  return jwt.sign(payload, env.ADMIN_JWT_SECRET, { expiresIn } as jwt.SignOptions)
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } })
    return
  }
  const token = authHeader.slice(7)
  try {
    const payload = jwt.verify(token, env.ADMIN_JWT_SECRET) as UserTokenPayload
    if (!payload.sub || !payload.email) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token payload' } })
      return
    }
    req.user = payload
    next()
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } })
  }
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  requireUser(req, res, () => {
    if (req.user?.systemRole !== 'SUPER_ADMIN') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Super admin required' } })
      return
    }
    next()
  })
}

/**
 * Resolves :workspaceSlug route param, loads the workspace + the current user's
 * membership, attaches `req.workspace` and `req.workspaceRole`, and gates on the
 * provided role list. SUPER_ADMIN bypasses membership checks.
 */
export function requireWorkspaceRole(allowed: WorkspaceRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } })
      return
    }
    const slug = (req.params as { workspaceSlug?: string }).workspaceSlug
    if (!slug) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'workspaceSlug param required' } })
      return
    }
    const workspace = await prisma.workspace.findUnique({ where: { slug } })
    if (!workspace) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } })
      return
    }
    if (workspace.status !== 'ACTIVE') {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Workspace not active' } })
      return
    }

    if (req.user.systemRole === 'SUPER_ADMIN') {
      req.workspace = workspace
      req.workspaceRole = 'OWNER'
      return next()
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: req.user.sub } },
    })
    if (!member) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Not a workspace member' } })
      return
    }
    if (!allowed.includes(member.role)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient workspace role' } })
      return
    }
    req.workspace = workspace
    req.workspaceRole = member.role
    next()
  }
}
