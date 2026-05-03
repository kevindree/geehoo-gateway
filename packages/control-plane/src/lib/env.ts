import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  ADMIN_JWT_SECRET: z.string().min(32, 'ADMIN_JWT_SECRET must be at least 32 chars'),
  GATEWAY_JWT_SECRET: z.string().min(32, 'GATEWAY_JWT_SECRET must be at least 32 chars'),
  INTERNAL_SERVICE_SECRET: z.string().min(16, 'INTERNAL_SERVICE_SECRET must be at least 16 chars'),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
})

const _env = envSchema.safeParse(process.env)

if (!_env.success) {
  console.error('Invalid environment variables:')
  console.error(_env.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = _env.data
