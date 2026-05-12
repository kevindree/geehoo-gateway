import express, { Express, Request, Response, NextFunction } from 'express'
import request from 'supertest'
import bcrypt from 'bcryptjs'

const ADMIN_JWT_SECRET = 'test-secret-at-least-32-characters-long'
process.env.ADMIN_JWT_SECRET = ADMIN_JWT_SECRET
process.env.GATEWAY_JWT_SECRET = 'test-gateway-secret-at-least-32-characters-long'
process.env.KEY_ENCRYPTION_SECRET = 'test-key-encryption-secret-at-least-32-chars'
process.env.INTERNAL_SERVICE_SECRET = 'test-internal-secret-1234567890'
process.env.DATABASE_URL = 'postgresql://test/test'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.NODE_ENV = 'test'

jest.mock('../lib/prisma', () => {
  const prisma: Record<string, unknown> = {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    emailToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  }
  // $transaction(cb) runs the callback with the same prisma instance as the tx client.
  // $transaction([...ops]) returns Promise.all of the ops.
  prisma.$transaction = jest.fn((arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof prisma) => unknown)(prisma)
    }
    return Promise.all(arg as Promise<unknown>[])
  })
  return { prisma }
})

jest.mock('../lib/redis', () => ({
  redis: {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  },
}))

jest.mock('../lib/mailer', () => ({
  sendActivationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendInvitationEmail: jest.fn().mockResolvedValue(undefined),
}))

import { prisma } from '../lib/prisma'
import { sendActivationEmail } from '../lib/mailer'
import { authRouter } from './auth'
import { errorHandler } from '../middleware/errorHandler'

const mockedPrisma = prisma as unknown as {
  user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock }
  emailToken: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock }
}

function makeApp(): Express {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', authRouter)
  app.use(errorHandler as (err: Error, req: Request, res: Response, next: NextFunction) => void)
  return app
}

