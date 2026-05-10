import 'dotenv/config'
import express from 'express'
import { pinoHttp } from 'pino-http'
import { logger } from './lib/logger'
import { authRouter } from './routes/auth'
import { workspacesRouter } from './routes/workspaces'
import { invitationsRouter, publicInvitationsRouter } from './routes/invitations'
import { projectsRouter } from './routes/projects'
import { usersRouter } from './routes/users'
import { endUsersRouter } from './routes/endUsers'
import { internalRouter } from './routes/internal'
import { requireUser } from './middleware/auth'
import { errorHandler } from './middleware/errorHandler'
import { prisma } from './lib/prisma'
import { configPusher } from './k8s/configPusher'

const app = express()
const PORT = parseInt(process.env.PORT ?? '4000', 10)

app.use(express.json())
app.use(pinoHttp({ logger }))

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// Public routes
app.use('/api/auth', authRouter)
app.use('/api/end-users', endUsersRouter)
app.use('/api/invitations', publicInvitationsRouter)

// Workspace tier (auth applied inside workspacesRouter)
app.use('/api/workspaces', workspacesRouter)
// Project tier — nested under workspace
app.use('/api/workspaces/:workspaceSlug/projects', requireUser, projectsRouter)
// Workspace invitations — nested
app.use('/api/workspaces/:workspaceSlug/invitations', requireUser, invitationsRouter)

// System admin
app.use('/api/admin/users', usersRouter)

// Internal (gateway → control-plane)
app.use('/internal', internalRouter)

// 404
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } })
})

app.use(errorHandler)

app.listen(PORT, async () => {
  logger.info({ port: PORT }, 'Control plane started')

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
