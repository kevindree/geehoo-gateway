import 'dotenv/config'
import express from 'express'
import { pinoHttp } from 'pino-http'
import { logger } from './lib/logger'
import { adminRouter } from './routes/admin'
import { authRouter } from './routes/auth'
import { internalRouter } from './routes/internal'
import { errorHandler } from './middleware/errorHandler'
import { prisma } from './lib/prisma'
import { configPusher } from './k8s/configPusher'

const app = express()
const PORT = parseInt(process.env.PORT ?? '4000', 10)

app.use(express.json())
app.use(pinoHttp({ logger }))

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// Routes
app.use('/api/auth', authRouter)
app.use('/api/admin', adminRouter)
app.use('/internal', internalRouter)

// 404
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } })
})

// Error handler (must be last)
app.use(errorHandler)

app.listen(PORT, async () => {
  logger.info({ port: PORT }, 'Control plane started')

  // Push gateway config for all active projects so the local gateway
  // always has an up-to-date config.json on startup.
  try {
    const activeProjects = await prisma.project.findMany({ where: { status: 'ACTIVE' } })
    await Promise.all(activeProjects.map((p) => configPusher.push(p)))
    if (activeProjects.length > 0) {
      logger.info({ count: activeProjects.length }, 'Pushed gateway config for active projects on startup')
    }
  } catch (err) {
    logger.error({ err }, 'Failed to push gateway config on startup')
  }
})

export { app }
