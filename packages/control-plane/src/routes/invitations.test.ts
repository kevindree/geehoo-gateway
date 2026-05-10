import express, { Express, Request, Response, NextFunction } from 'express'
import request from 'supertest'

const ADMIN_JWT_SECRET = 'test-secret-at-least-32-characters-long'
process.env.ADMIN_JWT_SECRET = ADMIN_JWT_SECRET
process.env.GATEWAY_JWT_SECRET = 'test-gateway-secret-at-least-32-characters-long'
process.env.INTERNAL_SERVICE_SECRET = 'test-internal-secret-1234567890'
process.env.DATABASE_URL = 'postgresql://test/test'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.NODE_ENV = 'test'

jest.mock('../lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    invitation: { findUnique: jest.fn(), update: jest.fn() },
    workspace: { findUnique: jest.fn() },
    workspaceMember: { upsert: jest.fn() },
  },
}))

jest.mock('../lib/mailer', () => ({
  sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
}))

import { prisma } from '../lib/prisma'
import { publicInvitationsRouter } from './invitations'
import { errorHandler } from '../middleware/errorHandler'

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock }
  invitation: { findUnique: jest.Mock; update: jest.Mock }
  workspace: { findUnique: jest.Mock }
  workspaceMember: { upsert: jest.Mock }
}

function makeApp(): Express {
  const app = express()
  app.use(express.json())
  app.use('/api/invitations', publicInvitationsRouter)
  app.use(errorHandler as (err: Error, req: Request, res: Response, next: NextFunction) => void)
  return app
}

const validInvitation = {
  id: 'inv-1',
  workspaceId: 'ws-1',
  email: 'newuser@example.com',
  role: 'MEMBER' as const,
  invitedById: 'u-owner',
  status: 'PENDING' as const,
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
}

