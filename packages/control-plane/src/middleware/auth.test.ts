import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const ADMIN_JWT_SECRET = 'test-secret-at-least-32-characters-long'
process.env.ADMIN_JWT_SECRET = ADMIN_JWT_SECRET
process.env.GATEWAY_JWT_SECRET = 'test-gateway-secret-at-least-32-characters-long'
process.env.KEY_ENCRYPTION_SECRET = 'test-key-encryption-secret-at-least-32-chars'
process.env.INTERNAL_SERVICE_SECRET = 'test-internal-secret-1234567890'
process.env.DATABASE_URL = 'postgresql://test/test'
process.env.REDIS_URL = 'redis://localhost:6379'

import { requireUser, requireSuperAdmin, UserTokenPayload } from './auth'

function makeToken(payload: Partial<UserTokenPayload>): string {
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

describe('requireUser middleware', () => {
  it('calls next() with valid USER token', () => {
    const token = makeToken({ sub: 'user-1', email: 'alice@example.com', systemRole: 'USER' })
    const { req, res, next } = makeMockReqRes(token)
    requireUser(req, res, next)
    expect(next).toHaveBeenCalled()
    expect(req.user).toMatchObject({ sub: 'user-1', email: 'alice@example.com' })
  })

  it('returns 401 with no Authorization header', () => {
    const { req, res, next } = makeMockReqRes()
    requireUser(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 with expired token', () => {
    const token = jwt.sign({ sub: 'x', email: 'a@b.c', systemRole: 'USER' }, ADMIN_JWT_SECRET, { expiresIn: -1 })
    const { req, res, next } = makeMockReqRes(token)
    requireUser(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('returns 401 when signed with wrong secret', () => {
    const token = jwt.sign({ sub: 'x', email: 'a@b.c', systemRole: 'USER' }, 'wrong-secret')
    const { req, res, next } = makeMockReqRes(token)
    requireUser(req, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
  })
})

describe('requireSuperAdmin middleware', () => {
  it('calls next() for SUPER_ADMIN', () => {
    const token = makeToken({ sub: 'su', email: 'su@x.com', systemRole: 'SUPER_ADMIN' })
    const { req, res, next } = makeMockReqRes(token)
    requireSuperAdmin(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('returns 403 for regular USER', () => {
    const token = makeToken({ sub: 'u', email: 'u@x.com', systemRole: 'USER' })
    const { req, res, next } = makeMockReqRes(token)
    requireSuperAdmin(req, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
  })
})
