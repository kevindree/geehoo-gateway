import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { createAuthMiddleware } from '../middleware/auth'
import { RouteConfig } from '../lib/schema'

const SECRET = 'test-gateway-secret-32-characters-ok'
process.env.GATEWAY_JWT_SECRET = SECRET

function makeRoute(overrides?: Partial<RouteConfig>): RouteConfig {
  return {
    id: 'route-1',
    path: '/test',
    method: 'GET',
    public: false,
    enabled: true,
    orchestrationFlow: { nodes: [], edges: [] },
    ...overrides,
  } as RouteConfig
}

function makeMockReqRes(authHeader?: string, apiKey?: string) {
  const headers: Record<string, string> = {}
  if (authHeader) headers['authorization'] = authHeader
  if (apiKey) headers['x-api-key'] = apiKey
  const req = { headers } as unknown as Request
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response
  const next = jest.fn() as NextFunction
  return { req, res, next }
}

describe('createAuthMiddleware', () => {
  describe('public routes', () => {
    it('calls next() without any auth header', () => {
      const { req, res, next } = makeMockReqRes()
      createAuthMiddleware(makeRoute({ public: true }))(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
  })

  describe('JWT auth', () => {
    it('accepts valid Bearer JWT', () => {
      const token = jwt.sign({ sub: 'user-1' }, SECRET, { expiresIn: '1h' })
      const { req, res, next } = makeMockReqRes(`Bearer ${token}`)
      createAuthMiddleware(makeRoute())(req, res, next)
      expect(next).toHaveBeenCalled()
      expect((req as any).user).toMatchObject({ sub: 'user-1' })
    })

    it('rejects missing Authorization header', () => {
      const { req, res, next } = makeMockReqRes()
      createAuthMiddleware(makeRoute())(req, res, next)
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })

    it('rejects expired token', () => {
      const token = jwt.sign({ sub: 'user-1' }, SECRET, { expiresIn: -1 })
      const { req, res, next } = makeMockReqRes(`Bearer ${token}`)
      createAuthMiddleware(makeRoute())(req, res, next)
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('rejects token signed with wrong secret', () => {
      const token = jwt.sign({ sub: 'user-1' }, 'wrong-secret')
      const { req, res, next } = makeMockReqRes(`Bearer ${token}`)
      createAuthMiddleware(makeRoute())(req, res, next)
      expect(res.status).toHaveBeenCalledWith(401)
    })
  })

  describe('API Key auth', () => {
    it('accepts X-Api-Key header for apikey routes', () => {
      const { req, res, next } = makeMockReqRes(undefined, 'some-api-key-value')
      createAuthMiddleware(
        makeRoute({ authConfig: { type: 'apikey' } } as any),
      )(req, res, next)
      expect(next).toHaveBeenCalled()
      expect((req as any).user?.sub).toMatch(/^apikey:/)
    })

    it('rejects missing X-Api-Key header', () => {
      const { req, res, next } = makeMockReqRes()
      createAuthMiddleware(
        makeRoute({ authConfig: { type: 'apikey' } } as any),
      )(req, res, next)
      expect(res.status).toHaveBeenCalledWith(401)
    })
  })
})
