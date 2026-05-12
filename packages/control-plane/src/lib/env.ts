import { z } from 'zod'

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
    ADMIN_JWT_SECRET: z.string().min(32, 'ADMIN_JWT_SECRET must be at least 32 chars'),
    GATEWAY_JWT_SECRET: z.string().min(32, 'GATEWAY_JWT_SECRET must be at least 32 chars'),
    INTERNAL_SERVICE_SECRET: z.string().min(16, 'INTERNAL_SERVICE_SECRET must be at least 16 chars'),
    KEY_ENCRYPTION_SECRET: z.string().min(32, 'KEY_ENCRYPTION_SECRET must be at least 32 chars'),
    PORT: z.coerce.number().default(4000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

    // Public app URL used to build email links (e.g. activation, invitation)
    APP_PUBLIC_URL: z.string().url('APP_PUBLIC_URL must be a valid URL').default('http://localhost:3000'),

    // SMTP (optional in dev — falls back to logging the link to stdout; required in production)
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    // Bootstrap super-admin (used by `npm run db:seed`)
    BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
    BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === 'production') {
      const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const
      for (const k of required) {
        if (!data[k]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [k],
            message: `${k} is required in production`,
          })
        }
      }
    }
  })

const _env = envSchema.safeParse(process.env)

if (!_env.success) {
  console.error('Invalid environment variables:')
  console.error(_env.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = _env.data
