import express, { Request, Response, Router, NextFunction } from 'express';
import multer from 'multer';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, unlink, copyFile, stat, writeFile, readFile } from 'fs/promises';
import * as path from 'path';
import { Extract } from 'unzipper';
import { createHash } from 'crypto';
import { AWSS3Service } from '../services/aws/index.ts';
import { ForgeAppModel, ForgeRaceSubmission } from '../models/Models.ts';
import { TrainingPoolModel } from '../models/TrainingPool.ts';
import BlockchainService from '../services/blockchain/index.ts';
import {
  DBForgeRaceSubmission,
  ForgeSubmissionProcessingStatus,
  TrainingPoolStatus,
  UploadLimitType,
  UploadSession
} from '../types/index.ts';
import {
  addToProcessingQueue,
  cleanupSession,
  startUploadInterval
} from '../services/forge/index.ts';
import { validateBody, validateParams } from '../middleware/validator.ts';
import {
  initUploadSchema,
  uploadChunkSchema,
  uploadIdParamSchema
} from './schemas/forge-upload.ts';
import { errorHandlerAsync } from '../middleware/errorHandler.ts';
import { ApiError, successResponse } from '../middleware/types/errors.ts';
import { requireWalletAddress } from '../middleware/auth.ts';

// Initialize blockchain service
const blockchainService = new BlockchainService(process.env.RPC_URL || '', '');

// Configure multer for handling chunk uploads
const upload = multer({
  dest: 'uploads/chunks/',
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit per chunk
  }
});

// Store active upload sessions
const activeSessions = new Map<string, UploadSession>();

const SESSION_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

startUploadInterval(activeSessions, SESSION_EXPIRY);

// Middleware to validate upload session
export function requireUploadSession(req: Request, res: Response, next: NextFunction) {
  try {
    const uploadId = req.params.uploadId || req.body.uploadId;

    if (!uploadId) {
      throw ApiError.badRequest('Upload ID is required');
    }

    const session = activeSessions.get(uploadId);
    if (!session) {
      throw ApiError.notFound('Upload session not found or expired');
    }

    // @ts-ignore - Add session to the request object
    req.uploadSession = session;
    next();
  } catch (e) {
    next(e);
  }
}

const router: Router = express.Router();

// Initialize a new upload session
router.post(
  '/init',
  requireWalletAddress,
  validateBody(initUploadSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get walletAddress from the request object
    const address = req.walletAddress;
    const { totalChunks, metadata } = req.body;

    // Generate a unique upload ID
    const uploadId = createHash('sha256')
      .update(`${address}-${Date.now()}-${Math.random()}`)
      .digest('hex');

    // Create temp directory for this upload
    const tempDir = path.join('uploads', `temp_${uploadId}`);
    await mkdir(tempDir, { recursive: true });

    // Store metadata in the temp directory
    await writeFile(path.join(tempDir, 'metadata.json'), JSON.stringify(metadata));

    // Create and store the session
    const session: UploadSession = {
      id: uploadId,
      address,
      totalChunks: Number(totalChunks),
      receivedChunks: new Map(),
      metadata,
      tempDir,
      createdAt: new Date(),
      lastUpdated: new Date()
    };

    activeSessions.set(uploadId, session);

    res.status(200).json(
      successResponse({
        uploadId,
        expiresIn: SESSION_EXPIRY / 1000, // in seconds
        chunkSize: 100 * 1024 * 1024 // 100MB
      })
    );
  })
);

