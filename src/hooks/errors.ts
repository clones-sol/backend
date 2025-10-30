import { logger } from "../services/logger.ts"
const catchErrors = () => {
  process.on('uncaughtException', async (err) => {
    logger.error(`Caught exception at ${new Date()}: ${err}`)
    logger.error('Stack trace:', err.stack)
  })
}

export { catchErrors }
