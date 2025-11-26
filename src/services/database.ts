import mongoose from 'mongoose'
import { logger } from './logger.js'

export const connectToDatabase = async () => {
  try {
    const dbURI = process.env.DB_URI
    if (!dbURI) {
      throw new Error('DB_URI environment variable is not set.')
    }

    await mongoose.connect(dbURI)

    await mongoose.connection.db?.admin().command({ ping: 1 })
    logger.info('Database connected!')
  } catch (err) {
    logger.error('Error connecting to MongoDB:', err)
    logger.error('FATAL: Cannot start backend without database connection. Exiting.')
    // Exit immediately - the application cannot function without database
    process.exit(1)
  }
}
