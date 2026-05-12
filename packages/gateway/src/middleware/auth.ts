import { Request, Response, NextFunction } from 'express'
import crypto from 'crypto'
import axios from 'axios'
import jwt from 'jsonwebtoken'
import { RouteConfig } from '../lib/schema'
import { redis } from '../lib/redis'
import { env } from '../lib/env'
import { logger } from '../lib/logger'

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

export function createAuthMiddleware(route: RouteConfig, authRequired: boolean, projectId: string) {
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
      handleApiKey(req, res, next, projectId).catch(next)
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

  let payload: GatewayTokenPayload
  try {
    payload = jwt.verify(token, env.GATEWAY_JWT_SECRET) as GatewayTokenPayload
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

// Cache successful API key verifications for a short window so that high-RPS
// callers do not hammer the control plane on every request. Cache key is the
// sha256 of the raw key so we never store plaintext credentials in Redis.
const APIKEY_CACHE_TTL_SECONDS = 60

async function handleApiKey(req: Request, res: Response, next: NextFunction, projectId: string): Promise<void> {
  const key = req.headers['x-api-key']
  if (!key || typeof key !== 'string') {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing X-Api-Key header' } })
    return
  }

  const keyDigest = crypto.createHash('sha256').update(key).digest('hex')
  const cacheKey = `apikey:${projectId}:${keyDigest}`

  // Fast path: cached verification result
  try {
    const cached = await redis.get(cacheKey)
    if (cached) {
      const parsed = JSON.parse(cached) as { id: string; label: string }
      req.user = { sub: `apikey:${parsed.id}`, apiKeyId: parsed.id, apiKeyLabel: parsed.label }
      next()
      return
    }
  } catch (err) {
    // Redis unreachable — fall through to control-plane lookup
    logger.warn({ err }, 'API key cache lookup failed')
  }

  let verified: { id: string; label: string } | null = null
  try {
    const response = await axios.post(
      `${env.CONTROL_PLANE_INTERNAL_URL}/internal/projects/${projectId}/apikeys/verify`,
      { key },
      {
        headers: { 'x-internal-secret': env.INTERNAL_SERVICE_SECRET },
        timeout: 5000,
        validateStatus: () => true,
      },
    )
    if (response.status === 200 && response.data?.id) {
      verified = { id: response.data.id as string, label: (response.data.label as string) ?? '' }
    } else if (response.status === 401) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } })
      return
    } else {
      logger.warn({ status: response.status }, 'API key verify returned non-2xx')
      res.status(503).json({ error: { code: 'AUTH_SERVICE_UNAVAILABLE', message: 'Authentication service unavailable' } })
      return
    }
  } catch (err) {
    logger.error({ err }, 'API key verify call to control plane failed')
    res.status(503).json({ error: { code: 'AUTH_SERVICE_UNAVAILABLE', message: 'Authentication service unavailable' } })
    return
  }

  // Best-effort cache write
  try {
    await redis.set(cacheKey, JSON.stringify(verified), 'EX', APIKEY_CACHE_TTL_SECONDS)
  } catch (err) {
    logger.warn({ err }, 'API key cache write failed')
  }

  req.user = { sub: `apikey:${verified.id}`, apiKeyId: verified.id, apiKeyLabel: verified.label }
  next()
}
