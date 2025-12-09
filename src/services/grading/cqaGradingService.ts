import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { logger } from '../logger.ts'
import type { ForgeSubmissionGradeResult } from '../../types/index.ts'

export interface GradingOptions {
    useVideoGrading?: boolean
    model?: string
    cleanupOnSuccess?: boolean
    cleanupOnError?: boolean
}

export interface GradingResult {
    gradeResult: ForgeSubmissionGradeResult
    gradingMetrics: any | null
}

/**
 * Get the CQA path based on environment
 * Priority:
 * 1. CQA_PATH environment variable (explicit override)
 * 2. Local development path (../clones-quality-agent/src/index.ts)
 * 3. Docker/production path (/app/clones-quality-agent)
 */
function getCQAPath(): { path: string; useBun: boolean } {
    if (process.env.CQA_PATH) {
        return {
            path: process.env.CQA_PATH,
            useBun: process.env.CQA_PATH.endsWith('.ts')
        }
    }

    // Check for local development CQA using fs from node:fs (synchronous)
    const localCQAPath = path.join(process.cwd(), '..', 'clones-quality-agent', 'src', 'index.ts')
    try {
        // Use fs.statSync which is more reliable than existsSync
        const fsSync = require('node:fs')
        fsSync.statSync(localCQAPath)
        logger.info({ cqaPath: localCQAPath }, 'Using local CQA with bun')
        return { path: localCQAPath, useBun: true }
    } catch (error) {
        // File doesn't exist or can't be accessed, fall back to Docker path
    }

    // Docker/production path
    logger.info('Using Docker CQA path: /app/clones-quality-agent')
    return { path: '/app/clones-quality-agent', useBun: false }
}

/**
 * Run CQA grading on a directory containing demonstration files
 * 
 * @param inputDir - Directory containing recording.mp4, meta.json, input_log.jsonl, sft.json
 * @param options - Grading options
 * @returns Grade result and metrics
 */
