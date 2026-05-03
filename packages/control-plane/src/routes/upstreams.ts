import { Router, Request } from 'express'
import { z } from 'zod'
import { UpstreamType } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { createError } from '../middleware/errorHandler'

export const upstreamsRouter = Router({ mergeParams: true })

const createUpstreamSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.nativeEnum(UpstreamType).default('REST'),
  baseUrl: z.string().url('Must be a valid URL'),
  description: z.string().optional(),
  defaultHeaders: z.record(z.string()).optional(),
  timeout: z.number().int().positive().default(10000),
  retryConfig: z
    .object({
      maxRetries: z.number().int().min(0).max(5),
      backoffMs: z.number().int().positive(),
    })
    .optional(),
})

upstreamsRouter.get('/', async (req: Request<{ id: string }>, res, next) => {
  try {
    const upstreams = await prisma.upstream.findMany({
      where: { projectId: req.params.id },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ data: upstreams })
  } catch (err) {
    next(err)
  }
})

upstreamsRouter.post('/', async (req: Request<{ id: string }>, res, next) => {
  try {
    const parsed = createUpstreamSchema.safeParse(req.body)
    if (!parsed.success) {
      return next(createError(parsed.error.message, 400, 'VALIDATION_ERROR'))
    }

    const project = await prisma.project.findUnique({ where: { id: req.params.id } })
    if (!project) return next(createError('Project not found', 404, 'NOT_FOUND'))

    const upstream = await prisma.upstream.create({
      data: { ...parsed.data, projectId: req.params.id },
    })
    res.status(201).json({ data: upstream })
  } catch (err) {
    next(err)
  }
})

upstreamsRouter.get('/:upstreamId', async (req: Request<{ id: string; upstreamId: string }>, res, next) => {
  try {
    const upstream = await prisma.upstream.findFirst({
      where: { id: req.params.upstreamId, projectId: req.params.id },
    })
    if (!upstream) return next(createError('Upstream not found', 404, 'NOT_FOUND'))
    res.json({ data: upstream })
  } catch (err) {
    next(err)
  }
})

upstreamsRouter.put('/:upstreamId', async (req: Request<{ id: string; upstreamId: string }>, res, next) => {
  try {
    const parsed = createUpstreamSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return next(createError(parsed.error.message, 400, 'VALIDATION_ERROR'))
    }

    const existing = await prisma.upstream.findFirst({
      where: { id: req.params.upstreamId, projectId: req.params.id },
    })
    if (!existing) return next(createError('Upstream not found', 404, 'NOT_FOUND'))

    const upstream = await prisma.upstream.update({
      where: { id: req.params.upstreamId },
      data: parsed.data,
    })
    res.json({ data: upstream })
  } catch (err) {
    next(err)
  }
})

upstreamsRouter.delete('/:upstreamId', async (req: Request<{ id: string; upstreamId: string }>, res, next) => {
  try {
    const existing = await prisma.upstream.findFirst({
      where: { id: req.params.upstreamId, projectId: req.params.id },
    })
    if (!existing) return next(createError('Upstream not found', 404, 'NOT_FOUND'))
    await prisma.upstream.delete({ where: { id: req.params.upstreamId } })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})
