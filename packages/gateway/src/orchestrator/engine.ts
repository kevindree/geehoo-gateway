import { Request } from 'express'
import crypto from 'crypto'
import axios from 'axios'
import jwt from 'jsonwebtoken'
import { GatewayConfig, OrchestrationNode, OrchestrationEdge, ProjectParams } from '../lib/schema'
import { callUpstream, UpstreamCallConfig } from './call'
import { applyTransform } from './transform'
import { logger } from '../lib/logger'
import { createError } from '../middleware/errorHandler'
import { redis } from '../lib/redis'
import { env } from '../lib/env'

type OrchestrationFlow = GatewayConfig['routes'][0]['orchestrationFlow']

interface ExecutionContext {
  req: Request
  projectId: string
  projectParams: ProjectParams
  results: Record<string, unknown>
}

export async function runOrchestration(
  flow: OrchestrationFlow,
  req: Request,
  projectId: string,
  projectParams?: ProjectParams,
): Promise<{ status: number; data: unknown }> {
  const { nodes, edges } = flow

  // Build adjacency map: nodeId → next nodeIds
  const adjacency = buildAdjacency(edges)

  // Find trigger node
  const trigger = nodes.find((n) => n.type === 'trigger')
  if (!trigger) throw createError('Orchestration flow missing trigger node', 500, 'CONFIG_ERROR')

  const ctx: ExecutionContext = {
    req,
    projectId,
    projectParams: projectParams ?? null,
    results: {
      trigger: {
        body: req.body,
        query: req.query,
        params: req.params,
        headers: sanitizeRequestHeaders(req.headers as Record<string, string>),
        user: req.user,
      },
    },
  }

  // Walk the graph from trigger
  await executeNode(trigger, ctx, nodes, adjacency)

  // Find response node result
  const responseNode = nodes.find((n) => n.type === 'response')
  if (responseNode && ctx.results[responseNode.id] !== undefined) {
    const result = ctx.results[responseNode.id] as { status?: number; data?: unknown }
    return { status: result.status ?? 200, data: result.data ?? result }
  }

  // Fallback: return last meaningful node result
  const STRUCTURAL = new Set(['trigger', 'response', 'condition', 'merge', 'transform'])
  const lastMeaningful = [...nodes].reverse().find(
    (n) => !STRUCTURAL.has(n.type) && ctx.results[n.id] !== undefined,
  )
  if (lastMeaningful) {
    const r = ctx.results[lastMeaningful.id] as { status?: number; data?: unknown }
    return { status: r.status ?? 200, data: r.data ?? r }
  }

  return { status: 200, data: {} }
}

async function executeNode(
  node: OrchestrationNode,
  ctx: ExecutionContext,
  allNodes: OrchestrationNode[],
  adjacency: Map<string, string[]>,
  stopNodeIds: Set<string> = new Set(),
  visited: Set<string> = new Set(),
): Promise<void> {
  if (visited.has(node.id)) {
    logger.warn({ nodeId: node.id }, 'Orchestration cycle detected — skipping re-entry')
    return
  }
  visited.add(node.id)
  logger.debug({ nodeId: node.id, type: node.type }, 'Executing orchestration node')

  switch (node.type) {
    case 'trigger':
      break // Already populated in ctx.results

    case 'upstream_call':
      ctx.results[node.id] = await executeUpstreamCall(node, ctx)
      break

    case 'transform':
      ctx.results[node.id] = await executeTransform(node, ctx)
      break

    case 'condition':
      await executeCondition(node, ctx, allNodes, adjacency, stopNodeIds, visited)
      return // Condition handles its own branching

    case 'loop':
      ctx.results[node.id] = await executeLoop(node, ctx, allNodes, adjacency)
      break

    case 'for_each':
      ctx.results[node.id] = await executeForEach(node, ctx, allNodes, adjacency)
      break

    case 'merge':
      ctx.results[node.id] = executeMerge(node, ctx)
      break

    case 'response':
      ctx.results[node.id] = executeResponse(node, ctx, allNodes)
      break

    case 'issue_jwt':
      ctx.results[node.id] = await executeIssueJwt(node, ctx, allNodes)
      break

    case 'refresh_jwt':
      ctx.results[node.id] = await executeRefreshJwt(node, ctx)
      break

    case 'gateway_auth_verify':
      ctx.results[node.id] = await executeGatewayAuthVerify(node, ctx)
      break

    case 'gateway_auth_register':
      ctx.results[node.id] = await executeGatewayAuthRegister(node, ctx)
      break
  }

  // Execute next nodes sequentially (skip any nodes in the stop set)
  const nextIds = adjacency.get(node.id) ?? []
  for (const nextId of nextIds) {
    if (stopNodeIds.has(nextId)) continue
    const nextNode = allNodes.find((n) => n.id === nextId)
    if (nextNode) await executeNode(nextNode, ctx, allNodes, adjacency, stopNodeIds, visited)
  }
}

