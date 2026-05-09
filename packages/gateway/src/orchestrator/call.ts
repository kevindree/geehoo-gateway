import axios, { AxiosRequestConfig } from 'axios'
import { XMLBuilder, XMLParser } from 'fast-xml-parser'
import { logger } from '../lib/logger'

export type UpstreamAuthType = 'none' | 'bearer' | 'basic' | 'apikey_header' | 'apikey_query'

export interface UpstreamAuth {
  type: UpstreamAuthType
  // bearer
  token?: string
  // basic
  username?: string
  password?: string
  // apikey_header / apikey_query
  headerName?: string
  paramName?: string
  key?: string
}

export interface UpstreamCallConfig {
  upstreamId: string
  type: 'REST' | 'GRAPHQL' | 'SOAP'
  url: string
  method: string
  headers?: Record<string, string>
  body?: unknown
  params?: Record<string, unknown>  // Appended as URL query parameters (for GET/HEAD/DELETE)
  timeout?: number
  upstreamAuth?: UpstreamAuth
  // For SOAP: action header
  soapAction?: string
  // For GraphQL: query + variables
  graphqlQuery?: string
  graphqlVariables?: Record<string, unknown>
}

export interface UpstreamCallResult {
  status: number
  data: unknown
  headers: Record<string, string>
}

export class UpstreamCallError extends Error {
  public readonly code = 'UPSTREAM_ERROR'
  constructor(
    public readonly upstreamId: string,
    public readonly statusCode: number,
    message: string,
    public readonly upstreamData?: unknown,
  ) {
    super(message)
    this.name = 'UpstreamCallError'
  }
}

/** Thrown when the network call itself fails (timeout, ECONNREFUSED, DNS failure, etc.) */
export class UpstreamNetworkError extends Error {
  constructor(
    public readonly upstreamId: string,
    public readonly statusCode: 503 | 504,
    message: string,
  ) {
    super(message)
    this.name = 'UpstreamNetworkError'
  }
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
const xmlBuilder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_' })

export async function callUpstream(config: UpstreamCallConfig): Promise<UpstreamCallResult> {
  const timeout = config.timeout ?? 10000

  // For bodyless methods, merge params into URL as query string
  let resolvedUrl = config.url
  if (config.params && Object.keys(config.params).length > 0) {
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(config.params).map(([k, v]) => [k, String(v)])
      )
    ).toString()
    resolvedUrl = config.url.includes('?')
      ? `${config.url}&${qs}`
      : `${config.url}?${qs}`
  }

  let requestConfig: AxiosRequestConfig = {
    url: resolvedUrl,
    method: config.method,
    timeout,
    headers: { ...config.headers },
    // Never follow redirects to external systems automatically
    maxRedirects: 0,
    validateStatus: () => true, // Handle status ourselves
  }

  // Apply upstream auth before building request-type-specific config
  if (config.upstreamAuth && config.upstreamAuth.type !== 'none') {
    requestConfig = applyUpstreamAuth(requestConfig, config.upstreamAuth)
  }

  if (config.type === 'SOAP') {
    requestConfig = buildSoapRequest(requestConfig, config)
  } else if (config.type === 'GRAPHQL') {
    requestConfig = buildGraphqlRequest(requestConfig, config)
  } else {
    // REST
    if (config.body !== undefined) {
      requestConfig.data = config.body
      requestConfig.headers = {
        'Content-Type': 'application/json',
        ...requestConfig.headers,
      }
    }
  }

  logger.debug(
    {
      upstreamId: config.upstreamId,
      type: config.type,
      url: resolvedUrl,
      method: requestConfig.method,
      headers: sanitizeHeaders(requestConfig.headers as Record<string, unknown> | undefined),
      body: requestConfig.data,
    },
    'Upstream request',
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let response: import('axios').AxiosResponse<any>
  const startedAt = Date.now()
  try {
    response = await axios(requestConfig)
  } catch (err) {
    const axiosCode = (err as { code?: string }).code
    const label = config.upstreamId ?? 'upstream'
    if (axiosCode === 'ECONNABORTED' || axiosCode === 'ETIMEDOUT') {
      logger.warn({ upstreamId: label, url: config.url, axiosCode }, 'Upstream request timed out')
      throw new UpstreamNetworkError(label, 504, 'Upstream request timed out')
    }
    logger.warn({ upstreamId: label, url: config.url, axiosCode }, 'Upstream connection failed')
    throw new UpstreamNetworkError(label, 503, 'Upstream service unavailable')
  }

  logger.debug(
    {
      upstreamId: config.upstreamId,
      url: resolvedUrl,
      status: response.status,
      durationMs: Date.now() - startedAt,
      headers: sanitizeHeaders(response.headers as unknown as Record<string, unknown> | undefined),
      body: response.data,
    },
    'Upstream response',
  )

  if (response.status >= 400) {
    const label = config.upstreamId ?? 'upstream'
    throw new UpstreamCallError(
      label,
      response.status,
      `Upstream call failed with status ${response.status}`,
      // Pass through upstream response data for 4xx (business errors) so callers get useful details
      response.status < 500 ? response.data : undefined,
    )
  }

  let data = response.data
  // Parse XML response for SOAP
  if (config.type === 'SOAP' && typeof data === 'string') {
    data = xmlParser.parse(data)
  }

  return {
    status: response.status,
    // Only return safe headers, not all upstream headers
    headers: {
      'content-type': String(response.headers['content-type'] ?? 'application/json'),
    },
    data,
  }
}