// Upload a chunk
router.post(
  '/chunk/:uploadId',
  requireWalletAddress,
  requireUploadSession,
  upload.single('chunk'),
  validateBody(uploadChunkSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    if (!req.file) {
      throw ApiError.badRequest('No chunk uploaded');
    }

    // @ts-ignore - Get session from the request object
    const session: UploadSession = req.uploadSession;
    const chunkIndex = Number(req.body.chunkIndex);
    const checksum = req.body.checksum;

    if (isNaN(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      await unlink(req.file.path).catch(() => {});
      throw ApiError.badRequest('Invalid chunk index');
    }

    if (!checksum) {
      await unlink(req.file.path).catch(() => {});
      throw ApiError.badRequest('Checksum is required');
    }

    // Verify checksum
    const fileBuffer = await readFile(req.file.path);
    const calculatedChecksum = createHash('sha256').update(fileBuffer).digest('hex');

    if (calculatedChecksum !== checksum) {
      await unlink(req.file.path).catch(() => {});
      throw ApiError.badRequest('Checksum verification failed', {
        expected: checksum,
        calculated: calculatedChecksum
      });
    }

    // Store chunk info
    session.receivedChunks.set(chunkIndex, {
      chunkIndex,
      path: req.file.path,
      size: req.file.size,
      checksum
    });

    // Update session timestamp
    session.lastUpdated = new Date();

    res.status(200).json(
      successResponse({
        uploadId: session.id,
        chunkIndex,
        received: session.receivedChunks.size,
        total: session.totalChunks,
        progress: Math.round((session.receivedChunks.size / session.totalChunks) * 100)
      })
    );
  })
);

// Get upload status
router.get(
  '/status/:uploadId',
  requireWalletAddress,
  requireUploadSession,
  validateParams(uploadIdParamSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get session from the request object
    const session: UploadSession = req.uploadSession;

    res.json(
      successResponse({
        uploadId: session.id,
        received: session.receivedChunks.size,
        total: session.totalChunks,
        progress: Math.round((session.receivedChunks.size / session.totalChunks) * 100),
        createdAt: session.createdAt,
        lastUpdated: session.lastUpdated
      })
    );
  })
);

// Cancel upload
router.delete(
  '/cancel/:uploadId',
  requireWalletAddress,
  requireUploadSession,
  errorHandlerAsync(async (req: Request, res: Response) => {
    // @ts-ignore - Get session from the request object
    const session: UploadSession = req.uploadSession;

    // Clean up session files
    await cleanupSession(session);

    // Remove session
    activeSessions.delete(session.id);

    res.status(200).json(successResponse('Upload cancelled successfully'));
  })
);

