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
    // Set exit code to 1 for graceful shutdown in case of database connection error
    process.exitCode = 1
  }
}
