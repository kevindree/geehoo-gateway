import { Request, Response, NextFunction } from 'express'
import { logger } from '../lib/logger'
import { UpstreamCallError, UpstreamNetworkError } from '../orchestrator/call'

export interface GatewayError extends Error {
  statusCode?: number
  code?: string
}

export function errorHandler(
  err: GatewayError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as Request & { id?: string }).id

  // Upstream network errors: timeout → 504, connection refused/unavailable → 503
  if (err instanceof UpstreamNetworkError) {
    logger.warn({ requestId, upstreamId: err.upstreamId, statusCode: err.statusCode }, err.message)
    res.status(err.statusCode).json({
      error: {
        code: err.statusCode === 504 ? 'GATEWAY_TIMEOUT' : 'SERVICE_UNAVAILABLE',
        message: err.message,
        requestId,
      },
    })
    return
  }

  // Upstream 4xx errors: use upstream status + pass through upstream response body as detail
  if (err instanceof UpstreamCallError) {
    if (err.statusCode < 500) {
      logger.warn({ statusCode: err.statusCode, upstreamId: err.upstreamId }, 'Upstream business error')
      res.status(err.statusCode).json({
        error: {
          code: 'UPSTREAM_ERROR',
          message: `Upstream returned ${err.statusCode}`,
          detail: err.upstreamData,
        },
      })
    } else {
      logger.error({ err, requestId }, 'Upstream server error')
      res.status(502).json({ error: { code: 'BAD_GATEWAY', message: 'Upstream service error', requestId } })
    }
    return
  }

  const statusCode = err.statusCode ?? 500
  const code = err.code ?? 'INTERNAL_ERROR'
  const message = statusCode >= 500 ? 'An unexpected error occurred' : err.message

  if (statusCode >= 500) {
    logger.error({ err, requestId }, 'Gateway unhandled error')
  }

  res.status(statusCode).json({ error: { code, message, ...(statusCode >= 500 && requestId ? { requestId } : {}) } })
}

export function createError(message: string, statusCode: number, code: string): GatewayError {
  const err = new Error(message) as GatewayError
  err.statusCode = statusCode
  err.code = code
  return err
}
