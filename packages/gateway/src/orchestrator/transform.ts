import jmespath from 'jmespath'
import Handlebars from 'handlebars'
import { getQuickJS, QuickJSWASMModule } from 'quickjs-emscripten'
import { logger } from '../lib/logger'

// Cache the QuickJS WASM module so we don't pay the init cost on every call.
let quickJsPromise: Promise<QuickJSWASMModule> | null = null
function loadQuickJs(): Promise<QuickJSWASMModule> {
  if (!quickJsPromise) quickJsPromise = getQuickJS()
  return quickJsPromise
}

// Cache compiled Handlebars templates keyed by template source.
const templateCache = new Map<string, HandlebarsTemplateDelegate>()
const TEMPLATE_CACHE_MAX = 500
function getCompiledTemplate(source: string): HandlebarsTemplateDelegate {
  const cached = templateCache.get(source)
  if (cached) return cached
  const compiled = Handlebars.compile(source)
  if (templateCache.size >= TEMPLATE_CACHE_MAX) {
    // Evict the oldest entry (Map preserves insertion order)
    const firstKey = templateCache.keys().next().value
    if (firstKey !== undefined) templateCache.delete(firstKey)
  }
  templateCache.set(source, compiled)
  return compiled
}

export interface TransformConfig {
  type: 'field_mapping' | 'jmespath' | 'template' | 'sandbox_js'
  // field_mapping: { from: "$.a.b", to: "$.x.y" }[]
  mappings?: Array<{ from: string; to: string }>
  // jmespath: expression string
  expression?: string
  // template: Handlebars template string
  template?: string
  // sandbox_js: JS code returning transformed value
  script?: string
}

/**
 * Apply a transform to input data, returning the transformed output.
 * The context object provides additional variables available in templates/scripts.
 */
export async function applyTransform(
  config: TransformConfig,
  input: unknown,
  context: Record<string, unknown> = {},
): Promise<unknown> {
  switch (config.type) {
    case 'field_mapping':
      return applyFieldMapping(config, input)
    case 'jmespath':
      return applyJmesPath(config, input)
    case 'template':
      return applyTemplate(config, input, context)
    case 'sandbox_js':
      return applySandboxJs(config, input, context)
    default:
      return input
  }
}

function applyFieldMapping(config: TransformConfig, input: unknown): unknown {
  if (!config.mappings || !Array.isArray(input) && typeof input !== 'object') return input

  const result: Record<string, unknown> = {}
  for (const mapping of config.mappings) {
    const value = getNestedValue(input, mapping.from)
    setNestedValue(result, mapping.to, value)
  }
  return result
}

function applyJmesPath(config: TransformConfig, input: unknown): unknown {
  if (!config.expression) return input
  try {
    return jmespath.search(input, config.expression)
  } catch (err) {
    logger.warn({ err, expression: config.expression }, 'JMESPath evaluation failed')
    return null
  }
}

function applyTemplate(
  config: TransformConfig,
  input: unknown,
  context: Record<string, unknown>,
): unknown {
  if (!config.template) return input
  try {
    const compiled = getCompiledTemplate(config.template)
    const rendered = compiled({ data: input, ...context })
    try {
      return JSON.parse(rendered)
    } catch {
      return rendered
    }
  } catch (err) {
    logger.warn({ err }, 'Handlebars template evaluation failed')
    return input
  }
}

async function applySandboxJs(
  config: TransformConfig,
  input: unknown,
  context: Record<string, unknown>,
): Promise<unknown> {
  if (!config.script) return input

  const QuickJS = await loadQuickJs()
  const vm = QuickJS.newContext()

  try {
    // Inject input and context as JSON (safe, no references to host objects)
    const inputHandle = vm.evalCode(`(${JSON.stringify(input)})`)
    if (inputHandle.error) {
      inputHandle.error.dispose()
      return input
    }
    vm.setProp(vm.global, 'input', inputHandle.value)
    inputHandle.value.dispose()

    const ctxHandle = vm.evalCode(`(${JSON.stringify(context)})`)
    if (ctxHandle.error) {
      ctxHandle.error.dispose()
    } else {
      vm.setProp(vm.global, 'context', ctxHandle.value)
      ctxHandle.value.dispose()
    }

    // Wrap script in a function and call with timeout enforcement via interrupt
    const startTime = Date.now()
    vm.runtime.setInterruptHandler(() => {
      // Interrupt after 100ms CPU time
      return Date.now() - startTime > 100
    })

    const result = vm.evalCode(`(function(){ ${config.script} })()`)
    if (result.error) {
      const errMsg = vm.dump(result.error)
      result.error.dispose()
      logger.warn({ errMsg }, 'Sandbox JS execution error')
      return null
    }

    const output = vm.dump(result.value)
    result.value.dispose()
    return output
  } finally {
    vm.dispose()
  }
}

// Simple dot-notation path helpers
function getNestedValue(obj: unknown, path: string): unknown {
  // Remove leading $. if present
  const cleanPath = path.replace(/^\$\.?/, '')
  if (!cleanPath) return obj
  return cleanPath.split('.').reduce((acc, key) => {
    if (acc !== null && acc !== undefined && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const cleanPath = path.replace(/^\$\.?/, '')
  const keys = cleanPath.split('.')
  let current: Record<string, unknown> = obj
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current)) current[keys[i]] = {}
    current = current[keys[i]] as Record<string, unknown>
  }
  current[keys[keys.length - 1]] = value
}