function buildSoapRequest(
  base: AxiosRequestConfig,
  config: UpstreamCallConfig,
): AxiosRequestConfig {
  const envelope = {
    'soap:Envelope': {
      '@_xmlns:soap': 'http://schemas.xmlsoap.org/soap/envelope/',
      'soap:Body': config.body ?? {},
    },
  }
  return {
    ...base,
    method: 'POST',
    data: xmlBuilder.build(envelope),
    headers: {
      ...base.headers,
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: config.soapAction ?? '',
    },
  }
}

function buildGraphqlRequest(
  base: AxiosRequestConfig,
  config: UpstreamCallConfig,
): AxiosRequestConfig {
  return {
    ...base,
    method: 'POST',
    data: {
      query: config.graphqlQuery,
      variables: config.graphqlVariables ?? {},
    },
    headers: {
      ...base.headers,
      'Content-Type': 'application/json',
    },
  }
}

// Resolve a value that may be an env-var reference ($VAR_NAME)
function resolveSecret(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (value.startsWith('$')) return process.env[value.slice(1)] ?? ''
  return value
}

function applyUpstreamAuth(base: AxiosRequestConfig, auth: UpstreamAuth): AxiosRequestConfig {
  const headers: Record<string, string> = { ...(base.headers as Record<string, string>) }
  let url = base.url as string

  switch (auth.type) {
    case 'bearer': {
      const token = resolveSecret(auth.token)
      if (token) headers['Authorization'] = `Bearer ${token}`
      break
    }
    case 'basic': {
      const user = resolveSecret(auth.username) ?? ''
      const pass = resolveSecret(auth.password) ?? ''
      headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
      break
    }
    case 'apikey_header': {
      const key = resolveSecret(auth.key)
      if (auth.headerName && key) headers[auth.headerName] = key
      break
    }
    case 'apikey_query': {
      const key = resolveSecret(auth.key)
      if (auth.paramName && key) {
        const u = new URL(url)
        u.searchParams.set(auth.paramName, key)
        url = u.toString()
      }
      break
    }
  }

  return { ...base, url, headers }
}

const REDACTED_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
])

function sanitizeHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!headers) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = REDACTED_HEADER_NAMES.has(k.toLowerCase()) ? '[REDACTED]' : v
  }
  return out
}