describe('auth router', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('POST /register', () => {
    it('rejects password shorter than 12 characters', async () => {
      const app = makeApp()
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'alice@example.com', password: 'short' })
      expect(res.status).toBe(400)
    })

    it('rejects invalid email', async () => {
      const app = makeApp()
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'not-an-email', password: 'longenoughpassword123' })
      expect(res.status).toBe(400)
    })

    it('creates user, issues activation token and returns generic 202', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null)
      mockedPrisma.user.create.mockResolvedValue({ id: 'u-1', email: 'alice@example.com' })
      mockedPrisma.emailToken.create.mockResolvedValue({ id: 'tok-1' })

      const app = makeApp()
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'Alice@Example.com', password: 'longenoughpassword123', displayName: 'Alice' })

      expect(res.status).toBe(202)
      expect(res.body.message).toMatch(/activation/i)
      expect(mockedPrisma.user.create).toHaveBeenCalledTimes(1)
      const createArgs = mockedPrisma.user.create.mock.calls[0][0]
      expect(createArgs.data.email).toBe('alice@example.com') // normalized lowercase
      expect(createArgs.data.status).toBe('PENDING_ACTIVATION')
      expect(createArgs.data.passwordHash).not.toBe('longenoughpassword123') // hashed
      expect(sendActivationEmail).toHaveBeenCalledWith('alice@example.com', expect.any(String))
    })

    it('returns generic 202 when email already exists (no enumeration)', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({ id: 'u-existing', email: 'alice@example.com', status: 'ACTIVE' })

      const app = makeApp()
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'alice@example.com', password: 'longenoughpassword123' })

      expect(res.status).toBe(202)
      expect(mockedPrisma.user.create).not.toHaveBeenCalled()
      expect(sendActivationEmail).not.toHaveBeenCalled() // ACTIVE user — no email sent
    })

    it('resends activation email if existing user is PENDING_ACTIVATION', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue({ id: 'u-pending', email: 'alice@example.com', status: 'PENDING_ACTIVATION' })
      mockedPrisma.emailToken.create.mockResolvedValue({ id: 'tok-2' })

      const app = makeApp()
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'alice@example.com', password: 'longenoughpassword123' })

      expect(res.status).toBe(202)
      expect(mockedPrisma.user.create).not.toHaveBeenCalled()
      expect(sendActivationEmail).toHaveBeenCalled()
    })
  })

  describe('POST /activate', () => {
    it('rejects expired or unknown token', async () => {
      mockedPrisma.emailToken.findUnique.mockResolvedValue(null)
      const app = makeApp()
      const res = await request(app).post('/api/auth/activate').send({ token: 'a'.repeat(40) })
      expect(res.status).toBe(400)
    })

    it('rejects already-consumed token', async () => {
      mockedPrisma.emailToken.findUnique.mockResolvedValue({
        id: 't-1', userId: 'u-1', type: 'ACTIVATION', consumedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
      })
      const app = makeApp()
      const res = await request(app).post('/api/auth/activate').send({ token: 'a'.repeat(40) })
      expect(res.status).toBe(400)
    })

    it('activates user, consumes token, and returns JWT', async () => {
      mockedPrisma.emailToken.findUnique.mockResolvedValue({
        id: 't-1', userId: 'u-1', type: 'ACTIVATION', consumedAt: null, expiresAt: new Date(Date.now() + 60_000),
      })
      mockedPrisma.user.update.mockResolvedValue({
        id: 'u-1', email: 'alice@example.com', systemRole: 'USER', displayName: null,
      })
      mockedPrisma.emailToken.update.mockResolvedValue({})

      const app = makeApp()
      const res = await request(app).post('/api/auth/activate').send({ token: 'a'.repeat(40) })

      expect(res.status).toBe(200)
      expect(res.body.token).toBeDefined()
      expect(res.body.user.email).toBe('alice@example.com')
      expect(mockedPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }))
      expect(mockedPrisma.emailToken.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }))
    })
  })

  describe('POST /login', () => {
    it('returns 401 for unknown email', async () => {
      mockedPrisma.user.findUnique.mockResolvedValue(null)
      const app = makeApp()
      const res = await request(app).post('/api/auth/login').send({ email: 'noone@x.com', password: 'whatever' })
      expect(res.status).toBe(401)
    })

    it('returns 403 for PENDING_ACTIVATION user with correct password', async () => {
      const passwordHash = await bcrypt.hash('correctpassword', 4)
      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1', email: 'pending@x.com', passwordHash, status: 'PENDING_ACTIVATION', systemRole: 'USER',
      })
      const app = makeApp()
      const res = await request(app).post('/api/auth/login').send({ email: 'pending@x.com', password: 'correctpassword' })
      expect(res.status).toBe(403)
    })

    it('returns 403 for SUSPENDED user with correct password', async () => {
      const passwordHash = await bcrypt.hash('correctpassword', 4)
      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1', email: 'sus@x.com', passwordHash, status: 'SUSPENDED', systemRole: 'USER',
      })
      const app = makeApp()
      const res = await request(app).post('/api/auth/login').send({ email: 'sus@x.com', password: 'correctpassword' })
      expect(res.status).toBe(403)
    })

    it('returns 401 for ACTIVE user with wrong password', async () => {
      const passwordHash = await bcrypt.hash('correctpassword', 4)
      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1', email: 'a@x.com', passwordHash, status: 'ACTIVE', systemRole: 'USER',
      })
      const app = makeApp()
      const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'wrong' })
      expect(res.status).toBe(401)
    })

    it('returns JWT for ACTIVE user with correct password', async () => {
      const passwordHash = await bcrypt.hash('correctpassword', 4)
      mockedPrisma.user.findUnique.mockResolvedValue({
        id: 'u-1', email: 'a@x.com', passwordHash, status: 'ACTIVE', systemRole: 'USER', displayName: null,
      })
      const app = makeApp()
      const res = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'correctpassword' })
      expect(res.status).toBe(200)
      expect(res.body.token).toBeDefined()
      expect(res.body.user.email).toBe('a@x.com')
    })
  })
})
