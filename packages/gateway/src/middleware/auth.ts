import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { RouteConfig } from '../lib/schema'
import { redis } from '../lib/redis'

export interface GatewayTokenPayload {
  sub: string
  [key: string]: unknown
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      routeConfig?: RouteConfig
      user?: GatewayTokenPayload
    }
  }
}

export function createAuthMiddleware(route: RouteConfig, authRequired: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Project-level auth kill-switch: treat all routes as public
    if (!authRequired || route.public) {
      next()
      return
    }

    const authConfig = route.authConfig ?? { type: 'jwt' }

    if (authConfig.type === 'jwt') {
      handleJwt(req, res, next).catch(next)
    } else if (authConfig.type === 'apikey') {
      handleApiKey(req, res, next)
    } else {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unsupported auth type' } })
    }
  }
}

async function handleJwt(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing Bearer token' } })
    return
  }

  const token = authHeader.slice(7)
  const secret = process.env.GATEWAY_JWT_SECRET ?? ''

  let payload: GatewayTokenPayload
  try {
    payload = jwt.verify(token, secret) as GatewayTokenPayload
  } catch {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } })
    return
  }

  // Check token blocklist (jti-based revocation after refresh)
  if (payload.jti) {
    const blocked = await redis.get(`bl:${payload.jti}`)
    if (blocked) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Token has been revoked' } })
      return
    }
  }

  req.user = payload
  next()
}

function handleApiKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-api-key']
  if (!key || typeof key !== 'string') {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing X-Api-Key header' } })
    return
  }
  // API key validation is done by the orchestrator via control plane lookup
  // For now, attach the raw key prefix for downstream use
  req.user = { sub: `apikey:${key.slice(0, 12)}` }
  next()
}
