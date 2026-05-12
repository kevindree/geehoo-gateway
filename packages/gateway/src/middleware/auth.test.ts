import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const SECRET = 'test-gateway-secret-32-characters-ok'
// env module performs Zod validation at import time — set all required vars first
process.env.GATEWAY_JWT_SECRET = SECRET
process.env.GATEWAY_PROJECT_ID = 'test-project'
process.env.GATEWAY_REDIS_URL = 'redis://localhost:6379'
process.env.INTERNAL_SERVICE_SECRET = 'test-internal-secret-1234567890'
process.env.CONTROL_PLANE_INTERNAL_URL = 'http://control-plane:4000'

// Mock redis BEFORE importing the middleware
jest.mock('../lib/redis', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  },
}))

// Mock axios for control-plane API key verification
jest.mock('axios', () => ({
  __esModule: true,
  default: { post: jest.fn() },
  post: jest.fn(),
}))

import axios from 'axios'
import { createAuthMiddleware } from '../middleware/auth'
import { RouteConfig } from '../lib/schema'

const mockedAxios = axios as unknown as { post: jest.Mock }

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
      createAuthMiddleware(makeRoute({ public: true }), true, 'test-project')(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })
  })

  describe('JWT auth', () => {
    it('accepts valid Bearer JWT', () => {
      const token = jwt.sign({ sub: 'user-1' }, SECRET, { expiresIn: '1h' })
      const { req, res, next } = makeMockReqRes(`Bearer ${token}`)
      createAuthMiddleware(makeRoute(), true, 'test-project')(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(req.user).toMatchObject({ sub: 'user-1' })
    })

    it('rejects missing Authorization header', () => {
      const { req, res, next } = makeMockReqRes()
      createAuthMiddleware(makeRoute(), true, 'test-project')(req, res, next)
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })

    it('rejects expired token', () => {
      const token = jwt.sign({ sub: 'user-1' }, SECRET, { expiresIn: -1 })
      const { req, res, next } = makeMockReqRes(`Bearer ${token}`)
      createAuthMiddleware(makeRoute(), true, 'test-project')(req, res, next)
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('rejects token signed with wrong secret', () => {
      const token = jwt.sign({ sub: 'user-1' }, 'wrong-secret')
      const { req, res, next } = makeMockReqRes(`Bearer ${token}`)
      createAuthMiddleware(makeRoute(), true, 'test-project')(req, res, next)
      expect(res.status).toHaveBeenCalledWith(401)
    })
  })

  describe('API Key auth', () => {
    beforeEach(() => {
      mockedAxios.post.mockReset()
    })

    it('accepts X-Api-Key header when control plane validates the key', async () => {
      mockedAxios.post.mockResolvedValue({
        status: 200,
        data: { id: 'key-123', label: 'CI', projectId: 'test-project' },
      })
      const { req, res, next } = makeMockReqRes(undefined, 'agk_validkey123')
      createAuthMiddleware(
        makeRoute({ authConfig: { type: 'apikey' } }),
        true,
        'test-project',
      )(req, res, next)
      // Wait for async flow to settle
      await new Promise((r) => setImmediate(r))
      expect(mockedAxios.post).toHaveBeenCalled()
      expect(next).toHaveBeenCalled()
      expect(req.user?.sub).toBe('apikey:key-123')
    })

    it('rejects when control plane reports the key as invalid', async () => {
      mockedAxios.post.mockResolvedValue({
        status: 401,
        data: { error: { code: 'UNAUTHORIZED' } },
      })
      const { req, res, next } = makeMockReqRes(undefined, 'agk_bogus')
      createAuthMiddleware(
        makeRoute({ authConfig: { type: 'apikey' } }),
        true,
        'test-project',
      )(req, res, next)
      await new Promise((r) => setImmediate(r))
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
    })

    it('returns 503 when the control plane is unreachable', async () => {
      mockedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'))
      const { req, res, next } = makeMockReqRes(undefined, 'agk_anything')
      createAuthMiddleware(
        makeRoute({ authConfig: { type: 'apikey' } }),
        true,
        'test-project',
      )(req, res, next)
      await new Promise((r) => setImmediate(r))
      expect(res.status).toHaveBeenCalledWith(503)
      expect(next).not.toHaveBeenCalled()
    })

    it('rejects missing X-Api-Key header', async () => {
      const { req, res, next } = makeMockReqRes()
      createAuthMiddleware(
        makeRoute({ authConfig: { type: 'apikey' } }),
        true,
        'test-project',
      )(req, res, next)
      await new Promise((r) => setImmediate(r))
      expect(res.status).toHaveBeenCalledWith(401)
    })
  })

  describe('JWT blocklist', () => {
    it('rejects a JWT whose jti has been revoked', async () => {
      const redisMod = jest.requireMock('../lib/redis') as { redis: { get: jest.Mock } }
      redisMod.redis.get.mockResolvedValueOnce('1')
      const token = jwt.sign({ sub: 'user-1', jti: 'revoked-jti' }, SECRET, { expiresIn: '1h' })
      const { req, res, next } = makeMockReqRes(`Bearer ${token}`)
      createAuthMiddleware(makeRoute(), true, 'test-project')(req, res, next)
      await new Promise((r) => setImmediate(r))
      expect(res.status).toHaveBeenCalledWith(401)
      expect(next).not.toHaveBeenCalled()
      redisMod.redis.get.mockReset()
      redisMod.redis.get.mockResolvedValue(null)
    })
  })
})
