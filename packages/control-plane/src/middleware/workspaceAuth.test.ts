import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const ADMIN_JWT_SECRET = 'test-secret-at-least-32-characters-long'
process.env.ADMIN_JWT_SECRET = ADMIN_JWT_SECRET
process.env.GATEWAY_JWT_SECRET = 'test-gateway-secret-at-least-32-characters-long'
process.env.INTERNAL_SERVICE_SECRET = 'test-internal-secret-1234567890'
process.env.DATABASE_URL = 'postgresql://test/test'
process.env.REDIS_URL = 'redis://localhost:6379'

// Mock prisma BEFORE importing the middleware
jest.mock('../lib/prisma', () => ({
  prisma: {
    workspace: { findUnique: jest.fn() },
    workspaceMember: { findUnique: jest.fn() },
  },
}))

import { prisma } from '../lib/prisma'
import { requireWorkspaceRole, UserTokenPayload } from './auth'

const mockedPrisma = prisma as unknown as {
  workspace: { findUnique: jest.Mock }
  workspaceMember: { findUnique: jest.Mock }
}

function makeReqRes(opts: {
  user?: Partial<UserTokenPayload> | null
  workspaceSlug?: string
}) {
  const req = {
    user: opts.user === null ? undefined : (opts.user as UserTokenPayload | undefined),
    params: opts.workspaceSlug ? { workspaceSlug: opts.workspaceSlug } : {},
  } as unknown as Request
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response
  const next = jest.fn() as NextFunction
  return { req, res, next }
}

const ACTIVE_WS = { id: 'ws-1', slug: 'acme', name: 'Acme', status: 'ACTIVE', ownerId: 'u-owner', createdAt: new Date(), updatedAt: new Date() }

describe('requireWorkspaceRole middleware', () => {
  beforeEach(() => {
    mockedPrisma.workspace.findUnique.mockReset()
    mockedPrisma.workspaceMember.findUnique.mockReset()
  })

  it('returns 401 when no req.user is set', async () => {
    const { req, res, next } = makeReqRes({ user: null, workspaceSlug: 'acme' })
    await requireWorkspaceRole(['OWNER', 'ADMIN', 'MEMBER'])(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 400 when workspaceSlug param is missing', async () => {
    const { req, res, next } = makeReqRes({ user: { sub: 'u-1', email: 'a@b.c', systemRole: 'USER' } })
    await requireWorkspaceRole(['OWNER'])(req, res, next)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns 404 when workspace does not exist', async () => {
    mockedPrisma.workspace.findUnique.mockResolvedValue(null)
    const { req, res, next } = makeReqRes({ user: { sub: 'u-1', email: 'a@b.c', systemRole: 'USER' }, workspaceSlug: 'ghost' })
    await requireWorkspaceRole(['OWNER'])(req, res, next)
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns 403 when workspace is suspended', async () => {
    mockedPrisma.workspace.findUnique.mockResolvedValue({ ...ACTIVE_WS, status: 'SUSPENDED' })
    const { req, res, next } = makeReqRes({ user: { sub: 'u-1', email: 'a@b.c', systemRole: 'USER' }, workspaceSlug: 'acme' })
    await requireWorkspaceRole(['OWNER', 'ADMIN', 'MEMBER'])(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('returns 403 when user is not a workspace member (cross-workspace access)', async () => {
    mockedPrisma.workspace.findUnique.mockResolvedValue(ACTIVE_WS)
    mockedPrisma.workspaceMember.findUnique.mockResolvedValue(null)
    const { req, res, next } = makeReqRes({ user: { sub: 'u-stranger', email: 's@x.com', systemRole: 'USER' }, workspaceSlug: 'acme' })
    await requireWorkspaceRole(['OWNER', 'ADMIN', 'MEMBER'])(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 when member role is not in allowed list', async () => {
    mockedPrisma.workspace.findUnique.mockResolvedValue(ACTIVE_WS)
    mockedPrisma.workspaceMember.findUnique.mockResolvedValue({ workspaceId: 'ws-1', userId: 'u-1', role: 'MEMBER' })
    const { req, res, next } = makeReqRes({ user: { sub: 'u-1', email: 'a@b.c', systemRole: 'USER' }, workspaceSlug: 'acme' })
    await requireWorkspaceRole(['OWNER', 'ADMIN'])(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('calls next() and attaches workspace + role for valid MEMBER', async () => {
    mockedPrisma.workspace.findUnique.mockResolvedValue(ACTIVE_WS)
    mockedPrisma.workspaceMember.findUnique.mockResolvedValue({ workspaceId: 'ws-1', userId: 'u-1', role: 'MEMBER' })
    const { req, res, next } = makeReqRes({ user: { sub: 'u-1', email: 'a@b.c', systemRole: 'USER' }, workspaceSlug: 'acme' })
    await requireWorkspaceRole(['MEMBER', 'ADMIN', 'OWNER'])(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.workspace).toEqual(ACTIVE_WS)
    expect(req.workspaceRole).toBe('MEMBER')
  })

  it('SUPER_ADMIN bypasses membership check and gets OWNER role', async () => {
    mockedPrisma.workspace.findUnique.mockResolvedValue(ACTIVE_WS)
    const { req, res, next } = makeReqRes({ user: { sub: 'u-su', email: 'su@x.com', systemRole: 'SUPER_ADMIN' }, workspaceSlug: 'acme' })
    await requireWorkspaceRole(['OWNER'])(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.workspaceRole).toBe('OWNER')
    expect(mockedPrisma.workspaceMember.findUnique).not.toHaveBeenCalled()
  })
})

// Suppress unused jwt warning — kept for parity with other tests
void jwt
