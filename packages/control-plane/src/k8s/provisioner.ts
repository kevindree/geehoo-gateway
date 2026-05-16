import * as k8s from '@kubernetes/client-node'
import { Project } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import { logger } from '../lib/logger'

const GATEWAY_IMAGE = process.env.GATEWAY_IMAGE ?? 'geehoo-gateway/gateway:latest'
const K8S_ENABLED = process.env.K8S_ENABLED === 'true'

class Provisioner {
  private kc: k8s.KubeConfig
  private coreApi: k8s.CoreV1Api
  private appsApi: k8s.AppsV1Api
  private networkingApi: k8s.NetworkingV1Api
  private autoscalingApi: k8s.AutoscalingV2Api

  constructor() {
    this.kc = new k8s.KubeConfig()
    this.kc.loadFromDefault()
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api)
    this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api)
    this.networkingApi = this.kc.makeApiClient(k8s.NetworkingV1Api)
    this.autoscalingApi = this.kc.makeApiClient(k8s.AutoscalingV2Api)
  }

  async provision(project: Project): Promise<void> {
    const ns = project.k8sNamespace
    logger.info({ projectId: project.id, namespace: ns }, 'Provisioning K8s resources')

    if (!K8S_ENABLED) {
      logger.info({ projectId: project.id }, 'K8s disabled, skipping provisioning')
      await prisma.project.update({
        where: { id: project.id },
        data: { status: 'ACTIVE' },
      })
      return
    }

    try {
      await this.createNamespace(ns)
      await this.createRedis(ns)
      await this.createConfigMap(ns, project.id, [])
      await this.createGatewayDeployment(ns, project)
      await this.createService(ns)
      await this.createIngress(ns, project)
      await this.createHPA(ns)

      await prisma.project.update({
        where: { id: project.id },
        data: { status: 'ACTIVE' },
      })
      logger.info({ projectId: project.id }, 'K8s provisioning complete')
    } catch (err) {
      logger.error({ err, projectId: project.id }, 'K8s provisioning failed')
      await prisma.project.update({
        where: { id: project.id },
        data: { status: 'ERROR' },
      })
      throw err
    }
  }

  async deprovision(project: Project): Promise<void> {
    const ns = project.k8sNamespace
    logger.info({ projectId: project.id, namespace: ns }, 'Deprovisioning K8s resources')

    if (!K8S_ENABLED) {
      logger.info({ projectId: project.id }, 'K8s disabled, skipping deprovisioning')
      await prisma.project.delete({ where: { id: project.id } })
      return
    }

    try {
      await this.coreApi.deleteNamespace({ name: ns })
      await prisma.project.delete({ where: { id: project.id } })
      logger.info({ projectId: project.id }, 'K8s deprovisioning complete')
    } catch (err) {
      logger.error({ err, projectId: project.id }, 'K8s deprovisioning failed')
      throw err
    }
  }

  async patchConfigMap(namespace: string, configJson: string): Promise<void> {
    await this.coreApi.patchNamespacedConfigMap({
      name: 'gateway-config',
      namespace,
      body: {
        data: { 'config.json': configJson },
      },
    })
  }

  private async createNamespace(name: string): Promise<void> {
    try {
      await this.coreApi.createNamespace({
        body: {
          metadata: { name, labels: { 'managed-by': 'geehoo-gateway' } },
        },
      })
    } catch (err: unknown) {
      // Ignore AlreadyExists
      if ((err as { statusCode?: number }).statusCode !== 409) throw err
    }
  }

  private async createConfigMap(
    namespace: string,
    projectId: string,
    routes: unknown[],
  ): Promise<void> {
    const configJson = JSON.stringify({ projectId, routes })
    try {
      await this.coreApi.createNamespacedConfigMap({
        namespace,
        body: {
          metadata: { name: 'gateway-config', namespace },
          data: { 'config.json': configJson },
        },
      })
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode !== 409) throw err
    }
  }

  private async createGatewayDeployment(namespace: string, project: Project): Promise<void> {
    const deployment: k8s.V1Deployment = {
      metadata: { name: 'gateway', namespace },
      spec: {
        replicas: 2,
        selector: { matchLabels: { app: 'gateway' } },
        template: {
          metadata: { labels: { app: 'gateway' } },
          spec: {
            securityContext: { runAsNonRoot: true, runAsUser: 1000 },
            containers: [
              {
                name: 'gateway',
                image: GATEWAY_IMAGE,
                ports: [{ containerPort: 3000 }],
                env: [
                  { name: 'GATEWAY_PROJECT_ID', value: project.id },
                  { name: 'GATEWAY_CONFIG_PATH', value: '/etc/gateway/config.json' },
                  { name: 'GATEWAY_REDIS_URL', value: 'redis://redis:6379' },
                  {
                    name: 'GATEWAY_JWT_SECRET',
                    valueFrom: {
                      secretKeyRef: { name: 'gateway-secrets', key: 'jwt-secret' },
                    },
                  },
                  {
                    name: 'INTERNAL_SERVICE_SECRET',
                    valueFrom: {
                      secretKeyRef: { name: 'gateway-secrets', key: 'internal-service-secret' },
                    },
                  },
                  {
                    name: 'CONTROL_PLANE_INTERNAL_URL',
                    value: 'http://control-plane.control-plane.svc.cluster.local:4000',
                  },
                ],
                volumeMounts: [{ name: 'config', mountPath: '/etc/gateway', readOnly: true }],
                resources: {
                  requests: { cpu: '100m', memory: '128Mi' },
                  limits: { cpu: '500m', memory: '512Mi' },
                },
                readinessProbe: {
                  httpGet: { path: '/health', port: 3000 },
                  initialDelaySeconds: 5,
                  periodSeconds: 10,
                },
                livenessProbe: {
                  httpGet: { path: '/health', port: 3000 },
                  initialDelaySeconds: 15,
                  periodSeconds: 20,
                },
              },
            ],
            volumes: [
              {
                name: 'config',
                configMap: { name: 'gateway-config' },
              },
            ],
          },
        },
      },
    }

    // Create JWT + internal secret
    try {
      await this.coreApi.createNamespacedSecret({
        namespace,
        body: {
          metadata: { name: 'gateway-secrets', namespace },
          stringData: {
            'jwt-secret': env.GATEWAY_JWT_SECRET,
            'internal-service-secret': env.INTERNAL_SERVICE_SECRET,
          },
        },
      })
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode !== 409) throw err
    }

    try {
      await this.appsApi.createNamespacedDeployment({ namespace, body: deployment })
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode !== 409) throw err
    }
  }

  private async createService(namespace: string): Promise<void> {
    try {
      await this.coreApi.createNamespacedService({
        namespace,
        body: {
          metadata: { name: 'gateway', namespace },
          spec: {
            selector: { app: 'gateway' },
            ports: [{ port: 80, targetPort: 3000 }],
          },
        },
      })
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode !== 409) throw err
    }
  }

  private async createIngress(namespace: string, project: Project): Promise<void> {
    const pathPrefix = project.ingressPrefix
    try {
      await this.networkingApi.createNamespacedIngress({
        namespace,
        body: {
          metadata: {
            name: 'gateway',
            namespace,
            annotations: { 'nginx.ingress.kubernetes.io/rewrite-target': '/$2' },
          },
          spec: {
            rules: [
              {
                http: {
                  paths: [
                    {
                      path: `${pathPrefix}(/|$)(.*)`,
                      pathType: 'Prefix',
                      backend: {
                        service: { name: 'gateway', port: { number: 80 } },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      })
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode !== 409) throw err
    }
  }

  private async createRedis(namespace: string): Promise<void> {
    try {
      await this.appsApi.createNamespacedDeployment({
        namespace,
        body: {
          metadata: { name: 'redis', namespace },
          spec: {
            replicas: 1,
            selector: { matchLabels: { app: 'redis' } },
            template: {
              metadata: { labels: { app: 'redis' } },
              spec: {
                containers: [
                  {
                    name: 'redis',
                    image: 'redis:7-alpine',
                    ports: [{ containerPort: 6379 }],
                    resources: {
                      requests: { cpu: '50m', memory: '64Mi' },
                      limits: { cpu: '200m', memory: '256Mi' },
                    },
                  },
                ],
              },
            },
          },
        },
      })
      await this.coreApi.createNamespacedService({
        namespace,
        body: {
          metadata: { name: 'redis', namespace },
          spec: {
            selector: { app: 'redis' },
            ports: [{ port: 6379, targetPort: 6379 }],
          },
        },
      })
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode !== 409) throw err
    }
  }

  private async createHPA(namespace: string): Promise<void> {
    try {
      await this.autoscalingApi.createNamespacedHorizontalPodAutoscaler({
        namespace,
        body: {
          metadata: { name: 'gateway', namespace },
          spec: {
            scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'gateway' },
            minReplicas: 2,
            maxReplicas: 10,
            metrics: [
              {
                type: 'Resource',
                resource: {
                  name: 'cpu',
                  target: { type: 'Utilization', averageUtilization: 70 },
                },
              },
            ],
          },
        },
      })
    } catch (err: unknown) {
      if ((err as { statusCode?: number }).statusCode !== 409) throw err
    }
  }
}

export const provisioner = new Provisioner()
