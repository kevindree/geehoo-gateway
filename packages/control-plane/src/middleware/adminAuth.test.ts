import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { requireAdmin, requireSuperAdmin, AdminTokenPayload } from '../middleware/adminAuth'

const ADMIN_JWT_SECRET = 'test-secret-at-least-32-characters-long'
process.env.ADMIN_JWT_SECRET = ADMIN_JWT_SECRET

function makeToken(payload: Partial<AdminTokenPayload>): string {
  return jwt.sign(payload, ADMIN_JWT_SECRET, { expiresIn: '1h' })
}

function makeMockReqRes(token?: string) {
  const req = {
    headers: { authorization: token ? `Bearer ${token}` : undefined },
  } as unknown as Request
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response
  const next = jest.fn() as NextFunction
  return { req, res, next }
}

describe('requireAdmin middleware', () => {
  it('calls next() with valid ADMIN token', () => {
    const token = makeToken({ sub: 'user-1', role: 'ADMIN', username: 'alice' })
    const { req, res, next } = makeMockReqRes(token)
    requireAdmin(req, res, next)
    expect(next).toHaveBeenCalled()
    expect((req as any).user).toMatchObject({ sub: 'user-1', role: 'ADMIN' })
  })

  it('calls next() with valid SUPER_ADMIN token', () => {
    const token = makeToken({ sub: 'user-2', role: 'SUPER_ADMIN', username: 'bob' })
    const { req, res, next } = makeMockReqRes(token)
    requireAdmin(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('returns 401 when no Authorization header', () => {
    const { req, res, next } = makeMockReqRes()
    requireAdmin(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when token is expired', () => {
    const token = jwt.sign({ sub: 'x', role: 'ADMIN' }, ADMIN_JWT_SECRET, { expiresIn: -1 })
    const { req, res, next } = makeMockReqRes(token)
    requireAdmin(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 401 when signed with wrong secret', () => {
    const token = jwt.sign({ sub: 'x', role: 'ADMIN' }, 'wrong-secret')
    const { req, res, next } = makeMockReqRes(token)
    requireAdmin(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })
})

describe('requireSuperAdmin middleware', () => {
  it('calls next() only for SUPER_ADMIN', () => {
    const token = makeToken({ sub: 'su-1', role: 'SUPER_ADMIN', username: 'su' })
    const { req, res, next } = makeMockReqRes(token)
    // First set req.user (requireAdmin would normally do this)
    ;(req as any).user = jwt.verify(token, ADMIN_JWT_SECRET)
    requireSuperAdmin(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('returns 403 for ADMIN role', () => {
    const token = makeToken({ sub: 'u-1', role: 'ADMIN', username: 'admin' })
    const { req, res, next } = makeMockReqRes(token)
    ;(req as any).user = jwt.verify(token, ADMIN_JWT_SECRET)
    requireSuperAdmin(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })
})