async function executeUpstreamCall(
  node: OrchestrationNode,
  ctx: ExecutionContext,
): Promise<unknown> {
  const cfg = node.config as {
    upstreamId: string
    type?: 'REST' | 'GRAPHQL' | 'SOAP'
    url: string
    method?: string
    headers?: Record<string, string>
    body?: unknown            // Static body/params configured in UI
    bodyFrom?: string | string[]  // JMESPath ref(s) to extract body from previous results; multiple refs are merged (shallow)
    timeout?: number
    upstreamAuth?: import('./call').UpstreamAuth & { useProjectParam?: boolean }
    soapAction?: string
    graphqlQuery?: string
    graphqlVariablesFrom?: string
  }

  const method = (cfg.method ?? ctx.req.method ?? 'GET').toUpperCase()
  const isBodylessMethod = method === 'GET' || method === 'HEAD' || method === 'DELETE'

  // Parse static body string from UI into an object if needed
  let staticBody: unknown = cfg.body
  if (typeof cfg.body === 'string' && cfg.body.trim()) {
    try { staticBody = JSON.parse(cfg.body) } catch { staticBody = undefined }
  }

  // Resolve the body: bodyFrom (dynamic ref) > cfg.body (static config) > request body (passthrough)
  // For bodyless methods (GET/HEAD/DELETE), default to forwarding the incoming query params.
  let resolvedBody: unknown
  if (cfg.bodyFrom) {
    const refs = Array.isArray(cfg.bodyFrom) ? cfg.bodyFrom : [cfg.bodyFrom]
    if (refs.length === 1) {
      resolvedBody = resolveRef(refs[0], ctx)
    } else {
      // Merge multiple sources shallow — later entries overwrite earlier ones on key collision
      resolvedBody = Object.assign({}, ...refs.map((r) => resolveRef(r, ctx) ?? {}))
    }
  } else if (staticBody !== undefined) {
    resolvedBody = staticBody
  } else if (isBodylessMethod) {
    resolvedBody = Object.keys(ctx.req.query).length > 0 ? ctx.req.query : undefined
  } else {
    resolvedBody = ctx.req.body
  }

  // Resolve upstream auth: if useProjectParam is set, pull credentials from project-level params
  let resolvedAuth = cfg.upstreamAuth as import('./call').UpstreamAuth | undefined
  if (cfg.upstreamAuth?.useProjectParam && cfg.upstreamAuth.type && cfg.upstreamAuth.type !== 'none') {
    const projectAuth = ctx.projectParams?.upstreamAuth
    if (projectAuth) {
      const authType = cfg.upstreamAuth.type
      if (authType === 'bearer' && projectAuth.bearer) {
        resolvedAuth = { type: 'bearer', token: projectAuth.bearer.token }
      } else if (authType === 'basic' && projectAuth.basic) {
        resolvedAuth = { type: 'basic', username: projectAuth.basic.username, password: projectAuth.basic.password }
      } else if (authType === 'apikey_header' && projectAuth.apikey_header) {
        resolvedAuth = { type: 'apikey_header', headerName: projectAuth.apikey_header.headerName, key: projectAuth.apikey_header.key }
      } else if (authType === 'apikey_query' && projectAuth.apikey_query) {
        resolvedAuth = { type: 'apikey_query', paramName: projectAuth.apikey_query.paramName, key: projectAuth.apikey_query.key }
      }
    }
  }

  const callConfig: UpstreamCallConfig = {
    upstreamId: cfg.upstreamId,
    type: cfg.type ?? 'REST',
    url: interpolateTemplate(cfg.url, ctx),
    method,
    headers: cfg.headers,
    // For bodyless methods, static params go as query string; otherwise as request body
    body: isBodylessMethod ? undefined : resolvedBody,
    params: isBodylessMethod && resolvedBody !== undefined
      ? resolvedBody as Record<string, unknown>
      : undefined,
    timeout: cfg.timeout,
    upstreamAuth: resolvedAuth,
    soapAction: cfg.soapAction,
    graphqlQuery: cfg.graphqlQuery,
    graphqlVariables: cfg.graphqlVariablesFrom
      ? resolveRef(cfg.graphqlVariablesFrom, ctx) as Record<string, unknown>
      : undefined,
  }

  return callUpstream(callConfig)
}