// Complete upload and process files
router.post(
  '/complete/:uploadId',
  requireWalletAddress,
  requireUploadSession,
  errorHandlerAsync(async (req: Request, res: Response) => {
    console.log(`[UPLOAD] Starting complete process for upload ${req.params.uploadId}`);

    // Ensure uploads directory exists
    await mkdir('uploads', { recursive: true }).catch((err) => {
      console.error('[UPLOAD] Error ensuring uploads directory exists:', err);
      // Continue anyway, as the directory might already exist
    });
    // @ts-ignore - Get session from the request object
    const session: UploadSession = req.uploadSession;
    // @ts-ignore - Get walletAddress from the request object
    const address = req.walletAddress;
    console.log(
      `[UPLOAD] Processing upload for address: ${address}, chunks: ${session.receivedChunks.size}/${session.totalChunks}`
    );

    // Check if all chunks have been uploaded
    if (session.receivedChunks.size !== session.totalChunks) {
      console.log(
        `[UPLOAD] Incomplete upload: ${session.receivedChunks.size}/${session.totalChunks} chunks received`
      );
      const missing = Array.from({ length: session.totalChunks }, (_, i) => i).filter(
        (i) => !session.receivedChunks.has(i)
      );
      console.log(`[UPLOAD] Missing chunks: ${missing.join(', ')}`);

      throw ApiError.uploadIncomplete('Upload incomplete', {
        received: session.receivedChunks.size,
        total: session.totalChunks,
        missing
      });
    }

    console.log(`[UPLOAD] All chunks received, combining into final file`);
    // Create final file path
    const finalFilePath = path.join('uploads', `complete_${session.id}.zip`);
    console.log(`[UPLOAD] Final file path: ${finalFilePath}`);

    // Combine chunks into final file
    const sortedChunks = Array.from(session.receivedChunks.values()).sort(
      (a, b) => a.chunkIndex - b.chunkIndex
    );
    console.log(`[UPLOAD] Sorted ${sortedChunks.length} chunks for combining`);

    // Create write stream for final file
    const writeStream = createWriteStream(finalFilePath);
    console.log(`[UPLOAD] Created write stream for final file`);

    // Write chunks sequentially
    console.log(`[UPLOAD] Starting to write chunks sequentially`);
    for (let i = 0; i < sortedChunks.length; i++) {
      const chunk = sortedChunks[i];
      console.log(
        `[UPLOAD] Writing chunk ${i + 1}/${sortedChunks.length} (index: ${
          chunk.chunkIndex
        }, size: ${chunk.size} bytes)`
      );
      await new Promise<void>((resolve, reject) => {
        const readStream = createReadStream(chunk.path);

        // Handle backpressure
        let draining = false;

        const handleDrain = () => {
          draining = false;
          readStream.resume();
        };

        writeStream.on('drain', handleDrain);

        readStream
          .on('error', (err: Error) => {
            console.error(`[UPLOAD] Error reading chunk ${chunk.chunkIndex}:`, err);
            writeStream.removeListener('drain', handleDrain);
            reject(err);
          })
          .on('data', (chunk) => {
            // If writeStream returns false, it's experiencing backpressure
            if (!writeStream.write(chunk) && !draining) {
              draining = true;
              readStream.pause(); // Pause reading until drain
            }
          })
          .on('end', () => {
            console.log(`[UPLOAD] Finished reading chunk ${chunk.chunkIndex}`);
            writeStream.removeListener('drain', handleDrain);
            resolve();
          });
      });
    }

    // Close the write stream
    console.log(`[UPLOAD] All chunks written, closing write stream`);
    await new Promise<void>((resolve, reject) => {
      writeStream.end();
      writeStream.on('finish', () => {
        console.log(`[UPLOAD] Write stream closed successfully`);
        resolve();
      });
      writeStream.on('error', (err: Error) => {
        console.error(`[UPLOAD] Error closing write stream:`, err);
        reject(err);
      });
    });

    // Create extraction directory
    const extractDir = path.join('uploads', `extract_${session.id}`);
    console.log(`[UPLOAD] Creating extraction directory: ${extractDir}`);
    await mkdir(extractDir, { recursive: true });

    // Extract the ZIP file
    console.log(`[UPLOAD] Extracting ZIP file to ${extractDir}`);
    await new Promise<void>((resolve, reject) => {
      createReadStream(finalFilePath)
        .pipe(Extract({ path: extractDir }))
        .on('close', () => {
          console.log(`[UPLOAD] ZIP extraction completed`);
          resolve();
        })
        .on('error', (err: Error) => {
          console.error(`[UPLOAD] Error extracting ZIP:`, err);
          reject(err);
        });
    });

    // Read and parse meta.json
    console.log(`[UPLOAD] Reading meta.json from extracted files`);
    const metaJsonPath = path.join(extractDir, 'meta.json');
    console.log(`[UPLOAD] Meta JSON path: ${metaJsonPath}`);
    const metaJson = await readFile(metaJsonPath, 'utf8');
    console.log(`[UPLOAD] Meta JSON content length: ${metaJson.length}`);
    const meta: DBForgeRaceSubmission['meta'] = JSON.parse(metaJson);
    console.log(`[UPLOAD] Parsed meta data, id: ${meta.id}`);

    // Create UUID from meta.id + address
    const uuid = createHash('sha256').update(`${meta.id}${address}`).digest('hex');
    console.log(`[UPLOAD] Generated submission UUID: ${uuid}`);

    // Create final directory with UUID
    const finalDir = path.join('uploads', `extract_${uuid}`);
    console.log(`[UPLOAD] Creating final directory: ${finalDir}`);
    await mkdir(finalDir, { recursive: true });

    // Move files from extract to final directory
    const requiredFiles = ['input_log.jsonl', 'meta.json', 'recording.mp4'];
    console.log(`[UPLOAD] Moving required files to final directory`);
    for (const file of requiredFiles) {
      const sourcePath = path.join(extractDir, file);
      const destPath = path.join(finalDir, file);
      console.log(`[UPLOAD] Copying ${file} from ${sourcePath} to ${destPath}`);
      try {
        await copyFile(sourcePath, destPath);
        console.log(`[UPLOAD] Successfully copied ${file}`);
      } catch (error) {
        console.error(`[UPLOAD] Error copying file ${file}:`, error);
        throw ApiError.badRequest(`Missing required file: ${file}`);
      }
    }

    // Upload each file to S3
    console.log(`[UPLOAD] Starting S3 upload for ${requiredFiles.length} files`);
    const s3Service = new AWSS3Service(process.env.AWS_ACCESS_KEY, process.env.AWS_SECRET_KEY);
    const uploads = await Promise.all(
      requiredFiles.map(async (file) => {
        const filePath = path.join(finalDir, file);
        console.log(`[UPLOAD] Getting stats for file: ${filePath}`);
        const fileStats = await stat(filePath);
        const s3Key = `forge-races/${Date.now()}-${file}`;
        console.log(
          `[UPLOAD] Uploading ${file} (${fileStats.size} bytes) to S3 with key: ${s3Key}`
        );

        await s3Service.saveItem({
          bucket: 'training-gym',
          file: filePath,
          name: s3Key
        });
        console.log(`[UPLOAD] Successfully uploaded ${file} to S3`);

        return { file, s3Key, size: fileStats.size };
      })
    );
    console.log(`[UPLOAD] All files uploaded to S3 successfully`);

    meta.poolId = meta.quest.pool_id;

    // Verify time if poolId
    if (meta.poolId) {
      console.log(`[UPLOAD] Verifying time for pool submission, poolId: ${meta.poolId}`);

      // Verify pool exists and check balance
      console.log(`[UPLOAD] Verifying pool balance and status for poolId: ${meta.poolId}`);
      const pool = await TrainingPoolModel.findById(meta.poolId);
      if (!pool) {
        console.log(`[UPLOAD] Pool not found: ${meta.poolId}`);
        throw ApiError.notFound('Pool not found');
      }

      // Check if pool is in live status
      if (pool.status !== TrainingPoolStatus.live) {
        console.log(`[UPLOAD] Pool not in live status: ${pool.status}`);
        throw ApiError.badRequest(`Pool is not active (status: ${pool.status})`);
      }

      // Get current token balance from blockchain to ensure it's up-to-date
      const currentBalance = await blockchainService.getTokenBalance(
        pool.token.address,
        pool.depositAddress
      );

      // Check if pool has sufficient funds
      if (currentBalance < pool.pricePerDemo) {
        console.log(`[UPLOAD] Insufficient funds: ${currentBalance} < ${pool.pricePerDemo}`);
        throw ApiError.insufficientFunds('Pool has insufficient funds');
      }

      // Update pool funds in database with current balance
      if (pool.funds !== currentBalance) {
        pool.funds = currentBalance;
        await pool.save();
        console.log(`[UPLOAD] Updated pool funds from ${pool.funds} to ${currentBalance}`);
      }

      // check if pool has upload limits
      if (pool.uploadLimit?.type) {
        let gymSubmissions;
        const poolId = pool._id.toString();

        switch (pool.uploadLimit.limitType) {
          case UploadLimitType.perDay:
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            gymSubmissions = await ForgeRaceSubmission.countDocuments({
              'meta.quest.pool_id': poolId,
              createdAt: { $gte: today },
              status: ForgeSubmissionProcessingStatus.COMPLETED, // Only count completed submissions
              reward: { $gt: 0 } // Only count submissions that received a reward
            });

            if (gymSubmissions >= pool.uploadLimit.type) {
              console.log(`[UPLOAD] Daily upload limit reached for pool.`);
              throw ApiError.forbidden('Daily upload limit reached for this pool');
            }
            break;

          case UploadLimitType.total:
            gymSubmissions = await ForgeRaceSubmission.countDocuments({
              'meta.quest.pool_id': poolId,
              status: ForgeSubmissionProcessingStatus.COMPLETED, // Only count completed submissions
              reward: { $gt: 0 } // Only count submissions that received a reward
            });

            if (gymSubmissions >= pool.uploadLimit.type) {
              console.log(`[UPLOAD] Total upload limit reached for pool.`);
              throw ApiError.forbidden('Total upload limit reached for this pool.');
            }
            break;
        }
      }

      // Check task-specific upload limit
      if (meta.quest?.task_id) {
        const app = await ForgeAppModel.findOne({
          pool_id: meta.poolId,
          'tasks._id': meta.quest.task_id
        });

        if (app) {
          const task = app.tasks.find((t) => t._id.toString() === meta.quest.task_id);
          const taskSubmissions = await ForgeRaceSubmission.countDocuments({
            'meta.quest.task_id': meta.quest.task_id,
            status: ForgeSubmissionProcessingStatus.COMPLETED, // Only count completed submissions
            reward: { $gt: 0 } // Only count submissions that received a reward
          });
          if (task?.uploadLimit) {
            if (taskSubmissions >= task.uploadLimit) {
              console.log(`[UPLOAD] Total upload limit reached for task.`);
              throw ApiError.forbidden('Upload limit reached for this task');
            }

            // Check gym-wide per-task limit if applicable
            if (
              pool.uploadLimit?.limitType === UploadLimitType.perTask &&
              pool.uploadLimit?.type &&
              taskSubmissions >= pool.uploadLimit.type
            ) {
              console.log(`[UPLOAD] Per-Task upload limit reached for pool.`);
              throw ApiError.forbidden('Per-task upload limit reached for this pool');
            }
          } else if (
            // also check gym-wide task limit even if there is no limit on the task itself
            pool.uploadLimit?.limitType === UploadLimitType.perTask &&
            pool.uploadLimit.type &&
            taskSubmissions >= pool.uploadLimit.type
          ) {
            console.log(`[UPLOAD] Per-Task upload limit reached for pool.`);
            throw ApiError.forbidden('Per-task upload limit reached for this pool');
          }
        } else {
          throw ApiError.badRequest('Submission Error: invalid task');
        }
      } else {
        throw ApiError.badRequest('Invalid data: missing task id');
      }
    } else {
      console.log(meta);
      throw ApiError.badRequest('Invalid data: missing pool id');
    }

    // Check for existing submission
    console.log(`[UPLOAD] Checking for existing submission with ID: ${uuid}`);
    const tempSub = await ForgeRaceSubmission.findById(uuid);
    if (tempSub) {
      console.log(`[UPLOAD] Submission already exists with ID: ${uuid}`);

      throw ApiError.conflict('Submission data already uploaded', { submissionId: uuid });
    }

    // Create submission record
    console.log(`[UPLOAD] Creating new submission record in database`);
    const submission = await ForgeRaceSubmission.create({
      _id: uuid,
      address,
      meta,
      status: ForgeSubmissionProcessingStatus.PENDING,
      files: uploads
    });
    console.log(`[UPLOAD] Submission created with ID: ${submission._id}`);

    // Add to processing queue
    console.log(`[UPLOAD] Adding submission to processing queue`);
    addToProcessingQueue(uuid);
    console.log(`[UPLOAD] Submission added to processing queue`);

    // Clean up session files
    console.log(`[UPLOAD] Cleaning up session files`);
    await cleanupSession(session);
    console.log(`[UPLOAD] Session files cleaned up`);

    // Remove session
    console.log(`[UPLOAD] Removing session from active sessions`);
    activeSessions.delete(session.id);

    // Clean up temporary files
    console.log(`[UPLOAD] Cleaning up temporary ZIP file: ${finalFilePath}`);
    await unlink(finalFilePath).catch((err: Error) => {
      console.error(`[UPLOAD] Error deleting temporary ZIP file:`, err);
    });

    console.log(`[UPLOAD] Upload complete process finished successfully for ID: ${uuid}`);
    res.json(
      successResponse({
        message: 'Upload completed successfully',
        submissionId: submission._id,
        files: uploads
      })
    );
  })
);

