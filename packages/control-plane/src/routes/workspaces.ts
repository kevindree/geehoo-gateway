import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { createError } from '../middleware/errorHandler'
import { requireUser, requireWorkspaceRole } from '../middleware/auth'

export const workspacesRouter = Router()

// Reserved slugs that conflict with system routes or k8s naming
const RESERVED_SLUGS = new Set([
  'api', 'auth', 'admin', 'health', 'internal', '_internal', 'static', 'assets',
  'ws', 'app', 'public', 'system', 'login', 'register', 'activate',
  'reset-password', 'forgot-password', 'invitations', 'workspaces', 'me',
])

const slugSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Slug must be lowercase alphanumeric with internal hyphens')
  .refine((s) => !RESERVED_SLUGS.has(s), 'Slug is reserved')

const createWorkspaceSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1).max(100),
})

// All workspace routes require an authenticated user
workspacesRouter.use(requireUser)

// GET /workspaces — list workspaces the current user belongs to
workspacesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: req.user!.sub },
      include: { workspace: true },
      orderBy: { joinedAt: 'desc' },
    })
    res.json({ data: memberships.map((m) => ({ role: m.role, joinedAt: m.joinedAt, workspace: m.workspace })) })
  } catch (err) {
    next(err)
  }
})

// GET /workspaces/check-slug?slug=...
workspacesRouter.get('/check-slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slugParam = String(req.query.slug ?? '')
    const parsed = slugSchema.safeParse(slugParam)
    if (!parsed.success) {
      return res.json({ available: false, reason: parsed.error.errors[0].message })
    }
    const existing = await prisma.workspace.findUnique({ where: { slug: parsed.data } })
    res.json({ available: !existing })
  } catch (err) {
    next(err)
  }
})

// POST /workspaces — create workspace; caller becomes OWNER
workspacesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createWorkspaceSchema.safeParse(req.body)
    if (!parsed.success) return next(createError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'))

    const existing = await prisma.workspace.findUnique({ where: { slug: parsed.data.slug } })
    if (existing) return next(createError('Workspace slug already taken', 409, 'CONFLICT'))

    const workspace = await prisma.workspace.create({
      data: {
        slug: parsed.data.slug,
        name: parsed.data.name,
        ownerId: req.user!.sub,
        members: {
          create: { userId: req.user!.sub, role: 'OWNER' },
        },
      },
    })
    res.status(201).json({ data: workspace })
  } catch (err) {
    next(err)
  }
})

// GET /workspaces/:workspaceSlug
workspacesRouter.get(
  '/:workspaceSlug',
  requireWorkspaceRole(['OWNER', 'ADMIN', 'MEMBER']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ws = await prisma.workspace.findUnique({
        where: { id: req.workspace!.id },
        include: { _count: { select: { members: true, projects: true } } },
      })
      res.json({ data: { ...ws, currentUserRole: req.workspaceRole } })
    } catch (err) {
      next(err)
    }
  },
)

// PATCH /workspaces/:workspaceSlug — rename (slug immutable)
workspacesRouter.patch(
  '/:workspaceSlug',
  requireWorkspaceRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body)
      if (!parsed.success) return next(createError('Invalid name', 400, 'VALIDATION_ERROR'))
      const ws = await prisma.workspace.update({
        where: { id: req.workspace!.id },
        data: { name: parsed.data.name },
      })
      res.json({ data: ws })
    } catch (err) {
      next(err)
    }
  },
)

// DELETE /workspaces/:workspaceSlug — owner only; cascades projects (k8s teardown is async)
workspacesRouter.delete(
  '/:workspaceSlug',
  requireWorkspaceRole(['OWNER']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await prisma.workspace.update({
        where: { id: req.workspace!.id },
        data: { status: 'DELETING' },
      })
      // Hard-delete after marking; project k8s deprovisioning happens elsewhere when projects deleted.
      await prisma.workspace.delete({ where: { id: req.workspace!.id } })
      res.status(204).send()
    } catch (err) {
      next(err)
    }
  },
)

// =====================================================
// Members
// =====================================================

// GET /workspaces/:workspaceSlug/members
workspacesRouter.get(
  '/:workspaceSlug/members',
  requireWorkspaceRole(['OWNER', 'ADMIN', 'MEMBER']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const members = await prisma.workspaceMember.findMany({
        where: { workspaceId: req.workspace!.id },
        include: { user: { select: { id: true, email: true, displayName: true } } },
        orderBy: { joinedAt: 'asc' },
      })
      res.json({ data: members })
    } catch (err) {
      next(err)
    }
  },
)

// PATCH /workspaces/:workspaceSlug/members/:userId — change role
workspacesRouter.patch(
  '/:workspaceSlug/members/:userId',
  requireWorkspaceRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = z.object({ role: z.enum(['OWNER', 'ADMIN', 'MEMBER']) }).safeParse(req.body)
      if (!parsed.success) return next(createError('Invalid role', 400, 'VALIDATION_ERROR'))
      // Only OWNER can promote to OWNER
      if (parsed.data.role === 'OWNER' && req.workspaceRole !== 'OWNER') {
        return next(createError('Only owners can assign OWNER role', 403, 'FORBIDDEN'))
      }
      const target = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: req.workspace!.id, userId: req.params.userId } },
      })
      if (!target) return next(createError('Member not found', 404, 'NOT_FOUND'))
      // ADMIN can only modify MEMBER targets; cannot touch OWNER or other ADMINs
      if (req.workspaceRole === 'ADMIN' && (target.role === 'OWNER' || target.role === 'ADMIN')) {
        return next(createError('Admins cannot modify owners or other admins', 403, 'FORBIDDEN'))
      }
      const member = await prisma.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId: req.workspace!.id, userId: req.params.userId } },
        data: { role: parsed.data.role },
      })
      res.json({ data: member })
    } catch (err) {
      next(err)
    }
  },
)

// DELETE /workspaces/:workspaceSlug/members/:userId — remove member
workspacesRouter.delete(
  '/:workspaceSlug/members/:userId',
  requireWorkspaceRole(['OWNER', 'ADMIN']),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const target = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: req.workspace!.id, userId: req.params.userId } },
      })
      if (!target) return next(createError('Member not found', 404, 'NOT_FOUND'))
      // ADMIN can only remove MEMBER targets; cannot remove OWNER or other ADMINs
      if (req.workspaceRole === 'ADMIN' && (target.role === 'OWNER' || target.role === 'ADMIN')) {
        return next(createError('Admins cannot remove owners or other admins', 403, 'FORBIDDEN'))
      }
      // Prevent removing the only owner
      if (target.role === 'OWNER') {
        const owners = await prisma.workspaceMember.count({
          where: { workspaceId: req.workspace!.id, role: 'OWNER' },
        })
        if (owners <= 1) return next(createError('Cannot remove the last owner', 400, 'INVALID_OPERATION'))
      }
      await prisma.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId: req.workspace!.id, userId: req.params.userId } },
      })
      res.status(204).send()
    } catch (err) {
      next(err)
    }
  },
)