describe('public invitations router', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('GET /preview', () => {
    it('returns 400 when token missing', async () => {
      const app = makeApp()
      const res = await request(app).get('/api/invitations/preview')
      expect(res.status).toBe(400)
    })

    it('returns 400 when token unknown/expired', async () => {
      mockedPrisma.invitation.findUnique.mockResolvedValue(null)
      const app = makeApp()
      const res = await request(app).get('/api/invitations/preview?token=' + 'a'.repeat(40))
      expect(res.status).toBe(400)
    })

    it('returns isNewUser=true when invited email has no account', async () => {
      mockedPrisma.invitation.findUnique.mockResolvedValue({
        ...validInvitation,
        workspace: { name: 'Acme', slug: 'acme' },
        inviter: { email: 'owner@x.com', displayName: null },
      })
      mockedPrisma.user.findUnique.mockResolvedValue(null)

      const app = makeApp()
      const res = await request(app).get('/api/invitations/preview?token=' + 'a'.repeat(40))
      expect(res.status).toBe(200)
      expect(res.body.data.isNewUser).toBe(true)
      expect(res.body.data.workspaceSlug).toBe('acme')
      expect(res.body.data.email).toBe('newuser@example.com')
    })

    it('returns isNewUser=false when invited email already has an account', async () => {
      mockedPrisma.invitation.findUnique.mockResolvedValue({
        ...validInvitation,
        workspace: { name: 'Acme', slug: 'acme' },
        inviter: { email: 'owner@x.com', displayName: null },
      })
      mockedPrisma.user.findUnique.mockResolvedValue({ id: 'u-existing', email: 'newuser@example.com' })

      const app = makeApp()
      const res = await request(app).get('/api/invitations/preview?token=' + 'a'.repeat(40))
      expect(res.body.data.isNewUser).toBe(false)
    })
  })

  describe('POST /accept', () => {
    it('rejects expired invitation', async () => {
      mockedPrisma.invitation.findUnique.mockResolvedValue({
        ...validInvitation,
        expiresAt: new Date(Date.now() - 1000),
      })
      const app = makeApp()
      const res = await request(app).post('/api/invitations/accept').send({ token: 'a'.repeat(40), password: 'longenoughpw1234' })
      expect(res.status).toBe(400)
    })

    it('rejects revoked/accepted invitation', async () => {
      mockedPrisma.invitation.findUnique.mockResolvedValue({ ...validInvitation, status: 'REVOKED' })
      const app = makeApp()
      const res = await request(app).post('/api/invitations/accept').send({ token: 'a'.repeat(40), password: 'longenoughpw1234' })
      expect(res.status).toBe(400)
    })

    it('requires password for new user', async () => {
      mockedPrisma.invitation.findUnique.mockResolvedValue(validInvitation)
      mockedPrisma.user.findUnique.mockResolvedValue(null)
      const app = makeApp()
      const res = await request(app).post('/api/invitations/accept').send({ token: 'a'.repeat(40) })
      expect(res.status).toBe(400)
    })

    it('creates new user, adds membership, marks invitation accepted, returns JWT', async () => {
      mockedPrisma.invitation.findUnique.mockResolvedValue(validInvitation)
      mockedPrisma.user.findUnique.mockResolvedValue(null) // new user
      mockedPrisma.user.create.mockResolvedValue({
        id: 'u-new', email: 'newuser@example.com', systemRole: 'USER', displayName: 'Bob',
      })
      mockedPrisma.workspaceMember.upsert.mockResolvedValue({})
      mockedPrisma.invitation.update.mockResolvedValue({})
      mockedPrisma.workspace.findUnique.mockResolvedValue({ slug: 'acme', name: 'Acme' })

      const app = makeApp()
      const res = await request(app)
        .post('/api/invitations/accept')
        .send({ token: 'a'.repeat(40), password: 'longenoughpw1234', displayName: 'Bob' })

      expect(res.status).toBe(200)
      expect(res.body.token).toBeDefined()
      expect(res.body.workspace.slug).toBe('acme')

      const userCreateArgs = mockedPrisma.user.create.mock.calls[0][0]
      expect(userCreateArgs.data.email).toBe('newuser@example.com')
      expect(userCreateArgs.data.status).toBe('ACTIVE')
      expect(userCreateArgs.data.passwordHash).not.toBe('longenoughpw1234') // hashed

      expect(mockedPrisma.workspaceMember.upsert).toHaveBeenCalledTimes(1)
      const upsertArgs = mockedPrisma.workspaceMember.upsert.mock.calls[0][0]
      expect(upsertArgs.create.role).toBe('MEMBER')
      expect(upsertArgs.create.workspaceId).toBe('ws-1')

      expect(mockedPrisma.invitation.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'ACCEPTED' }),
      }))
    })

    it('activates existing PENDING user and adds membership (no password required)', async () => {
      mockedPrisma.invitation.findUnique.mockResolvedValue(validInvitation)
      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'u-existing', email: 'newuser@example.com', status: 'PENDING_ACTIVATION', systemRole: 'USER', displayName: null,
      })
      mockedPrisma.user.update.mockResolvedValue({})
      mockedPrisma.workspaceMember.upsert.mockResolvedValue({})
      mockedPrisma.invitation.update.mockResolvedValue({})
      mockedPrisma.workspace.findUnique.mockResolvedValue({ slug: 'acme', name: 'Acme' })

      const app = makeApp()
      const res = await request(app).post('/api/invitations/accept').send({ token: 'a'.repeat(40) })

      expect(res.status).toBe(200)
      expect(mockedPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'u-existing' },
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }))
      expect(mockedPrisma.user.create).not.toHaveBeenCalled()
      expect(mockedPrisma.workspaceMember.upsert).toHaveBeenCalled()
    })

    it('adds existing ACTIVE user to workspace without modifying user record', async () => {
      mockedPrisma.invitation.findUnique.mockResolvedValue(validInvitation)
      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'u-active', email: 'newuser@example.com', status: 'ACTIVE', systemRole: 'USER', displayName: null,
      })
      mockedPrisma.workspaceMember.upsert.mockResolvedValue({})
      mockedPrisma.invitation.update.mockResolvedValue({})
      mockedPrisma.workspace.findUnique.mockResolvedValue({ slug: 'acme', name: 'Acme' })

      const app = makeApp()
      const res = await request(app).post('/api/invitations/accept').send({ token: 'a'.repeat(40) })

      expect(res.status).toBe(200)
      expect(mockedPrisma.user.create).not.toHaveBeenCalled()
      expect(mockedPrisma.user.update).not.toHaveBeenCalled()
      expect(mockedPrisma.workspaceMember.upsert).toHaveBeenCalled()
    })
  })
})
