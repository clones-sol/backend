import { logger } from "../services/logger.ts"
const catchErrors = () => {
  process.on('uncaughtException', async (err) => {
    logger.info(`Caught exception at ${new Date()}: ${err}`)
    logger.info('Stack trace:', err.stack)
  })
}

export { catchErrors }
