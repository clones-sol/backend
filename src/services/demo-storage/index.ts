import { ObjectStorageService } from '../storage/index.ts'
import {
  DemoFiles,
  DemoIntegrity,
  FileIntegrity,
  DemoManifest,
  DatasetManifest
} from './types.ts'
import { logger } from "../logger.ts"
import {
  generateDemoHash,
  calculateFileHash,
  calculateOverallHash,
  getDemoStoragePath
} from './hash.ts'

export class DemoStorageService {
  constructor(private objectStorage: ObjectStorageService) { }

  /**
   * Store a complete demonstration with integrity verification
   */
  async storeDemo(
    submissionId: string,
    userAddress: string,
    files: DemoFiles,
    metadata?: Partial<DemoManifest>
  ): Promise<string> {
    const timestamp = Date.now()
    const demoHash = generateDemoHash(submissionId, userAddress, timestamp)

    logger.info(`[DemoStorage] Storing demo ${demoHash} for submission ${submissionId}`)

    const fileIntegrities: FileIntegrity[] = []

    // Store each file with integrity tracking
    for (const [filename, buffer] of Object.entries(files)) {
      const filePath = getDemoStoragePath(demoHash, filename)
      const fileHash = calculateFileHash(buffer)

      logger.info(`[DemoStorage] Storing ${filename} at ${filePath} (${buffer.length} bytes, hash: ${fileHash.substring(0, 16)}...)`)

      await this.objectStorage.saveItem({
        name: filePath,
        file: buffer
      })

      fileIntegrities.push({
        filename,
        sha256: fileHash,
        size: buffer.length,
        lastModified: new Date().toISOString()
      })
    }

    // Generate overall integrity hash
    const fileHashes = fileIntegrities.map(f => f.sha256)
    const overallHash = calculateOverallHash(fileHashes)

    // Create integrity manifest
    const integrity: DemoIntegrity = {
      schema_version: { major: 1, minor: 0, patch: 0 },
      demoHash,
      submissionId,
      userAddress: userAddress.toLowerCase(),
      timestamp,
      files: fileIntegrities,
      overallHash
    }

    // Store integrity manifest
    const integrityPath = getDemoStoragePath(demoHash, 'checksums.json')
    await this.objectStorage.saveItem({
      name: integrityPath,
      file: Buffer.from(JSON.stringify(integrity, null, 2))
    })

    // Store demo manifest if metadata provided
    if (metadata) {
      const demoManifest: DemoManifest = {
        schema_version: { major: 1, minor: 0, patch: 0 },
        demonstration_id: demoHash,
        user_address: userAddress.toLowerCase(),
        submission_id: submissionId,
        created_at: new Date().toISOString(),
        ...metadata
      }

      const manifestPath = getDemoStoragePath(demoHash, 'manifest.json')
      await this.objectStorage.saveItem({
        name: manifestPath,
        file: Buffer.from(JSON.stringify(demoManifest, null, 2))
      })
    }

    logger.info(`[DemoStorage] Demo ${demoHash} stored successfully with overall hash ${overallHash.substring(0, 16)}...`)

    return demoHash
  }

  /**
   * Retrieve a file from a demonstration
   */
  async getDemoFile(demoHash: string, filename: string): Promise<Buffer> {
    const filePath = getDemoStoragePath(demoHash, filename)

    try {
      return await this.objectStorage.getItem({ name: filePath })
    } catch (error) {
      logger.error(`[DemoStorage] Failed to get ${filename} for demo ${demoHash}: ${error}`)
      throw new Error(`Demo file not found: ${filename}`)
    }
  }

  /**
   * Stream a file from a demonstration
   */
  async getDemoFileStream(demoHash: string, filename: string): Promise<NodeJS.ReadableStream> {
    const filePath = getDemoStoragePath(demoHash, filename)

    try {
      return await this.objectStorage.getItemStream({ name: filePath })
    } catch (error) {
      logger.error(`[DemoStorage] Failed to stream ${filename} for demo ${demoHash}: ${error}`)
      throw new Error(`Demo file not found: ${filename}`)
    }
  }

