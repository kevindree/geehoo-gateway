import chokidar from 'chokidar'
import { Application } from 'express'
import { registerRoutes } from './register'
import { logger } from '../lib/logger'

export function watchConfig(app: Application, configPath: string): void {
  const watcher = chokidar.watch(configPath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  })

  const reload = async (event: string) => {
    logger.info({ configPath, event }, 'Config file updated — reloading routes')
    try {
      await registerRoutes(app, configPath)
    } catch (err) {
      logger.error({ err }, 'Failed to reload routes after config change')
    }
  }

  watcher.on('change', () => reload('change'))
  watcher.on('add', () => reload('add'))

  watcher.on('error', (err) => {
    logger.error({ err }, 'Config watcher error')
  })

  logger.info({ configPath }, 'Watching config file for changes')
}