/**
 * ## Chunked Upload API Documentation
 *
 * This API provides endpoints for uploading large files in chunks, which improves reliability
 * and allows for resumable uploads.
 *
 * ### POST /forge/upload/init
 *
 * Initializes a new chunked upload session.
 *
 * #### Request Body
 * ```json
 * {
 *   "totalChunks": 10,           // Required: Total number of chunks to expect
 *   "metadata": {                 // Required: Metadata about the upload
 *     "poolId": "pool123",        // Optional: Pool ID if applicable
 *     "generatedTime": 1647123456789, // Optional: Timestamp when content was generated
 *     "id": "unique-race-id"      // Required: Unique identifier for the race
 *   }
 * }
 * ```
 *
 * #### Response
 * ```json
 * {
 *   "uploadId": "abc123...",     // Unique ID for this upload session
 *   "expiresIn": 86400,          // Seconds until this session expires (24 hours)
 *   "chunkSize": 104857600       // Maximum chunk size in bytes (100MB)
 * }
 * ```
 *
 * ### POST /forge/upload/chunk/:uploadId
 *
 * Uploads a single chunk of the file.
 *
 * #### Request
 * - URL Parameter: `uploadId` - The upload session ID from init
 * - Form Data:
 *   - `chunk`: (file) The binary chunk data
 *   - `chunkIndex`: (number) Zero-based index of this chunk
 *   - `checksum`: (string) SHA256 hash of the chunk for verification
 *
 * #### Response
 * ```json
 * {
 *   "uploadId": "abc123...",
 *   "chunkIndex": 0,
 *   "received": 1,               // Number of chunks received so far
 *   "total": 10,                 // Total number of chunks expected
 *   "progress": 10               // Upload progress percentage
 * }
 * ```
 *
 * ### GET /forge/upload/status/:uploadId
 *
 * Gets the current status of an upload.
 *
 * #### Response
 * ```json
 * {
 *   "uploadId": "abc123...",
 *   "received": 5,               // Number of chunks received
 *   "total": 10,                 // Total number of chunks
 *   "progress": 50,              // Upload progress percentage
 *   "createdAt": "2023-01-01T12:00:00.000Z",
 *   "lastUpdated": "2023-01-01T12:05:00.000Z"
 * }
 * ```
 *
 * ### DELETE /forge/upload/cancel/:uploadId
 *
 * Cancels an in-progress upload and cleans up temporary files.
 *
 * #### Response
 * ```json
 * {
 *   "message": "Upload cancelled successfully"
 * }
 * ```
 *
 * ### POST /forge/upload/complete/:uploadId
 *
 * Completes the upload process, combines chunks, and processes the file.
 *
 * #### Response (Success)
 * ```json
 * {
 *   "message": "Upload completed successfully",
 *   "submissionId": "def456...",
 *   "files": [
 *     {
 *       "file": "meta.json",
 *       "s3Key": "forge-races/1647123456789-meta.json",
 *       "size": 1024
 *     },
 *     // ... other files
 *   ]
 * }
 * ```
 *
 * #### Response (Incomplete Upload)
 * ```json
 * {
 *   "error": "Upload incomplete",
 *   "received": 8,
 *   "total": 10,
 *   "missing": [2, 5]            // Indices of missing chunks
 * }
 * ```
 *
 * ### Authentication
 *
 * All endpoints require authentication via the `x-connect-token` header.
 *
 * ### Error Handling
 *
 * All endpoints return appropriate HTTP status codes:
 * - 400: Bad Request (invalid parameters)
 * - 401: Unauthorized (missing or invalid token)
 * - 404: Not Found (upload session not found)
 * - 500: Internal Server Error
 *
 * ### Example Usage
 *
 * ```javascript
 * // Initialize upload
 * const initResponse = await fetch('/api/forge/upload/init', {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'x-connect-token': 'user-token'
 *   },
 *   body: JSON.stringify({
 *     totalChunks: 3,
 *     metadata: { id: 'race-123', poolId: 'pool-456' }
 *   })
 * });
 * const { uploadId } = await initResponse.json();
 *
 * // Upload chunks
 * for (let i = 0; i < 3; i++) {
 *   const chunk = getChunk(i); // Your function to get chunk data
 *   const checksum = calculateSHA256(chunk); // Your function to calculate SHA256
 *
 *   const formData = new FormData();
 *   formData.append('chunk', chunk);
 *   formData.append('chunkIndex', i);
 *   formData.append('checksum', checksum);
 *
 *   await fetch(`/api/forge/upload/chunk/${uploadId}`, {
 *     method: 'POST',
 *     headers: {
 *       'x-connect-token': 'user-token'
 *     },
 *     body: formData
 *   });
 * }
 *
 * // Complete upload
 * const completeResponse = await fetch(`/api/forge/upload/complete/${uploadId}`, {
 *   method: 'POST',
 *   headers: {
 *     'Content-Type': 'application/json',
 *     'x-connect-token': 'user-token'
 *   }
 * });
 * const result = await completeResponse.json();
 * console.log(`Upload completed with submission ID: ${result.submissionId}`);
 * ```
 */

export { router as forgeUploadApi };
