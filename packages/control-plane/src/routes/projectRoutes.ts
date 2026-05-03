import { Router, Request } from 'express'
import { z } from 'zod'
import { HttpMethod, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { createError } from '../middleware/errorHandler'
import { configPusher } from '../k8s/configPusher'

export const routesRouter = Router({ mergeParams: true })

const rateLimitConfigSchema = z
  .object({
    windowMs: z.number().int().positive(),
    max: z.number().int().positive(),
  })
  .optional()

const authConfigSchema = z
  .object({
    type: z.enum(['jwt', 'apikey']),
  })
  .optional()

// Orchestration node types
const orchestrationNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['trigger', 'upstream_call', 'transform', 'condition', 'loop', 'merge', 'response', 'issue_jwt', 'refresh_jwt', 'gateway_auth_verify', 'gateway_auth_register']),
  config: z.record(z.unknown()),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
})

const orchestrationEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
})

const createRouteSchema = z.object({
  name: z.string().min(1).max(100),
  path: z
    .string()
    .min(1)
    .regex(/^\//, 'Path must start with /'),
  method: z.nativeEnum(HttpMethod),
  public: z.boolean().default(false),
  description: z.string().optional(),
  authConfig: authConfigSchema,
  rateLimitConfig: rateLimitConfigSchema,
  orchestrationFlow: z.object({
    nodes: z.array(orchestrationNodeSchema).min(1),
    edges: z.array(orchestrationEdgeSchema),
  }),
})

// List routes for project
routesRouter.get('/', async (req: Request<{ id: string }>, res, next) => {
  try {
    const routes = await prisma.route.findMany({
      where: { projectId: req.params.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    res.json({ data: routes })
  } catch (err) {
    next(err)
  }
})

// Reorder routes
routesRouter.patch('/reorder', async (req: Request<{ id: string }>, res, next) => {
  try {
    const parsed = z.object({ ids: z.array(z.string()).min(1) }).safeParse(req.body)
    if (!parsed.success) {
      return next(createError(parsed.error.message, 400, 'VALIDATION_ERROR'))
    }
    const { ids } = parsed.data
    await prisma.$transaction(
      ids.map((id, idx) =>
        prisma.route.updateMany({
          where: { id, projectId: req.params.id },
          data: { sortOrder: idx },
        }),
      ),
    )
    res.json({ data: { ok: true } })
  } catch (err) {
    next(err)
  }
})

// Create route
routesRouter.post('/', async (req: Request<{ id: string }>, res, next) => {
  try {
    const parsed = createRouteSchema.safeParse(req.body)
    if (!parsed.success) {
      return next(createError(parsed.error.message, 400, 'VALIDATION_ERROR'))
    }

    const project = await prisma.project.findUnique({ where: { id: req.params.id } })
    if (!project) return next(createError('Project not found', 404, 'NOT_FOUND'))

    const { orchestrationFlow, ...otherData } = parsed.data
    const route = await prisma.route.create({
      data: {
        ...otherData,
        projectId: req.params.id,
        orchestrationFlow: orchestrationFlow as unknown as Prisma.InputJsonValue,
      },
    })

    // Push updated config to K8s ConfigMap
    await configPusher.push(project)

    res.status(201).json({ data: route })
  } catch (err) {
    next(err)
  }
})

// Get route
routesRouter.get('/:routeId', async (req: Request<{ id: string; routeId: string }>, res, next) => {
  try {
    const route = await prisma.route.findFirst({
      where: { id: req.params.routeId, projectId: req.params.id },
    })
    if (!route) return next(createError('Route not found', 404, 'NOT_FOUND'))
    res.json({ data: route })
  } catch (err) {
    next(err)
  }
})

// Update route
routesRouter.put('/:routeId', async (req: Request<{ id: string; routeId: string }>, res, next) => {
  try {
    const parsed = createRouteSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return next(createError(parsed.error.message, 400, 'VALIDATION_ERROR'))
    }

    const existing = await prisma.route.findFirst({
      where: { id: req.params.routeId, projectId: req.params.id },
    })
    if (!existing) return next(createError('Route not found', 404, 'NOT_FOUND'))

    const { orchestrationFlow, ...restData } = parsed.data
    const route = await prisma.route.update({
      where: { id: req.params.routeId },
      data: {
        ...restData,
        ...(orchestrationFlow !== undefined
          ? { orchestrationFlow: orchestrationFlow as unknown as Prisma.InputJsonValue }
          : {}),
      },
    })

    const project = await prisma.project.findUnique({ where: { id: req.params.id } })
    if (project) await configPusher.push(project)

    res.json({ data: route })
  } catch (err) {
    next(err)
  }
})

// Delete route
routesRouter.delete('/:routeId', async (req: Request<{ id: string; routeId: string }>, res, next) => {
  try {
    const existing = await prisma.route.findFirst({
      where: { id: req.params.routeId, projectId: req.params.id },
    })
    if (!existing) return next(createError('Route not found', 404, 'NOT_FOUND'))

    await prisma.route.delete({ where: { id: req.params.routeId } })

    const project = await prisma.project.findUnique({ where: { id: req.params.id } })
    if (project) await configPusher.push(project)

    res.status(204).send()
  } catch (err) {
    next(err)
  }
})
