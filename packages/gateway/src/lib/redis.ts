import IORedis from 'ioredis'
import { logger } from './logger'

const redisUrl = process.env.GATEWAY_REDIS_URL ?? 'redis://localhost:6379'

export const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
})

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error')
})
