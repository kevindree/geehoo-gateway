import { Router, Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { createError } from '../middleware/errorHandler'
import { requireUser, requireWorkspaceRole, signUserJwt } from '../middleware/auth'
import { generateOpaqueToken, hashToken } from '../lib/tokens'
import { sendInvitationEmail } from '../lib/mailer'
import { logger } from '../lib/logger'

export const invitationsRouter = Router({ mergeParams: true })
export const publicInvitationsRouter = Router()

// =====================================================
// Workspace-scoped: /workspaces/:workspaceSlug/invitations
// =====================================================

// POST — create invitation
const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
})

invitationsRouter.post(
  '/',
  requireWorkspaceRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = inviteSchema.safeParse(req.body)
      if (!parsed.success) return next(createError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'))
      const email = parsed.data.email.trim().toLowerCase()

      // If already a member, reject early
      const existingUser = await prisma.user.findUnique({ where: { email } })
      if (existingUser) {
        const existingMember = await prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: req.workspace!.id, userId: existingUser.id } },
        })
        if (existingMember) return next(createError('User is already a member', 409, 'CONFLICT'))
      }

      // Revoke any pending invitations for the same email/workspace before creating a new one
      await prisma.invitation.updateMany({
        where: { workspaceId: req.workspace!.id, email, status: 'PENDING' },
        data: { status: 'REVOKED' },
      })

      const { raw, hash } = generateOpaqueToken(32)
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      const invitation = await prisma.invitation.create({
        data: {
          workspaceId: req.workspace!.id,
          email,
          role: parsed.data.role,
          invitedById: req.user!.sub,
          tokenHash: hash,
          expiresAt,
        },
      })

      try {
        await sendInvitationEmail({
          to: email,
          rawToken: raw,
          workspaceName: req.workspace!.name,
          inviterEmail: req.user!.email,
        })
      } catch (err) {
        logger.error({ err, invitationId: invitation.id }, 'Failed to send invitation email')
      }

      res.status(201).json({
        data: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        },
      })
    } catch (err) {
      next(err)
    }
  },
)

// GET — list pending invitations
invitationsRouter.get(
  '/',
  requireWorkspaceRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invitations = await prisma.invitation.findMany({
        where: { workspaceId: req.workspace!.id, status: 'PENDING' },
        select: { id: true, email: true, role: true, status: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
      res.json({ data: invitations })
    } catch (err) {
      next(err)
    }
  },
)

// DELETE — revoke
invitationsRouter.delete(
  '/:invitationId',
  requireWorkspaceRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const inv = await prisma.invitation.findFirst({
        where: { id: req.params.invitationId, workspaceId: req.workspace!.id },
      })
      if (!inv) return next(createError('Invitation not found', 404, 'NOT_FOUND'))
      await prisma.invitation.update({ where: { id: inv.id }, data: { status: 'REVOKED' } })
      res.status(204).send()
    } catch (err) {
      next(err)
    }
  },
)

// =====================================================
// Public: /invitations
// =====================================================

// GET /invitations/preview?token=...
publicInvitationsRouter.get('/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = String(req.query.token ?? '')
    if (!token) return next(createError('Missing token', 400, 'VALIDATION_ERROR'))
    const inv = await prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        workspace: { select: { name: true, slug: true } },
        inviter: { select: { email: true, displayName: true } },
      },
    })
    if (!inv || inv.status !== 'PENDING' || inv.expiresAt < new Date()) {
      return next(createError('Invitation is invalid or expired', 400, 'INVALID_TOKEN'))
    }
    const existingUser = await prisma.user.findUnique({ where: { email: inv.email } })
    res.json({
      data: {
        email: inv.email,
        role: inv.role,
        workspaceName: inv.workspace.name,
        workspaceSlug: inv.workspace.slug,
        inviterEmail: inv.inviter.email,
        isNewUser: !existingUser,
      },
    })
  } catch (err) {
    next(err)
  }
})

// POST /invitations/accept
const acceptSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(12).optional(),
  displayName: z.string().min(1).max(80).optional(),
})

publicInvitationsRouter.post('/accept', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = acceptSchema.safeParse(req.body)
    if (!parsed.success) return next(createError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'))

    const inv = await prisma.invitation.findUnique({
      where: { tokenHash: hashToken(parsed.data.token) },
    })
    if (!inv || inv.status !== 'PENDING' || inv.expiresAt < new Date()) {
      return next(createError('Invitation is invalid or expired', 400, 'INVALID_TOKEN'))
    }

    let user = await prisma.user.findUnique({ where: { email: inv.email } })
    if (!user) {
      // New user — password required
      if (!parsed.data.password) {
        return next(createError('Password is required for new account', 400, 'VALIDATION_ERROR'))
      }
      const passwordHash = await bcrypt.hash(parsed.data.password, 12)
      user = await prisma.user.create({
        data: {
          email: inv.email,
          passwordHash,
          displayName: parsed.data.displayName,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      })
    } else if (user.status === 'PENDING_ACTIVATION') {
      // Activate existing pending account via the invitation flow
      await prisma.user.update({
        where: { id: user.id },
        data: { status: 'ACTIVE', emailVerifiedAt: new Date() },
      })
    }

    // Add as workspace member (idempotent)
    await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: inv.workspaceId, userId: user.id } },
      update: { role: inv.role, invitedById: inv.invitedById },
      create: {
        workspaceId: inv.workspaceId,
        userId: user.id,
        role: inv.role,
        invitedById: inv.invitedById,
      },
    })

    await prisma.invitation.update({
      where: { id: inv.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    })

    const jwtToken = signUserJwt({ sub: user.id, email: user.email, systemRole: user.systemRole })
    const workspace = await prisma.workspace.findUnique({ where: { id: inv.workspaceId }, select: { slug: true, name: true } })
    res.json({
      token: jwtToken,
      user: { id: user.id, email: user.email, systemRole: user.systemRole, displayName: user.displayName },
      workspace,
    })
  } catch (err) {
    next(err)
  }
})

// Re-export the user list for users to view their own invitations (none for now — invitations are looked up by token only).
export const _ = requireUser
