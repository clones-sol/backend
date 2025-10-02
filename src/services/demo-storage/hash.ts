import crypto from 'crypto'

/**
 * Generate a deterministic SHA-256 hash for a demonstration session
 */
export function generateDemoHash(submissionId: string, userAddress: string, timestamp?: number): string {
  const ts = timestamp || Date.now()
  const input = `${submissionId}:${userAddress.toLowerCase()}:${ts}`
  return crypto.createHash('sha256').update(input).digest('hex')
}

/**
 * Calculate SHA-256 hash of a file buffer
 */
export function calculateFileHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/**
 * Generate overall integrity hash from file hashes
 */
export function calculateOverallHash(fileHashes: string[]): string {
  const sortedHashes = fileHashes.slice().sort()
  const input = sortedHashes.join(':')
  return crypto.createHash('sha256').update(input).digest('hex')
}

/**
 * Generate storage path for a demo file
 */
export function getDemoStoragePath(demoHash: string, filename: string, version = 'v1'): string {
  return `datasets/computer-use-${version}/demonstrations/${demoHash}/${filename}`
}

/**
 * Extract demo hash from storage path
 */
export function extractDemoHashFromPath(path: string): string | null {
  const match = path.match(/demonstrations\/([a-f0-9]{64})\//)
  return match ? match[1] : null
}