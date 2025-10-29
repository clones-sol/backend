import { rmdir } from 'node:fs/promises'
import type { IUploadSessionDocument } from '../../models/UploadSession.ts'
import { ObjectStorageService } from '../storage/index.ts'

function validateStorageConfig() {
  const {
    STORAGE_ACCESS_KEY,
    STORAGE_SECRET_KEY,
    STORAGE_ENDPOINT,
    STORAGE_REGION,
    STORAGE_BUCKET
  } = process.env

  const missingVariables = []
  if (!STORAGE_ACCESS_KEY) missingVariables.push('STORAGE_ACCESS_KEY')
  if (!STORAGE_SECRET_KEY) missingVariables.push('STORAGE_SECRET_KEY')
  if (!STORAGE_ENDPOINT) missingVariables.push('STORAGE_ENDPOINT')
  if (!STORAGE_REGION) missingVariables.push('STORAGE_REGION')
  if (!STORAGE_BUCKET) missingVariables.push('STORAGE_BUCKET')

  if (missingVariables.length > 0) {
    throw new Error(
      `Storage service environment variables are not properly configured. Missing: ${missingVariables.join(', ')}`
    )
  }

  return {
    STORAGE_ACCESS_KEY: STORAGE_ACCESS_KEY as string,
    STORAGE_SECRET_KEY: STORAGE_SECRET_KEY as string,
    STORAGE_ENDPOINT: STORAGE_ENDPOINT as string,
    STORAGE_REGION: STORAGE_REGION as string,
    STORAGE_BUCKET: STORAGE_BUCKET as string
  }
}

export async function cleanupSession(
  session: Pick<IUploadSessionDocument, 'id' | 'tempDir' | 'receivedChunks'>
): Promise<void> {
  const startTime = Date.now()
  console.log(`[CLEANUP] Starting cleanup for session ${session.id} with ${session.receivedChunks.size} chunks (initiated at ${new Date().toISOString()})`)
  
  try {
    // Initialize Tigris storage for chunk cleanup
    const config = validateStorageConfig()
    const objectStorage = new ObjectStorageService(
      config.STORAGE_ACCESS_KEY,
      config.STORAGE_SECRET_KEY,
      config.STORAGE_ENDPOINT,
      config.STORAGE_REGION,
      config.STORAGE_BUCKET
    )

    // Delete all chunk files from Tigris with enhanced logging
    let deletedChunks = 0
    let skippedChunks = 0
    
    for (const chunk of session.receivedChunks.values()) {
      try {
        // For Tigris storage, chunk.path is the Tigris object key
        await objectStorage.deleteItem({ name: chunk.path })
        deletedChunks++
        console.log(`[CLEANUP] Deleted chunk from Tigris: ${chunk.path} (index: ${chunk.chunkIndex})`)
      } catch (error) {
        skippedChunks++
        if (error instanceof Error && error.message.includes('NoSuchKey')) {
          console.log(`[CLEANUP] Chunk already deleted from Tigris: ${chunk.path} (index: ${chunk.chunkIndex})`)
        } else {
          console.error(`[CLEANUP] Error deleting chunk from Tigris ${chunk.path}:`, error)
        }
      }
    }
    
    console.log(`[CLEANUP] Chunk cleanup summary - Deleted: ${deletedChunks}, Skipped: ${skippedChunks}`)

    // Delete temp directory and its contents if it exists (for backward compatibility)
    if (session.tempDir) {
      try {
        await rmdir(session.tempDir, { recursive: true })
        console.log(`[CLEANUP] Deleted temp directory: ${session.tempDir}`)
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          console.log(`[CLEANUP] Temp directory already deleted: ${session.tempDir}`)
        } else {
          console.error(`[CLEANUP] Error deleting temp directory ${session.tempDir}:`, error)
        }
      }
    }
    
    const duration = Date.now() - startTime
    console.log(`[CLEANUP] Session cleanup completed for ${session.id} in ${duration}ms`)
  } catch (error) {
    const duration = Date.now() - startTime
    console.error(`[CLEANUP] Error cleaning up session ${session.id} after ${duration}ms:`, error)
  }
}
