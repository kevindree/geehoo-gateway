import { z } from 'zod'

const envSchema = z.object({
  GATEWAY_PROJECT_ID: z.string().min(1, 'GATEWAY_PROJECT_ID is required'),
  GATEWAY_JWT_SECRET: z.string().min(32, 'GATEWAY_JWT_SECRET must be at least 32 chars'),
  GATEWAY_REDIS_URL: z.string().min(1, 'GATEWAY_REDIS_URL is required'),
  GATEWAY_CONFIG_PATH: z.string().default('/etc/gateway/config.json'),
  CONTROL_PLANE_INTERNAL_URL: z.string().url().default('http://control-plane:4000'),
  INTERNAL_SERVICE_SECRET: z.string().min(16, 'INTERNAL_SERVICE_SECRET must be at least 16 chars'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

const _env = envSchema.safeParse(process.env)

if (!_env.success) {
  console.error('Invalid environment variables:')
  console.error(_env.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = _env.data
