import 'dotenv/config'
import { logger } from './logger.js'
import { Redis, type Redis as RedisClient } from 'ioredis'

let redisPublisher: RedisClient
let redisSubscriber: RedisClient

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

const connectToRedis = () => {
  // Skip Redis connection in test environment without REDIS_URL
  if (process.env.NODE_ENV === 'test' && !process.env.REDIS_URL) {
    logger.info('[Redis] Skipping Redis connection in test environment')
    return
  }

  // It is recommended to use two separate connections for publishing and subscribing.
  // The subscriber connection can only perform subscription-related commands.
  if (!redisPublisher) {
    redisPublisher = new Redis(redisUrl, { 
      maxRetriesPerRequest: 3,
      lazyConnect: true
    })
    redisPublisher.on('connect', () => {
      logger.info('[Redis] Publisher connected.')
    })
    redisPublisher.on('error', (err: Error) => {
      logger.error('[Redis] Publisher connection error:', err)
    })
  }

  if (!redisSubscriber) {
    redisSubscriber = new Redis(redisUrl, { 
      maxRetriesPerRequest: 3,
      lazyConnect: true
    })
    redisSubscriber.on('connect', () => {
      logger.info('[Redis] Subscriber connected.')
    })
    redisSubscriber.on('error', (err: Error) => {
      logger.error('[Redis] Subscriber connection error:', err)
    })
  }
}

const disconnectFromRedis = () => {
  if (redisPublisher) {
    redisPublisher.quit()
  }
  if (redisSubscriber) {
    redisSubscriber.quit()
  }
}

export { connectToRedis, disconnectFromRedis, redisPublisher, redisSubscriber }
