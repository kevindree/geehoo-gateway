import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { createError } from '../middleware/errorHandler'
import { provisioner } from '../k8s/provisioner'
import { configPusher } from '../k8s/configPusher'
import { routesRouter } from './projectRoutes'
import { upstreamsRouter } from './upstreams'
import { apiKeysRouter } from './apiKeys'
import { projectEndUsersRouter } from './projectEndUsers'

export const projectsRouter = Router()

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().optional(),
})

// List projects
projectsRouter.get('/', async (req, res, next) => {
  try {
    const projects = await prisma.project.findMany({
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

// Create project
projectsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createProjectSchema.safeParse(req.body)
    if (!parsed.success) {
      return next(createError(parsed.error.message, 400, 'VALIDATION_ERROR'))
    }

    const { name, slug, description } = parsed.data
    const k8sNamespace = `project-${slug}`
    const ingressPrefix = `/api/${slug}`

    // Check uniqueness
    const existing = await prisma.project.findFirst({
      where: { OR: [{ slug }, { k8sNamespace }] },
    })
    if (existing) {
      return next(createError('Project slug already exists', 409, 'CONFLICT'))
    }

    const project = await prisma.project.create({
      data: { name, slug, description, k8sNamespace, ingressPrefix, status: 'PROVISIONING' },
    })

    // Provision K8s resources asynchronously
    provisioner.provision(project).catch((err) => {
      console.error(`K8s provisioning failed for project ${project.id}:`, err)
    })

    res.status(202).json({ data: project })
  } catch (err) {
    next(err)
  }
})

// Get project by id
projectsRouter.get('/:id', async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { routes: true, upstreams: true, apiKeys: true } } },
    })
    if (!project) return next(createError('Project not found', 404, 'NOT_FOUND'))
    res.json({ data: project })
  } catch (err) {
    next(err)
  }
})

// Delete project
projectsRouter.delete('/:id', async (req, res, next) => {
  try {
    const project = await prisma.project.findUnique({ where: { id: req.params.id } })
    if (!project) return next(createError('Project not found', 404, 'NOT_FOUND'))

    await prisma.project.update({ where: { id: req.params.id }, data: { status: 'DELETING' } })

    // Delete K8s resources asynchronously
    provisioner.deprovision(project).catch((err) => {
      console.error(`K8s deprovisioning failed for project ${project.id}:`, err)
    })

    res.status(202).json({ data: { message: 'Project deletion initiated' } })
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

// Update project
projectsRouter.patch('/:id', async (req, res, next) => {
  try {
    const parsed = updateProjectSchema.safeParse(req.body)
    if (!parsed.success) {
      return next(createError(parsed.error.message, 400, 'VALIDATION_ERROR'))
    }

    const existing = await prisma.project.findUnique({ where: { id: req.params.id } })
    if (!existing) return next(createError('Project not found', 404, 'NOT_FOUND'))

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: parsed.data,
      include: { _count: { select: { routes: true, upstreams: true, apiKeys: true } } },
    })

    // Re-push gateway config so authRequired propagates to live gateway
    configPusher.push(project).catch((err: unknown) => {
      console.error(`Config push failed after project update ${project.id}:`, err)
    })

    res.json({ data: project })
  } catch (err) {
    next(err)
  }
})

// Sub-routers
projectsRouter.use('/:id/routes', routesRouter)
projectsRouter.use('/:id/upstreams', upstreamsRouter)
projectsRouter.use('/:id/api-keys', apiKeysRouter)
projectsRouter.use('/:id/end-users', projectEndUsersRouter)