async function executeTransform(
  node: OrchestrationNode,
  ctx: ExecutionContext,
): Promise<unknown> {
  const cfg = node.config as {
    inputFrom: string
    transform: Parameters<typeof applyTransform>[0]
  }
  const input = resolveRef(cfg.inputFrom, ctx)
  return applyTransform(cfg.transform, input, ctx.results)
}

async function executeCondition(
  node: OrchestrationNode,
  ctx: ExecutionContext,
  allNodes: OrchestrationNode[],
  adjacency: Map<string, string[]>,
  stopNodeIds: Set<string> = new Set(),
  visited: Set<string> = new Set(),
): Promise<void> {
  const cfg = node.config as {
    inputFrom: string
    condition: string   // JMESPath expression returning truthy
  }

  const result = await applyTransform(
    { type: 'jmespath', expression: cfg.condition },
    resolveRef(cfg.inputFrom, ctx),
  )
  const branch = result ? 'true' : 'false'

  // Edges from condition node must have label 'true' or 'false'
  // adjacency only stores targets; rebuild from edges is done at graph level
  // Here we use the node config to specify branch targets
  const cfgBranch = node.config as Record<string, string>
  const nextId = cfgBranch[branch]
  if (nextId && !stopNodeIds.has(nextId)) {
    const nextNode = allNodes.find((n) => n.id === nextId)
    if (nextNode) await executeNode(nextNode, ctx, allNodes, adjacency, stopNodeIds, visited)
  }
}

async function executeLoop(
  node: OrchestrationNode,
  ctx: ExecutionContext,
  allNodes: OrchestrationNode[],
  adjacency: Map<string, string[]>,
): Promise<unknown[]> {
  const cfg = node.config as {
    targetNodeId: string        // Node to execute repeatedly
    stopCondition: string       // JMESPath: stop when truthy
    maxIterations?: number
    aggregateResultsFrom?: string
  }

  const MAX = Math.min(cfg.maxIterations ?? 10, 50) // Hard cap: 50 iterations
  const accumulated: unknown[] = []

  for (let i = 0; i < MAX; i++) {
    const targetNode = allNodes.find((n) => n.id === cfg.targetNodeId)
    if (!targetNode) break

    // Pass the loop node's own ID as a stop node to prevent the target sub-graph
    // from following edges back into this loop node (which would cause infinite recursion).
    await executeNode(targetNode, ctx, allNodes, adjacency, new Set([node.id]))

    const iterResult = cfg.aggregateResultsFrom
      ? resolveRef(cfg.aggregateResultsFrom, ctx)
      : ctx.results[cfg.targetNodeId]

    if (Array.isArray(iterResult)) {
      accumulated.push(...iterResult)
    } else {
      accumulated.push(iterResult)
    }

    // Check stop condition
    const shouldStop = await applyTransform(
      { type: 'jmespath', expression: cfg.stopCondition },
      ctx.results[cfg.targetNodeId],
    )
    if (shouldStop) break
  }

  return accumulated
}

