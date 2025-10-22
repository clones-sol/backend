import { rmdir, unlink } from 'node:fs/promises'
import type { IUploadSessionDocument } from '../../models/UploadSession.ts'

export async function cleanupSession(
  session: Pick<IUploadSessionDocument, 'id' | 'tempDir' | 'receivedChunks'>
): Promise<void> {
  const startTime = Date.now()
  console.log(`[CLEANUP] Starting cleanup for session ${session.id} with ${session.receivedChunks.size} chunks (initiated at ${new Date().toISOString()})`)
  
  try {
    // Delete all chunk files with enhanced logging
    let deletedChunks = 0
    let skippedChunks = 0
    
    for (const chunk of session.receivedChunks.values()) {
      try {
        await unlink(chunk.path)
        deletedChunks++
        console.log(`[CLEANUP] Deleted chunk file: ${chunk.path} (index: ${chunk.chunkIndex})`)
      } catch (error) {
        skippedChunks++
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          console.log(`[CLEANUP] Chunk file already deleted: ${chunk.path} (index: ${chunk.chunkIndex})`)
        } else {
          console.error(`[CLEANUP] Error deleting chunk file ${chunk.path}:`, error)
        }
      }
    }
    
    console.log(`[CLEANUP] Chunk cleanup summary - Deleted: ${deletedChunks}, Skipped: ${skippedChunks}`)

    // Delete temp directory and its contents if it exists
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
