import { rmdir, unlink } from 'fs/promises';
import { IUploadSessionDocument } from '../../models/UploadSession.ts';

export async function cleanupSession(
  session: Pick<IUploadSessionDocument, 'id' | 'tempDir' | 'receivedChunks'>
): Promise<void> {
  try {
    // Delete all chunk files
    for (const chunk of session.receivedChunks.values()) {
      await unlink(chunk.path).catch(() => {
        // Ignore errors if file doesn't exist
      });
    }

    // Delete temp directory and its contents if it exists
    if (session.tempDir) {
      await rmdir(session.tempDir, { recursive: true }).catch(() => {
        // Ignore errors if directory doesn't exist
      });
    }
  } catch (error) {
    console.error(`Error cleaning up session ${session.id}:`, error);
  }
}