async function executeForEach(
  node: OrchestrationNode,
  ctx: ExecutionContext,
  allNodes: OrchestrationNode[],
  adjacency: Map<string, string[]>,
): Promise<unknown[]> {
  const cfg = node.config as {
    iterateFrom: string         // ref to the array to iterate (e.g. "productList.data")
    targetNodeId: string        // node executed once per item
    itemAlias?: string          // key under which the current item is exposed (default '$item')
    collectFrom?: string        // optional ref to extract per-iteration value (defaults to target node result)
    mergeWithItem?: boolean     // if true, shallow-merge the item with the collected value
    maxConcurrency?: number     // default 1 (sequential)
    maxItems?: number           // hard cap
  }

  const items = resolveRef(cfg.iterateFrom, ctx)
  if (!Array.isArray(items)) {
    throw createError(
      `for_each: iterateFrom "${cfg.iterateFrom}" did not resolve to an array`,
      500,
      'CONFIG_ERROR',
    )
  }

  const targetNode = allNodes.find((n) => n.id === cfg.targetNodeId)
  if (!targetNode) {
    throw createError(
      `for_each: targetNodeId "${cfg.targetNodeId}" not found`,
      500,
      'CONFIG_ERROR',
    )
  }

  const HARD_CAP = 200
  const limit = Math.min(items.length, cfg.maxItems ?? HARD_CAP, HARD_CAP)
  const concurrency = Math.max(1, Math.min(cfg.maxConcurrency ?? 1, 20))
  const alias = cfg.itemAlias?.trim() || '$item'
  const indexAlias = `${alias}Index`

  const out: unknown[] = new Array(limit)

  const runOne = async (idx: number): Promise<void> => {
    const item = items[idx]
    // Each iteration runs in a sub-context so $item / writes from the iteration
    // do not leak across iterations or back into the parent flow.
    const subCtx: ExecutionContext = {
      ...ctx,
      results: { ...ctx.results, [alias]: item, [indexAlias]: idx },
    }

    // Use the for_each node's own ID as a stop node to prevent the target sub-graph
    // from following edges back into this for_each node (same infinite-recursion guard as loop).
    await executeNode(targetNode, subCtx, allNodes, adjacency, new Set([node.id]))

    let collected: unknown = cfg.collectFrom
      ? resolveRef(cfg.collectFrom, subCtx)
      : subCtx.results[cfg.targetNodeId]

    // Unwrap an upstream_call envelope { status, data } automatically
    if (
      collected &&
      typeof collected === 'object' &&
      !Array.isArray(collected) &&
      'data' in (collected as Record<string, unknown>) &&
      'status' in (collected as Record<string, unknown>)
    ) {
      collected = (collected as { data: unknown }).data
    }

    if (
      cfg.mergeWithItem &&
      item !== null &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      collected !== null &&
      typeof collected === 'object' &&
      !Array.isArray(collected)
    ) {
      out[idx] = { ...(item as object), ...(collected as object) }
    } else {
      out[idx] = collected
    }
  }

  // Worker-pool style: spawn `concurrency` workers that pull indices off a shared cursor.
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, limit) }, async () => {
    let idx = cursor++
    while (idx < limit) {
      await runOne(idx)
      idx = cursor++
    }
  })
  await Promise.all(workers)

  return out
}

function executeMerge(node: OrchestrationNode, ctx: ExecutionContext): unknown {
  const cfg = node.config as {
    sources: string[]           // Node ID or dot-path refs (e.g. "nodeId.data") to merge
    strategy?: 'merge' | 'array' | 'first'
  }

  // Use resolveRef so sources can be paths like "nodeId.data" or "nodeId.data.field"
  const values = cfg.sources.map((src) => resolveRef(src, ctx))

  if (cfg.strategy === 'array') return values
  if (cfg.strategy === 'first') return values[0] 

  // Default: deep merge objects (skip non-object values — primitives cannot be spread)
  return values.reduce((acc, val) => {
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      return { ...(acc as object), ...(val as object) }
    }
    return acc
  }, {})
}

function executeResponse(
  node: OrchestrationNode,
  ctx: ExecutionContext,
  allNodes: OrchestrationNode[],
): unknown {
  const cfg = node.config as {
    status?: number
    dataFrom?: string   // Node ID or JMESPath ref to use as response body
  }

  let data: unknown
  if (cfg.dataFrom && cfg.dataFrom.trim()) {
    data = resolveRef(cfg.dataFrom, ctx)
  } else {
    // No dataFrom configured — use the last executed non-structural node's result
    // Priority: issue_jwt > upstream_call > any other result
    const STRUCTURAL = new Set(['trigger', 'response', 'condition', 'merge', 'transform'])
    const lastMeaningful = [...allNodes].reverse().find(
      (n) => !STRUCTURAL.has(n.type) && ctx.results[n.id] !== undefined,
    )
    if (lastMeaningful) {
      const r = ctx.results[lastMeaningful.id]
      data = (r as { data?: unknown })?.data !== undefined ? (r as { data: unknown }).data : r
    } else {
      data = {}
    }
  }
  return { status: cfg.status ?? 200, data }
}

