import * as path from 'path';
import { UploadSession } from '../../types/index.ts';
import { unlink, readdir } from 'fs/promises';

let uploadInterval: NodeJS.Timeout;
const CLEANUP_INTERVAL = 15 * 60 * 1000;

export function stopUploadInterval() {
  clearInterval(uploadInterval);
}

export function startUploadInterval(activeSessions: Map<string, UploadSession>, expiry: number) {
  uploadInterval = setInterval(async () => {
    console.log('[Upload Interval] Cleaning up expired sessions.');
    const now = new Date();
    const expiredSessions = [];

    // Find expired sessions
    for (const [id, session] of activeSessions.entries()) {
      if (now.getTime() - session.lastUpdated.getTime() > expiry) {
        expiredSessions.push(id);
      }
    }

    // Clean up expired sessions
    for (const id of expiredSessions) {
      const session = activeSessions.get(id);
      if (session) {
        console.log(`Cleaning up expired upload session ${id}`);
        await cleanupSession(session);
        activeSessions.delete(id);
      }
    }
  }, CLEANUP_INTERVAL);
}

export async function cleanupSession(session: UploadSession): Promise<void> {
  try {
    // Delete all chunk files
    for (const chunk of session.receivedChunks.values()) {
      await unlink(chunk.path).catch(() => {});
    }

    // Delete temp directory if it exists
    if (session.tempDir) {
      try {
        const files = await readdir(session.tempDir);
        for (const file of files) {
          await unlink(path.join(session.tempDir, file)).catch(() => {});
        }
        await unlink(session.tempDir).catch(() => {});
      } catch (error) {
        // Ignore errors if directory doesn't exist
      }
    }
  } catch (error) {
    console.error(`Error cleaning up session ${session.id}:`, error);
  }
}
