import { z } from 'zod'

export const rateLimitConfigSchema = z
  .object({
    windowMs: z.number().int().positive().default(60000),
    max: z.number().int().positive().default(100),
  })
  .nullish()

export const authConfigSchema = z
  .object({
    type: z.enum(['jwt', 'apikey']),
  })
  .nullish()

const orchestrationNodeSchema = z.object({
  id: z.string(),
  type: z.enum([
    'trigger',
    'upstream_call',
    'transform',
    'condition',
    'loop',
    'for_each',
    'merge',
    'response',
    'issue_jwt',
    'refresh_jwt',
    'gateway_auth_verify',
    'gateway_auth_register',
  ]),
  config: z.record(z.unknown()),
})

const orchestrationEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
})

export const routeConfigSchema = z.object({
  id: z.string(),
  path: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
  public: z.boolean().default(false),
  authConfig: authConfigSchema,
  rateLimitConfig: rateLimitConfigSchema,
  orchestrationFlow: z.object({
    nodes: z.array(orchestrationNodeSchema),
    edges: z.array(orchestrationEdgeSchema),
  }),
})

const upstreamAuthParamsSchema = z
  .object({
    bearer: z.object({ token: z.string() }).optional(),
    basic: z.object({ username: z.string(), password: z.string() }).optional(),
    apikey_header: z.object({ headerName: z.string(), key: z.string() }).optional(),
    apikey_query: z.object({ paramName: z.string(), key: z.string() }).optional(),
  })
  .optional()

export const projectParamsSchema = z
  .object({
    upstreamAuth: upstreamAuthParamsSchema,
    variables: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  })
  .nullish()

export const gatewayConfigSchema = z.object({
  projectId: z.string(),
  authRequired: z.boolean().default(true),
  projectParams: projectParamsSchema,
  routes: z.array(routeConfigSchema),
})

export type RouteConfig = z.infer<typeof routeConfigSchema>
export type GatewayConfig = z.infer<typeof gatewayConfigSchema>
export type OrchestrationNode = z.infer<typeof orchestrationNodeSchema>
export type OrchestrationEdge = z.infer<typeof orchestrationEdgeSchema>
export type ProjectParams = z.infer<typeof projectParamsSchema>