async function executeIssueJwt(
  node: OrchestrationNode,
  ctx: ExecutionContext,
  allNodes: OrchestrationNode[],
): Promise<unknown> {
  const cfg = node.config as {
    claimsFrom?: string  // JMESPath ref to extract claims from a previous node result
    expiresIn?: string   // e.g. '24h', '7d' — defaults to '24h'
  }

  // Resolve claims: explicit ref > last gateway_auth_* > last upstream_call .data
  let claims: Record<string, unknown>
  if (cfg.claimsFrom && cfg.claimsFrom.trim()) {
    claims = resolveRef(cfg.claimsFrom, ctx) as Record<string, unknown>
  } else {
    const lastAuth = [...allNodes].reverse().find(
      (n) => n.type === 'gateway_auth_verify' || n.type === 'gateway_auth_register',
    )
    if (lastAuth && ctx.results[lastAuth.id]) {
      claims = ctx.results[lastAuth.id] as Record<string, unknown>
    } else {
      const lastUpstream = [...allNodes].reverse().find((n) => n.type === 'upstream_call')
      if (lastUpstream && ctx.results[lastUpstream.id]) {
        const upstreamResult = ctx.results[lastUpstream.id] as { data?: Record<string, unknown> }
        claims = upstreamResult.data ?? {}
      } else {
        claims = {}
      }
    }
  }

  const expiresIn = cfg.expiresIn ?? '24h'
  const expiresInSeconds = parseExpiresIn(expiresIn)

  const jti = crypto.randomUUID()
  const accessToken = jwt.sign(
    { ...claims, projectId: ctx.projectId, jti },
    env.GATEWAY_JWT_SECRET,
    { expiresIn } as jwt.SignOptions,
  )

  // Generate refresh token: random 32 bytes, store hash in Redis
  const rawRefreshToken = crypto.randomBytes(32).toString('hex')
  const refreshHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex')
  const refreshKey = `rt:${ctx.projectId}:${refreshHash}`
  // Store full claims (including jti) so refresh can blocklist the old access token
  const refreshPayload = JSON.stringify({ ...claims, projectId: ctx.projectId, jti })
  await redis.set(refreshKey, refreshPayload, 'EX', 7 * 24 * 60 * 60)

  return { accessToken, refreshToken: rawRefreshToken, expiresIn: expiresInSeconds }
}

async function executeRefreshJwt(
  node: OrchestrationNode,
  ctx: ExecutionContext,
): Promise<unknown> {
  const cfg = node.config as {
    expiresIn?: string
  }

  const rawRefreshToken = ctx.req.body?.refreshToken
  if (!rawRefreshToken || typeof rawRefreshToken !== 'string') {
    throw createError('refreshToken is required', 400, 'VALIDATION_ERROR')
  }

  const refreshHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex')
  const refreshKey = `rt:${ctx.projectId}:${refreshHash}`

  const stored = await redis.get(refreshKey)
  if (!stored) {
    throw createError('Invalid or expired refresh token', 401, 'UNAUTHORIZED')
  }

  // Rotate: delete old token immediately
  await redis.del(refreshKey)

  const claims = JSON.parse(stored) as Record<string, unknown>
  const expiresIn = cfg.expiresIn ?? '24h'
  const expiresInSeconds = parseExpiresIn(expiresIn)

  // Blocklist the old access token's jti so it can't be reused after refresh
  const oldJti = (claims as { jti?: string }).jti
  if (oldJti) {
    const oldTtl = parseExpiresIn(expiresIn)
    await redis.set(`bl:${oldJti}`, '1', 'EX', oldTtl)
  }

  // Strip jti from claims before re-signing so a fresh one is issued
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { jti: _oldJti, ...cleanClaims } = claims as Record<string, unknown> & { jti?: string }
  const newJti = crypto.randomUUID()
  const accessToken = jwt.sign(
    { ...cleanClaims, projectId: ctx.projectId, jti: newJti },
    env.GATEWAY_JWT_SECRET,
    { expiresIn } as jwt.SignOptions,
  )

  // Issue new refresh token
  const newRawToken = crypto.randomBytes(32).toString('hex')
  const newHash = crypto.createHash('sha256').update(newRawToken).digest('hex')
  const newKey = `rt:${ctx.projectId}:${newHash}`
  // Store new jti so the next refresh can blocklist this access token too
  await redis.set(newKey, JSON.stringify({ ...cleanClaims, projectId: ctx.projectId, jti: newJti }), 'EX', 7 * 24 * 60 * 60)

  return { accessToken, refreshToken: newRawToken, expiresIn: expiresInSeconds }
}

