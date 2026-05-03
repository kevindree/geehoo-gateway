import { Request, Response, NextFunction, Application } from 'express'
import fs from 'fs'
import { gatewayConfigSchema, GatewayConfig, RouteConfig, ProjectParams } from '../lib/schema'
import { createAuthMiddleware } from '../middleware/auth'
import { createRateLimitMiddleware } from '../middleware/rateLimit'
import { runOrchestration } from '../orchestrator/engine'
import { createError } from '../middleware/errorHandler'
import { logger } from '../lib/logger'

// Symbol used to tag dynamically registered routes so we can remove them on reload
const DYNAMIC_ROUTE_TAG = '__dynamic__'
// Symbol used to tag the 404 fallback so it can be removed and re-appended after routes on reload
const FALLBACK_404_TAG = '__fallback404__'

export async function registerRoutes(app: Application, configPath: string): Promise<void> {
  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf8')
  } catch (err) {
    logger.warn({ configPath, err }, 'Config file not found, starting with no routes')
    return
  }

  let config: GatewayConfig
  try {
    config = gatewayConfigSchema.parse(JSON.parse(raw))
  } catch (err) {
    logger.error({ err }, 'Invalid gateway config — routes not updated')
    return
  }

  // Remove previously registered dynamic routes and the old 404 fallback
  removeDynamicRoutes(app)

  for (const route of config.routes) {
    if (!route) continue
    mountRoute(app, route, config.projectId, config.authRequired, config.projectParams ?? null)
  }

  // Re-append the 404 fallback AFTER all dynamic routes, then keep error handlers last.
  // This ensures the correct order on every hot-reload:
  //   [static middleware] → [dynamic routes] → [404 fallback] → [error handler]
  const fallback404 = (_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
  }
  ;(fallback404 as unknown as Record<string, unknown>)[FALLBACK_404_TAG] = true
  app.use(fallback404)

  const router = (app as unknown as { _router?: { stack: unknown[] } })._router
  if (router) {
    type Layer = { route?: unknown; handle?: { length?: number; [FALLBACK_404_TAG]?: boolean } }
    // Move the 4-param error handlers to the very end (after the 404 fallback)
    const errLayers = router.stack.filter((l) => !(l as Layer).route && (l as Layer).handle?.length === 4)
    const rest = router.stack.filter((l) => (l as Layer).route || (l as Layer).handle?.length !== 4)
    router.stack = [...rest, ...errLayers]
  }

  logger.info({ routeCount: config.routes.length }, 'Routes registered')
}

function mountRoute(app: Application, route: RouteConfig, projectId: string, authRequired: boolean, projectParams: ProjectParams): void {
  const method = route.method.toLowerCase() as
    | 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options'

  const middlewares = [
    createAuthMiddleware(route, authRequired),
    createRateLimitMiddleware(route),
  ]

  const handler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      req.routeConfig = route
      const result = await runOrchestration(route.orchestrationFlow, req, projectId, projectParams)
      res.status(result.status ?? 200).json(result.data)
    } catch (err) {
      next(err)
    }
  }

  // Tag the route layer so we can find and remove it later
  app[method](route.path, ...middlewares, handler)
  // Mark the last added layer
  const stack = (app as unknown as { _router?: { stack: Array<{ route?: { path: string; stack: Array<{ handle: { [DYNAMIC_ROUTE_TAG]?: boolean } }> } }> } })._router?.stack
  if (stack) {
    const last = stack[stack.length - 1]
    if (last?.route?.stack?.[last.route.stack.length - 1]?.handle) {
      last.route.stack[last.route.stack.length - 1].handle[DYNAMIC_ROUTE_TAG] = true
    }
  }
}

function removeDynamicRoutes(app: Application): void {
  type AnyRecord = Record<string, unknown>
  const router = (app as unknown as { _router?: { stack: Array<{ route?: { stack: Array<{ handle: AnyRecord }> }; handle?: AnyRecord }> } })._router
  if (!router) return

  router.stack = router.stack.filter((layer) => {
    // Remove tagged dynamic route layers
    if (layer.route) {
      const isDynamic = layer.route.stack.some((l) => l.handle[DYNAMIC_ROUTE_TAG] === true)
      return !isDynamic
    }
    // Remove old 404 fallback
    if (layer.handle?.[FALLBACK_404_TAG] === true) return false
    return true
  })
}
