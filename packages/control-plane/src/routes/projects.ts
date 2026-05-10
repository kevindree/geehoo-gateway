import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { createError } from '../middleware/errorHandler'
import { requireWorkspaceRole } from '../middleware/auth'
import { provisioner } from '../k8s/provisioner'
import { configPusher } from '../k8s/configPusher'
import { routesRouter } from './projectRoutes'
import { upstreamsRouter } from './upstreams'
import { apiKeysRouter } from './apiKeys'
import { projectEndUsersRouter } from './projectEndUsers'

export const projectsRouter = Router({ mergeParams: true })

const slugSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Slug must be lowercase alphanumeric with internal hyphens')

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  slug: slugSchema,
  description: z.string().optional(),
})

// All project routes are scoped under /workspaces/:workspaceSlug/projects.
// Apply membership gate to every operation here.
projectsRouter.use(requireWorkspaceRole(['OWNER', 'ADMIN', 'MEMBER']))

// List projects in this workspace
projectsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projects = await prisma.project.findMany({
      where: { workspaceId: req.workspace!.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        ingressPrefix: true,
        description: true,
        createdAt: true,
        _count: { select: { routes: true, upstreams: true } },
      },
    })
    res.json({ data: projects })
  } catch (err) {
    next(err)
  }
})

// Create project (write requires ADMIN+)
projectsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.workspaceRole === 'MEMBER') {
      return next(createError('Insufficient role', 403, 'FORBIDDEN'))
    }
    const parsed = createProjectSchema.safeParse(req.body)
    if (!parsed.success) return next(createError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'))

    const { name, slug, description } = parsed.data
    const wsSlug = req.workspace!.slug
    const k8sNamespace = `ws-${wsSlug}-${slug}`
    if (k8sNamespace.length > 63) {
      return next(createError('Combined workspace+project slug too long for k8s namespace (max 63 chars)', 400, 'VALIDATION_ERROR'))
    }
    const ingressPrefix = `/${wsSlug}/api/${slug}`

    const existing = await prisma.project.findFirst({
      where: {
        OR: [
          { workspaceId: req.workspace!.id, slug },
          { k8sNamespace },
          { ingressPrefix },
        ],
      },
    })
    if (existing) return next(createError('Project slug already exists', 409, 'CONFLICT'))

    const project = await prisma.project.create({
      data: {
        workspaceId: req.workspace!.id,
        name,
        slug,
        description,
        k8sNamespace,
        ingressPrefix,
        status: 'PROVISIONING',
      },
    })

    provisioner.provision(project).catch((err) => {
      console.error(`K8s provisioning failed for project ${project.id}:`, err)
    })

    res.status(202).json({ data: project })
  } catch (err) {
    next(err)
  }
})

// Helper: load + verify a project belongs to the workspace; attaches as req.project-like
async function loadProjectForWorkspace(req: Request, res: Response, next: NextFunction): Promise<void> {
  const project = await prisma.project.findFirst({
    where: { id: req.params.projectId, workspaceId: req.workspace!.id },
  })
  if (!project) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Project not found' } })
    return
  }
  ;(req as Request & { project?: typeof project }).project = project
  next()
}

// Get project by id
projectsRouter.get('/:projectId', loadProjectForWorkspace, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.projectId },
      include: { _count: { select: { routes: true, upstreams: true, apiKeys: true } } },
    })
    res.json({ data: project })
  } catch (err) {
    next(err)
  }
})

const upstreamAuthParamsSchema = z.object({
  bearer: z.object({ token: z.string() }).optional(),
  basic: z.object({ username: z.string(), password: z.string() }).optional(),
  apikey_header: z.object({ headerName: z.string(), key: z.string() }).optional(),
  apikey_query: z.object({ paramName: z.string(), key: z.string() }).optional(),
}).optional()

const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
  authRequired: z.boolean().optional(),
  params: z.object({ upstreamAuth: upstreamAuthParamsSchema }).optional(),
})

projectsRouter.patch('/:projectId', loadProjectForWorkspace, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.workspaceRole === 'MEMBER') return next(createError('Insufficient role', 403, 'FORBIDDEN'))
    const parsed = updateProjectSchema.safeParse(req.body)
    if (!parsed.success) return next(createError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR'))

    const project = await prisma.project.update({
      where: { id: req.params.projectId },
      data: parsed.data,
      include: { _count: { select: { routes: true, upstreams: true, apiKeys: true } } },
    })

    configPusher.push(project).catch((err: unknown) => {
      console.error(`Config push failed after project update ${project.id}:`, err)
    })

    res.json({ data: project })
  } catch (err) {
    next(err)
  }
})

// Delete project
projectsRouter.delete('/:projectId', loadProjectForWorkspace, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.workspaceRole === 'MEMBER') return next(createError('Insufficient role', 403, 'FORBIDDEN'))
    const project = await prisma.project.findUnique({ where: { id: req.params.projectId } })
    if (!project) return next(createError('Project not found', 404, 'NOT_FOUND'))

    await prisma.project.update({ where: { id: req.params.projectId }, data: { status: 'DELETING' } })
    provisioner.deprovision(project).catch((err) => {
      console.error(`K8s deprovisioning failed for project ${project.id}:`, err)
    })

    res.status(202).json({ data: { message: 'Project deletion initiated' } })
  } catch (err) {
    next(err)
  }
})

// Sub-routers — they all rely on req.params.projectId (set by the parent path)
projectsRouter.use('/:projectId/routes', loadProjectForWorkspace, routesRouter)
projectsRouter.use('/:projectId/upstreams', loadProjectForWorkspace, upstreamsRouter)
projectsRouter.use('/:projectId/api-keys', loadProjectForWorkspace, apiKeysRouter)
projectsRouter.use('/:projectId/end-users', loadProjectForWorkspace, projectEndUsersRouter)
