import express, { Express, Request, Response, NextFunction } from 'express'
import request from 'supertest'
import jwt from 'jsonwebtoken'

const ADMIN_JWT_SECRET = 'test-secret-at-least-32-characters-long'
process.env.ADMIN_JWT_SECRET = ADMIN_JWT_SECRET
process.env.GATEWAY_JWT_SECRET = 'test-gateway-secret-at-least-32-characters-long'
process.env.INTERNAL_SERVICE_SECRET = 'test-internal-secret-1234567890'
process.env.DATABASE_URL = 'postgresql://test/test'
process.env.REDIS_URL = 'redis://localhost:6379'

jest.mock('../lib/prisma', () => ({
  prisma: {
    workspace: { findUnique: jest.fn(), create: jest.fn() },
    workspaceMember: { findMany: jest.fn() },
  },
}))

import { prisma } from '../lib/prisma'
import { workspacesRouter } from './workspaces'
import { errorHandler } from '../middleware/errorHandler'

const mockedPrisma = prisma as unknown as {
  workspace: { findUnique: jest.Mock; create: jest.Mock }
  workspaceMember: { findMany: jest.Mock }
}

function makeApp(): Express {
  const app = express()
  app.use(express.json())
  app.use('/api/workspaces', workspacesRouter)
  app.use(errorHandler as (err: Error, req: Request, res: Response, next: NextFunction) => void)
  return app
}

const userToken = jwt.sign(
  { sub: 'u-1', email: 'alice@example.com', systemRole: 'USER' },
  ADMIN_JWT_SECRET,
  { expiresIn: '1h' },
)

describe('workspaces router', () => {
  beforeEach(() => {
    mockedPrisma.workspace.findUnique.mockReset()
    mockedPrisma.workspace.create.mockReset()
    mockedPrisma.workspaceMember.findMany.mockReset()
  })

  describe('GET /workspaces/check-slug', () => {
    it('rejects reserved slug "api"', async () => {
      const app = makeApp()
      const res = await request(app)
        .get('/api/workspaces/check-slug?slug=api')
        .set('Authorization', `Bearer ${userToken}`)
      expect(res.status).toBe(200)
      expect(res.body.available).toBe(false)
      expect(res.body.reason).toMatch(/reserved/i)
    })

    it('rejects reserved slug "admin"', async () => {
      const app = makeApp()
      const res = await request(app)
        .get('/api/workspaces/check-slug?slug=admin')
        .set('Authorization', `Bearer ${userToken}`)
      expect(res.body.available).toBe(false)
    })

    it('rejects slug shorter than 3 chars', async () => {
      const app = makeApp()
      const res = await request(app)
        .get('/api/workspaces/check-slug?slug=ab')
        .set('Authorization', `Bearer ${userToken}`)
      expect(res.body.available).toBe(false)
    })

    it('rejects slug with uppercase', async () => {
      const app = makeApp()
      const res = await request(app)
        .get('/api/workspaces/check-slug?slug=Acme')
        .set('Authorization', `Bearer ${userToken}`)
      expect(res.body.available).toBe(false)
    })

    it('rejects slug with leading hyphen', async () => {
      const app = makeApp()
      const res = await request(app)
        .get('/api/workspaces/check-slug?slug=-acme')
        .set('Authorization', `Bearer ${userToken}`)
      expect(res.body.available).toBe(false)
    })

    it('returns available=true for a valid, free slug', async () => {
      mockedPrisma.workspace.findUnique.mockResolvedValue(null)
      const app = makeApp()
      const res = await request(app)
        .get('/api/workspaces/check-slug?slug=acme-co')
        .set('Authorization', `Bearer ${userToken}`)
      expect(res.body.available).toBe(true)
    })

    it('returns available=false for taken slug', async () => {
      mockedPrisma.workspace.findUnique.mockResolvedValue({ id: 'ws-1', slug: 'acme' })
      const app = makeApp()
      const res = await request(app)
        .get('/api/workspaces/check-slug?slug=acme')
        .set('Authorization', `Bearer ${userToken}`)
      expect(res.body.available).toBe(false)
    })
  })

  describe('POST /workspaces', () => {
    it('rejects unauthenticated requests', async () => {
      const app = makeApp()
      const res = await request(app).post('/api/workspaces').send({ slug: 'acme', name: 'Acme' })
      expect(res.status).toBe(401)
    })

    it('rejects reserved slug', async () => {
      const app = makeApp()
      const res = await request(app)
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ slug: 'admin', name: 'Bad' })
      expect(res.status).toBe(400)
    })

    it('returns 409 on slug collision', async () => {
      mockedPrisma.workspace.findUnique.mockResolvedValue({ id: 'ws-existing', slug: 'acme' })
      const app = makeApp()
      const res = await request(app)
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ slug: 'acme', name: 'Acme' })
      expect(res.status).toBe(409)
    })

    it('creates workspace with caller as OWNER', async () => {
      mockedPrisma.workspace.findUnique.mockResolvedValue(null)
      mockedPrisma.workspace.create.mockResolvedValue({
        id: 'ws-new', slug: 'acme', name: 'Acme', ownerId: 'u-1', status: 'ACTIVE',
      })
      const app = makeApp()
      const res = await request(app)
        .post('/api/workspaces')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ slug: 'acme', name: 'Acme' })
      expect(res.status).toBe(201)
      expect(res.body.data.slug).toBe('acme')
      const createCall = mockedPrisma.workspace.create.mock.calls[0][0]
      expect(createCall.data.ownerId).toBe('u-1')
      expect(createCall.data.members.create).toMatchObject({ userId: 'u-1', role: 'OWNER' })
    })
  })

  describe('GET /workspaces', () => {
    it('lists current user memberships', async () => {
      mockedPrisma.workspaceMember.findMany.mockResolvedValue([
        { role: 'OWNER', joinedAt: new Date('2026-01-01'), workspace: { id: 'ws-1', slug: 'acme', name: 'Acme', status: 'ACTIVE' } },
      ])
      const app = makeApp()
      const res = await request(app)
        .get('/api/workspaces')
        .set('Authorization', `Bearer ${userToken}`)
      expect(res.status).toBe(200)
      expect(res.body.data).toHaveLength(1)
      expect(res.body.data[0].workspace.slug).toBe('acme')
    })
  })
})
