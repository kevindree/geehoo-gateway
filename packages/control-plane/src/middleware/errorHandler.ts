import { Request, Response, NextFunction } from 'express'
import { Prisma } from '@prisma/client'
import { logger } from '../lib/logger'

export interface AppError extends Error {
  statusCode?: number
  code?: string
}

// Map Prisma error codes to HTTP status codes and user-friendly messages
function mapPrismaError(err: Prisma.PrismaClientKnownRequestError): {
  statusCode: number
  code: string
  message: string
} {
  switch (err.code) {
    case 'P2002': {
      const fields = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'unknown fields'
      return { statusCode: 409, code: 'CONFLICT', message: `A record with these values already exists (${fields})` }
    }
    case 'P2025':
      return { statusCode: 404, code: 'NOT_FOUND', message: 'Record not found' }
    default:
      return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' }
  }
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = mapPrismaError(err)
    if (mapped.statusCode >= 500) {
      logger.error({ err }, 'Unhandled error')
    }
    return void res.status(mapped.statusCode).json({ error: { code: mapped.code, message: mapped.message } })
  }

  const statusCode = err.statusCode ?? 500
  const code = err.code ?? 'INTERNAL_ERROR'
  const message = statusCode >= 500 ? 'An unexpected error occurred' : err.message

  if (statusCode >= 500) {
    logger.error({ err }, 'Unhandled error')
  }

  res.status(statusCode).json({ error: { code, message } })
}

export function createError(message: string, statusCode: number, code: string): AppError {
  const err = new Error(message) as AppError
  err.statusCode = statusCode
  err.code = code
  return err
}