async function executeGatewayAuthVerify(
  _node: OrchestrationNode,
  ctx: ExecutionContext,
): Promise<unknown> {
  const { email, password } = ctx.req.body ?? {}
  if (!email || !password) {
    throw createError('email and password are required', 400, 'VALIDATION_ERROR')
  }

  try {
    const response = await axios.post(
      `${env.CONTROL_PLANE_INTERNAL_URL}/internal/projects/${ctx.projectId}/auth/verify`,
      { email, password },
      { headers: { 'x-internal-secret': env.INTERNAL_SERVICE_SECRET }, timeout: 10000 },
    )
    return response.data as Record<string, unknown>
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      throw createError('Invalid credentials', 401, 'UNAUTHORIZED')
    }
    logger.error({ err }, 'gateway_auth_verify: control plane request failed')
    throw createError('Authentication service unavailable', 502, 'UPSTREAM_ERROR')
  }
}

async function executeGatewayAuthRegister(
  _node: OrchestrationNode,
  ctx: ExecutionContext,
): Promise<unknown> {
  const { email, password } = ctx.req.body ?? {}
  if (!email || !password) {
    throw createError('email and password are required', 400, 'VALIDATION_ERROR')
  }

  try {
    const response = await axios.post(
      `${env.CONTROL_PLANE_INTERNAL_URL}/internal/projects/${ctx.projectId}/auth/register`,
      { email, password },
      { headers: { 'x-internal-secret': env.INTERNAL_SERVICE_SECRET }, timeout: 10000 },
    )
    return response.data as Record<string, unknown>
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 409) {
      throw createError('Email already registered', 409, 'CONFLICT')
    }
    logger.error({ err }, 'gateway_auth_register: control plane request failed')
    throw createError('Registration service unavailable', 502, 'UPSTREAM_ERROR')
  }
}

/** Parse expiresIn string ('24h', '7d', '3600') → seconds */
function parseExpiresIn(expiresIn: string): number {
  const num = parseInt(expiresIn, 10)
  if (expiresIn.endsWith('d')) return num * 86400
  if (expiresIn.endsWith('h')) return num * 3600
  if (expiresIn.endsWith('m')) return num * 60
  return num // assume seconds
}

function buildAdjacency(edges: OrchestrationEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const edge of edges) {
    if (!map.has(edge.source)) map.set(edge.source, [])
    map.get(edge.source)!.push(edge.target)
  }
  return map
}

function resolveRef(ref: string, ctx: ExecutionContext): unknown {
  // Handle variables.NAME namespace
  if (ref.startsWith('variables.')) {
    const varName = ref.slice('variables.'.length)
    const vars = (ctx.projectParams as { variables?: { name: string; value: string }[] } | null)?.variables
    return vars?.find((v) => v.name === varName)?.value
  }
  // ref format: "nodeId" or "nodeId.data" or "nodeId.data.field"
  const [nodeId, ...rest] = ref.split('.')
  const base = ctx.results[nodeId]
  if (rest.length === 0) return base
  return rest.reduce((acc, key) => {
    if (acc !== null && acc !== undefined && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, base)
}

// Replace {{ref.path}} placeholders in a string template with values from the execution context.
// URL-encodes substituted values to keep URLs safe.
function interpolateTemplate(template: string, ctx: ExecutionContext): string {
  if (!template || !template.includes('{{')) return template
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_match, ref: string) => {
    const value = resolveRef(ref, ctx)
    if (value === undefined || value === null) return ''
    // variables.* are raw values (e.g. base URLs) — do not URL-encode
    if (ref.startsWith('variables.')) return String(value)
    return encodeURIComponent(String(value))
  })
}

// Only forward safe request headers to templates/scripts
function sanitizeRequestHeaders(headers: Record<string, string>): Record<string, string> {
  const ALLOWED = new Set(['content-type', 'accept', 'accept-language', 'user-agent'])
  return Object.fromEntries(
    Object.entries(headers).filter(([k]) => ALLOWED.has(k.toLowerCase())),
  )
}