export async function runCQAGrading(
    inputDir: string,
    options: GradingOptions = {}
): Promise<GradingResult> {
    const {
        useVideoGrading = process.env.USE_VIDEO_GRADING !== 'false',
        model = process.env.CQA_MODEL,
        cleanupOnSuccess = false,
        cleanupOnError = false
    } = options

    logger.info('Running CQA grading', { inputDir, useVideoGrading, model })

    // Verify directory exists and has required files
    try {
        const files = await fs.readdir(inputDir)
        logger.info('Directory contents', { files })

        if (files.length === 0) {
            throw new Error('No files found in input directory')
        }
    } catch (error) {
        throw new Error(`Failed to read input directory: ${(error as Error).message}`)
    }

    const { path: cqaPath, useBun } = getCQAPath()

    return new Promise((resolve, reject) => {
        const absoluteInputDir = path.resolve(inputDir)

        // Prepare CQA arguments
        const cqaArgs = ['-f', 'desktop', '-i', absoluteInputDir, '--grade']

        if (useVideoGrading) {
            cqaArgs.push('--video-mode')
            logger.info('Video grading mode enabled')
        }

        if (model) {
            cqaArgs.push('--model', model)
        }

        // Determine command and args based on whether we're using bun or compiled binary
        let command: string
        let args: string[]
        let cwd: string | undefined

        if (useBun) {
            // Use bun to run TypeScript source directly
            command = 'bun'
            args = ['run', cqaPath, ...cqaArgs]
            cwd = path.dirname(cqaPath)
            logger.info(`Executing CQA with bun: ${command} ${args.join(' ')}`, { cwd })
        } else {
            // Use compiled binary
            command = cqaPath
            args = cqaArgs
            // Only use /app/cqa as cwd if it exists (Docker environment)
            // Otherwise run from current directory
            try {
                require('node:fs').statSync('/app/cqa')
                cwd = '/app/cqa'
            } catch {
                cwd = undefined
            }
            logger.info(`Executing CQA binary: ${command} ${args.join(' ')}`, { cwd: cwd || 'current directory' })
        }

        const cqaProcess = spawn(command, args, {
            cwd,
            env: {
                ...process.env,
                OPENAI_API_KEY: process.env.OPENAI_API_KEY,
                GEMINI_API_KEY: process.env.GEMINI_API_KEY,
                ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
            }
        })

        let stdout = ''
        let stderr = ''
        let stdoutLineBuffer = ''
        let stderrLineBuffer = ''

        cqaProcess.stdout.on('data', (data) => {
            stdout += data
            stdoutLineBuffer += data.toString()

            // Log complete lines as they come
            const lines = stdoutLineBuffer.split('\n')
            stdoutLineBuffer = lines.pop() || ''

            lines.forEach((line) => {
                if (line.trim()) {
                    logger.info({ cqaOutput: 'stdout', line }, 'CQA stdout')
                }
            })
        })

        cqaProcess.stderr.on('data', (data) => {
            stderr += data
            stderrLineBuffer += data.toString()

            // Log complete lines as they come
            const lines = stderrLineBuffer.split('\n')
            stderrLineBuffer = lines.pop() || ''

            lines.forEach((line) => {
                if (line.trim()) {
                    logger.warn({ cqaOutput: 'stderr', line }, 'CQA stderr')
                }
            })
        })

        cqaProcess.on('close', async (code: number) => {
            // Log any remaining buffer content
            if (stdoutLineBuffer.trim()) {
                logger.info({ cqaOutput: 'stdout', line: stdoutLineBuffer.trim() }, 'CQA stdout (final)')
            }
            if (stderrLineBuffer.trim()) {
                logger.warn({ cqaOutput: 'stderr', line: stderrLineBuffer.trim() }, 'CQA stderr (final)')
            }

            if (code === 0) {
                logger.info({ exitCode: code }, 'CQA grading completed successfully')

                try {
                    // Read scores.json
                    const scoresPath = path.join(inputDir, 'scores.json')
                    await fs.access(scoresPath)
                    const scoresContent = await fs.readFile(scoresPath, 'utf8')
                    const gradeResult: ForgeSubmissionGradeResult = JSON.parse(scoresContent)
                    logger.info('Grade result', { score: gradeResult.score })

                    // Read metrics.json if available
                    let gradingMetrics = null
                    const metricsPath = path.join(inputDir, 'metrics.json')
                    try {
                        await fs.access(metricsPath)
                        const metricsContent = await fs.readFile(metricsPath, 'utf8')
                        gradingMetrics = JSON.parse(metricsContent)
                        logger.info('Grading metrics available')
                    } catch {
                        logger.info('No metrics.json found')
                    }

                    // Cleanup on success if requested
                    if (cleanupOnSuccess) {
                        try {
                            await fs.rm(inputDir, { recursive: true, force: true })
                            logger.info('Cleaned up temp directory after success', { inputDir })
                        } catch (cleanupError) {
                            logger.warn('Failed to cleanup temp directory', { error: cleanupError })
                        }
                    }

                    resolve({ gradeResult, gradingMetrics })
                } catch (error) {
                    reject(new Error(`Failed to read grading results: ${(error as Error).message}`))
                }
            } else {
                logger.error({
                    exitCode: code,
                    fullStdout: stdout,
                    fullStderr: stderr
                }, 'CQA grading failed')

                // Cleanup on error if requested
                if (cleanupOnError) {
                    try {
                        await fs.rm(inputDir, { recursive: true, force: true })
                        logger.info('Cleaned up temp directory after error', { inputDir })
                    } catch (cleanupError) {
                        logger.warn('Failed to cleanup temp directory', { error: cleanupError })
                    }
                }

                reject(new Error(`CQA grading failed with code ${code}\nstdout: ${stdout}\nstderr: ${stderr}`))
            }
        })

        cqaProcess.on('error', (err) => {
            logger.error('CQA spawn error', { error: err })
            reject(new Error(`Failed to start CQA: ${err.message}`))
        })
    })
}

/**
 * Prepare a directory for grading by downloading demo files
 * This is a utility function for use with runCQAGrading
 */
export async function prepareDemoForGrading(
    demoHash: string,
    targetDir: string,
    storageService: any
): Promise<void> {
    logger.info('Preparing demo for grading', { demoHash, targetDir })

    // Create target directory
    await fs.mkdir(targetDir, { recursive: true })

    const requiredFiles = ['recording.mp4', 'meta.json', 'input_log.jsonl', 'sft.json']

    for (const filename of requiredFiles) {
        try {
            const fileBuffer = await storageService.getDemoFile(demoHash, filename)
            const filePath = path.join(targetDir, filename)
            await fs.writeFile(filePath, fileBuffer)
            logger.info(`Downloaded ${filename}`, { size: fileBuffer.length })
        } catch (error) {
            throw new Error(`Failed to download ${filename}: ${(error as Error).message}`)
        }
    }

    logger.info('Demo files prepared for grading')
}

