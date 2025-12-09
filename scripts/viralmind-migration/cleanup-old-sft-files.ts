#!/usr/bin/env node

/**
 * Cleanup script for old sft.json files
 *
 * This script:
 * 1. Reads all subdirectories in data/sft_files
 * 2. Checks the creation date of each directory
 * 3. Deletes sft.json files from directories created more than 5 minutes ago
 * 4. Keeps sft.json files from recently created directories (< 5 min)
 *
 * Usage: npx tsx scripts/cleanup-old-sft-files.ts
 */

import { promises as fs } from 'fs'
import * as path from 'path'

const SFT_FILES_DIR = path.join(process.cwd(), 'data', 'sft_files')
const MAX_AGE_MINUTES = 5
const MAX_AGE_MS = MAX_AGE_MINUTES * 60 * 1000

interface CleanupStats {
  totalFolders: number
  keptFiles: number
  deletedFiles: number
  errors: number
}

/**
 * Clean up sft.json files from old directories
 */
async function cleanupOldSftFiles(): Promise<CleanupStats> {
  const stats: CleanupStats = {
    totalFolders: 0,
    keptFiles: 0,
    deletedFiles: 0,
    errors: 0
  }

  console.log(`🧹 Cleaning up old sft.json files...`)
  console.log(`📁 Directory: ${SFT_FILES_DIR}`)
  console.log(`⏱️  Max age: ${MAX_AGE_MINUTES} minutes\n`)

  // Check if directory exists
  try {
    await fs.access(SFT_FILES_DIR)
  } catch {
    console.log(`⚠️  Directory ${SFT_FILES_DIR} does not exist yet.`)
    return stats
  }

  // Read all subdirectories
  const entries = await fs.readdir(SFT_FILES_DIR, { withFileTypes: true })
  const folders = entries.filter(entry => entry.isDirectory())

  stats.totalFolders = folders.length
  console.log(`📊 Found ${folders.length} folder(s) to analyze\n`)

  for (const folder of folders) {
    const folderPath = path.join(SFT_FILES_DIR, folder.name)
    const sftJsonPath = path.join(folderPath, 'sft.json')

    try {
      // Check if sft.json exists
      try {
        await fs.access(sftJsonPath)
      } catch {
        // No sft.json in this folder, continue
        continue
      }

      // Check folder age
      const folderStats = await fs.stat(folderPath)
      const createdAt = folderStats.birthtime
      const now = new Date()
      const ageMs = now.getTime() - createdAt.getTime()
      const ageMinutes = Math.floor(ageMs / 60000)

      if (ageMs < MAX_AGE_MS) {
        // Recent folder, keep the file
        console.log(`✅ Keeping: ${folder.name} (created ${ageMinutes} min ago)`)
        stats.keptFiles++
      } else {
        // Old folder, delete the file
        await fs.unlink(sftJsonPath)
        console.log(`🗑️  Deleted: ${folder.name}/sft.json (created ${ageMinutes} min ago)`)
        stats.deletedFiles++
      }

    } catch (error: any) {
      console.error(`❌ Error processing ${folder.name}:`, error.message)
      stats.errors++
    }
  }

  return stats
}

/**
 * Main function
 */
async function main() {
  try {
    const startTime = Date.now()

    const stats = await cleanupOldSftFiles()

    const duration = ((Date.now() - startTime) / 1000).toFixed(2)

    console.log(`\n${'='.repeat(60)}`)
    console.log(`📊 Cleanup Summary:`)
    console.log(`   - Folders analyzed: ${stats.totalFolders}`)
    console.log(`   - Files kept: ${stats.keptFiles}`)
    console.log(`   - Files deleted: ${stats.deletedFiles}`)
    console.log(`   - Errors: ${stats.errors}`)
    console.log(`   - Duration: ${duration}s`)
    console.log(`${'='.repeat(60)}`)

    console.log(`\n✅ Cleanup completed!`)

  } catch (error: any) {
    console.error(`\n❌ Fatal error:`, error.message)
    process.exit(1)
  }
}

// Run script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}

export { cleanupOldSftFiles }
