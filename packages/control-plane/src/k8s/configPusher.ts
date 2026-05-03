import fs from 'fs'
import path from 'path'
import { Project, Route } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { provisioner } from './provisioner'
import { logger } from '../lib/logger'

const K8S_ENABLED = process.env.K8S_ENABLED === 'true'
// When K8S is disabled, write gateway config to this local path so a
// locally-running gateway container can hot-reload it via chokidar.
const LOCAL_GATEWAY_CONFIG_PATH =
  process.env.LOCAL_GATEWAY_CONFIG_PATH ?? '/gateway-config/config.json'

interface GatewayRouteConfig {
  id: string
  path: string
  method: string
  public: boolean
  authConfig: unknown
  rateLimitConfig: unknown
  orchestrationFlow: unknown
}

class ConfigPusher {
  async push(project: Project): Promise<void> {
    if (project.status !== 'ACTIVE') {
      logger.warn({ projectId: project.id }, 'Skipping config push: project not active')
      return
    }

    const routes = await prisma.route.findMany({
      where: { projectId: project.id, enabled: true },
    })

    const config = {
      projectId: project.id,
      authRequired: project.authRequired,
      projectParams: (project as unknown as { params?: unknown }).params ?? null,
      routes: routes.map((r) => this.mapRoute(r, project.ingressPrefix)),
    }

    if (!K8S_ENABLED) {
      const configJson = JSON.stringify(config)
      try {
        await fs.promises.mkdir(path.dirname(LOCAL_GATEWAY_CONFIG_PATH), { recursive: true })
        await fs.promises.writeFile(LOCAL_GATEWAY_CONFIG_PATH, configJson, 'utf8')
        logger.info(
          { projectId: project.id, routeCount: routes.length, path: LOCAL_GATEWAY_CONFIG_PATH },
          'K8s disabled — wrote gateway config to local file',
        )
      } catch (err) {
        logger.error({ err, path: LOCAL_GATEWAY_CONFIG_PATH }, 'Failed to write local gateway config')
      }
      return
    }

    const configJson = JSON.stringify(config)
    await provisioner.patchConfigMap(project.k8sNamespace, configJson)
    logger.info({ projectId: project.id, routeCount: routes.length }, 'Config pushed to K8s')
  }

  private mapRoute(route: Route, ingressPrefix: string): GatewayRouteConfig {
    // Combine project ingressPrefix with route path so the local shared gateway
    // registers the full public path (e.g. /api/wooapp + /products = /api/wooapp/products).
    const fullPath = ingressPrefix.replace(/\/$/, '') + '/' + route.path.replace(/^\//, '')
    return {
      id: route.id,
      path: fullPath,
      method: route.method,
      public: route.public,
      authConfig: route.authConfig,
      rateLimitConfig: route.rateLimitConfig,
      orchestrationFlow: route.orchestrationFlow,
    }
  }
}

export const configPusher = new ConfigPusher()