  /**
   * Verify integrity of a demonstration
   */
  async verifyDemo(demoHash: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = []

    try {
      // Load integrity manifest
      const integrityPath = getDemoStoragePath(demoHash, 'checksums.json')
      const integrityBuffer = await this.objectStorage.getItem({ name: integrityPath })
      const integrity: DemoIntegrity = JSON.parse(integrityBuffer.toString())

      // Verify each file
      const actualFileHashes: string[] = []

      for (const fileInfo of integrity.files) {
        try {
          const fileBuffer = await this.getDemoFile(demoHash, fileInfo.filename)
          const currentHash = calculateFileHash(fileBuffer)

          if (currentHash !== fileInfo.sha256) {
            errors.push(`File ${fileInfo.filename} hash mismatch: expected ${fileInfo.sha256}, got ${currentHash}`)
          } else {
            actualFileHashes.push(currentHash)
          }

          if (fileBuffer.length !== fileInfo.size) {
            errors.push(`File ${fileInfo.filename} size mismatch: expected ${fileInfo.size}, got ${fileBuffer.length}`)
          }
        } catch (error) {
          errors.push(`File ${fileInfo.filename} not accessible: ${error}`)
        }
      }

      // Verify overall hash if all files are accessible
      if (actualFileHashes.length === integrity.files.length) {
        const currentOverallHash = calculateOverallHash(actualFileHashes)
        if (currentOverallHash !== integrity.overallHash) {
          errors.push(`Overall hash mismatch: expected ${integrity.overallHash}, got ${currentOverallHash}`)
        }
      }

      return { valid: errors.length === 0, errors }

    } catch (error) {
      return {
        valid: false,
        errors: [`Failed to verify demo: ${error}`]
      }
    }
  }

  /**
   * Get demonstration integrity information
   */
  async getDemoIntegrity(demoHash: string): Promise<DemoIntegrity | null> {
    try {
      const integrityPath = getDemoStoragePath(demoHash, 'checksums.json')
      const integrityBuffer = await this.objectStorage.getItem({ name: integrityPath })
      return JSON.parse(integrityBuffer.toString())
    } catch (error) {
      logger.error(`[DemoStorage] Failed to get integrity for demo ${demoHash}: ${error}`)
      return null
    }
  }

  /**
   * List all available files for a demonstration
   */
  async listDemoFiles(demoHash: string): Promise<{ filename: string; size: number; hash: string }[]> {
    const integrity = await this.getDemoIntegrity(demoHash)
    if (!integrity) {
      throw new Error(`Demo integrity not found: ${demoHash}`)
    }

    return integrity.files.map(f => ({
      filename: f.filename,
      size: f.size,
      hash: f.sha256
    }))
  }

  /**
   * Update a single file in an existing demonstration and refresh integrity manifest
   * Used for post-processing updates like enriching sft.json with video analysis
   */
  async updateDemoFile(demoHash: string, filename: string, fileBuffer: Buffer): Promise<void> {
    logger.info(`[DemoStorage] Updating ${filename} for demo ${demoHash} (${fileBuffer.length} bytes)`)

    // Get current integrity manifest
    const integrity = await this.getDemoIntegrity(demoHash)
    if (!integrity) {
      throw new Error(`Demo integrity not found: ${demoHash}`)
    }

    // Calculate new file hash
    const newFileHash = calculateFileHash(fileBuffer)

    // Upload the updated file
    const filePath = getDemoStoragePath(demoHash, filename)
    await this.objectStorage.saveItem({
      name: filePath,
      file: fileBuffer
    })

    logger.info(`[DemoStorage] Updated file ${filename} uploaded with new hash ${newFileHash.substring(0, 16)}...`)

    // Update file integrity in the manifest
    const fileIndex = integrity.files.findIndex(f => f.filename === filename)
    if (fileIndex === -1) {
      throw new Error(`File ${filename} not found in demo integrity manifest`)
    }

    integrity.files[fileIndex] = {
      filename,
      sha256: newFileHash,
      size: fileBuffer.length,
      lastModified: new Date().toISOString()
    }

    // Recalculate overall hash with updated file hashes
    const fileHashes = integrity.files.map(f => f.sha256)
    integrity.overallHash = calculateOverallHash(fileHashes)

    // Save updated integrity manifest
    const integrityPath = getDemoStoragePath(demoHash, 'checksums.json')
    await this.objectStorage.saveItem({
      name: integrityPath,
      file: Buffer.from(JSON.stringify(integrity, null, 2))
    })

    logger.info(`[DemoStorage] Integrity manifest updated for demo ${demoHash}, new overall hash ${integrity.overallHash.substring(0, 16)}...`)
  }

  /**
   * Create or update dataset manifest
   */
  async updateDatasetManifest(statistics: DatasetManifest['statistics']): Promise<void> {
    const manifest: DatasetManifest = {
      name: 'clones-computer-use-dataset',
      version: '1.0.0',
      description: 'Computer use demonstrations for AI training',
      format: 'clones-demo-v1',
      license: 'MIT',
      created: new Date().toISOString(),
      statistics,
      schema: {
        recording: 'MP4 video file of screen recording',
        meta: 'JSON metadata about the demonstration',
        input_log: 'JSONL file with interaction events',
        input_log_meta: 'JSON metadata about the input log',
        sft: 'JSON file with supervised fine-tuning annotations'
      },
      integrity: {
        algorithm: 'sha256',
        verified_at: new Date().toISOString()
      }
    }

    await this.objectStorage.saveItem({
      name: 'datasets/computer-use-v1/manifest.json',
      file: Buffer.from(JSON.stringify(manifest, null, 2))
    })
  }
}

// Export types for convenience
export * from './types.ts'
export * from './hash.ts'