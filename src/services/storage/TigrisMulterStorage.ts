import { Request } from 'express'
import { ObjectStorageService } from './index.ts'

interface TigrisFile {
  fieldname: string
  originalname: string
  encoding: string
  mimetype: string
  size: number
  destination: string
  filename: string
  path: string
  buffer: Buffer
}

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
    callback: (error?: any, info?: Partial<TigrisFile>) => void
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
        
        console.log(`[TIGRIS-UPLOAD] Chunk ${chunkIndex} uploaded to ${tigrisPath} (${buffer.length} bytes)`)
        
        // Return file info similar to disk storage
        callback(null, {
          fieldname: file.fieldname,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: buffer.length,
          destination: `chunks/${sessionId}`,
          filename: `chunk_${chunkIndex}`,
          path: tigrisPath, // Tigris path instead of filesystem path
          buffer
        })
      } catch (error) {
        console.error(`[TIGRIS-UPLOAD] Error uploading chunk ${chunkIndex}:`, error)
        callback(error)
      }
    })
    
    file.stream.on('error', (error) => {
      console.error(`[TIGRIS-UPLOAD] Stream error for chunk ${chunkIndex}:`, error)
      callback(error)
    })
  }

  _removeFile(
    _req: Request,
    _file: TigrisFile,
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