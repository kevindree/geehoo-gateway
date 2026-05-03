import { Request, Response, NextFunction } from 'express'
import { redis } from '../lib/redis'
import { RouteConfig } from '../lib/schema'
import { logger } from '../lib/logger'

const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX = 100

export function createRateLimitMiddleware(route: RouteConfig) {
  const windowMs = route.rateLimitConfig?.windowMs ?? DEFAULT_WINDOW_MS
  const max = route.rateLimitConfig?.max ?? DEFAULT_MAX

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.sub ?? req.ip ?? 'anonymous'
    const key = `rl:${route.id}:${userId}`
    const now = Date.now()
    const windowStart = now - windowMs

    try {
      // Sliding window using Redis sorted set
      const pipe = redis.pipeline()
      pipe.zremrangebyscore(key, '-inf', windowStart)
      pipe.zadd(key, now, `${now}-${Math.random()}`)
      pipe.zcard(key)
      pipe.expire(key, Math.ceil(windowMs / 1000) + 1)
      const results = await pipe.exec()

      const count = (results?.[2]?.[1] as number) ?? 0

      res.setHeader('X-RateLimit-Limit', max)
      res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count))

      if (count > max) {
        res.status(429).json({
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
        })
        return
      }

      next()
    } catch (err) {
      // Fail open: if Redis is unavailable, allow the request — but always log so ops can detect it
      logger.warn({ err, routeId: route.id }, 'Rate limit Redis error — failing open')
      next()
    }
  }
}
