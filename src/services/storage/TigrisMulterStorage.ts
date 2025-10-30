import { Request } from 'express'
import { ObjectStorageService } from './index.ts'
import { logger } from "../logger.ts"

/**
 * Custom Multer storage engine for Tigris
 * Stores chunks directly in Tigris bucket under chunks/{sessionId}/
 */
export class TigrisMulterStorage {
  private objectStorage: ObjectStorageService

  constructor(objectStorage: ObjectStorageService) {
    this.objectStorage = objectStorage
  }

  _handleFile(
    req: Request & { uploadSession?: { id: string } },
    file: Express.Multer.File,
    callback: (error?: any, info?: Express.Multer.File) => void
  ): void {
    const sessionId = req.uploadSession?.id || req.params.uploadId
    const chunkIndex = req.body.chunkIndex

    if (!sessionId) {
      return callback(new Error('Session ID not found'))
    }

    if (chunkIndex === undefined) {
      return callback(new Error('Chunk index not found'))
    }

    // Generate Tigris path: chunks/{sessionId}/chunk_{index}
    const tigrisPath = `chunks/${sessionId}/chunk_${chunkIndex}`

    // Collect file data
    const chunks: Buffer[] = []

    file.stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    file.stream.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks)

        // Upload to Tigris
        await this.objectStorage.saveItem({
          name: tigrisPath,
          file: buffer
        })

        logger.info(`[TIGRIS-UPLOAD] Chunk ${chunkIndex} uploaded to ${tigrisPath} (${buffer.length} bytes)`)

        // Return file info similar to disk storage
        callback(null, {
          fieldname: file.fieldname,
          originalname: file.originalname,
          encoding: file.encoding,
          mimetype: file.mimetype,
          size: buffer.length,
          destination: `chunks/${sessionId}`,
          filename: `chunk_${chunkIndex}`,
          path: tigrisPath, // Tigris path instead of filesystem path
          stream: file.stream,
          buffer
        } as Express.Multer.File)
      } catch (error) {
        logger.error(`[TIGRIS-UPLOAD] Error uploading chunk ${chunkIndex}:`, error)
        callback(error)
      }
    })

    file.stream.on('error', (error) => {
      logger.error(`[TIGRIS-UPLOAD] Stream error for chunk ${chunkIndex}:`, error)
      callback(error)
    })
  }

  _removeFile(
    _req: Request,
    _file: Express.Multer.File,
    callback: (error: Error | null) => void
  ): void {
    // For cleanup - could implement Tigris deletion here if needed
    // For now, we'll handle cleanup in the main cleanup function
    callback(null)
  }
}

/**
 * Factory function to create Tigris storage engine for multer
 */
export function createTigrisStorage(objectStorage: ObjectStorageService) {
  return new TigrisMulterStorage(objectStorage)
}