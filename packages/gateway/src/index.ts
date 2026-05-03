import 'dotenv/config'
import dns from 'dns'
import net from 'net'
// Prefer IPv4 — containers may lack IPv6 routing, causing ETIMEDOUT via Happy Eyeballs
dns.setDefaultResultOrder('ipv4first')
net.setDefaultAutoSelectFamily(false)
import express from 'express'
import { pinoHttp } from 'pino-http'
import { logger } from './lib/logger'
import { registerRoutes } from './routes/register'
import { watchConfig } from './routes/watcher'
import { errorHandler } from './middleware/errorHandler'

const app = express()
const PORT = parseInt(process.env.PORT ?? '3000', 10)

app.use(express.json())
app.use(express.text({ type: ['text/xml', 'application/xml', 'application/soap+xml'] }))
app.use(pinoHttp({ logger }))

// Health check (always public, no auth)
app.get('/health', (_req, res) => res.json({ status: 'ok', projectId: process.env.GATEWAY_PROJECT_ID }))

// Dynamic routes are registered after config load
const CONFIG_PATH = process.env.GATEWAY_CONFIG_PATH ?? '/etc/gateway/config.json'

async function start(): Promise<void> {
  try {
    // Initial route registration
    await registerRoutes(app, CONFIG_PATH)

    // Watch for config file changes (ConfigMap hot reload)
    watchConfig(app, CONFIG_PATH)

    // Error handler must be last
    app.use(errorHandler)

    app.listen(PORT, () => {
      logger.info({ port: PORT, projectId: process.env.GATEWAY_PROJECT_ID }, 'Gateway started')
    })
  } catch (err) {
    logger.error({ err }, 'Failed to start gateway')
    process.exit(1)
  }
}

start()

export { app }
