import express, { type Request, type Response, type Router } from 'express'
import { Types } from 'mongoose'
import OpenAI from 'openai'
import { errorHandlerAsync } from '../../middleware/errorHandler.ts'
import { ApiError, ErrorCode, successResponse } from '../../middleware/types/errors.ts'
import { validateBody, validateParams, validateQuery } from '../../middleware/validator.ts'
import { DemonstrationSubmission, FactoryModel } from '../../models/Models.ts'
import { APP_TASK_GENERATION_PROMPT } from '../../services/forge/index.ts'
import {
  type Factory,
  type FactoryApp,
  FactoryStatus,
  type FactoryTask,
  ForgeSubmissionProcessingStatus
} from '../../types/factory.ts'
import { generateContentSchema, getTasksSchema } from '../schemas/forgeFactory.ts'
import { factoryIdParamSchema, updateFactoryAppsSchema } from '../schemas/forgeApps.ts'
import { requireWalletAddress } from '../../middleware/auth.ts'
import { logger } from "../../services/logger.ts"

// MongoDB aggregation pipeline types
interface MongoMatchStage {
  [key: string]: unknown
  $and?: Array<Record<string, unknown>>
}

import type { PipelineStage } from 'mongoose'

type MongoAggregationPipeline = PipelineStage[]

const router: Router = express.Router()

// Helper functions to reduce complexity
function checkAdultContent(text: string): boolean {
  const lowerText = text.toLowerCase()
  return ADULT_KEYWORDS.some((keyword) => lowerText.includes(keyword.toLowerCase()))
}

interface TaskQueryParams {
  pool_id?: string
  categories?: string | string[]
  query?: string
  hide_adult?: string
}

interface TaskLimitInfo {
  taskLimitReached: boolean
  taskSubmissions: number
  limitReason: string | null
}


interface MongoMatchFilter {
  _id?: string
  status?: string
}

function buildFactoryMatchStage(params: TaskQueryParams): MongoMatchFilter {
  const matchStage: MongoMatchFilter = {}

  if (params.pool_id) {
    matchStage._id = params.pool_id.toString()
  } else {
    matchStage.status = FactoryStatus.active
  }

  return matchStage
}

function buildAppTaskMatchStage(params: TaskQueryParams): Record<string, unknown> {
  const appTaskMatchStage: Record<string, unknown> = {}

  if (params.categories) {
    try {
      const categoriesArray =
        typeof params.categories === 'string' ? params.categories.split(',') : params.categories
      if (Array.isArray(categoriesArray) && categoriesArray.length > 0) {
        appTaskMatchStage['apps.categories'] = { $in: categoriesArray }
      }
    } catch (e) {
      logger.error('Error parsing categories parameter:', e)
    }
  }

  if (params.query && typeof params.query === 'string') {
    const searchRegex = new RegExp(params.query, 'i')
    appTaskMatchStage.$or = [{ 'apps.name': searchRegex }, { 'apps.tasks.prompt': searchRegex }]
  }

  if (params.hide_adult === 'true') {
    const adultRegex = ADULT_KEYWORDS.join('|')
    appTaskMatchStage.$and = [
      { 'apps.name': { $not: { $regex: adultRegex, $options: 'i' } } },
      { 'apps.tasks.prompt': { $not: { $regex: adultRegex, $options: 'i' } } },
      {
        $or: [
          { 'apps.description': { $exists: false } },
          { 'apps.description': { $not: { $regex: adultRegex, $options: 'i' } } }
        ]
      }
    ]
  }

  return appTaskMatchStage
}

function buildQueryPipeline(params: TaskQueryParams): PipelineStage[] {
  const pipeline: PipelineStage[] = []

  pipeline.push({ $match: buildFactoryMatchStage(params) })
  pipeline.push({ $unwind: '$apps' })
  pipeline.push({ $unwind: '$apps.tasks' })

  const appTaskMatch = buildAppTaskMatchStage(params)
  if (Object.keys(appTaskMatch).length > 0) {
    pipeline.push({ $match: appTaskMatch })
  }

  pipeline.push({ $limit: 1000 })
  pipeline.push({
    $project: {
      _id: '$apps.tasks.id',
      prompt: '$apps.tasks.prompt',
      uploadLimit: '$apps.tasks.uploadLimit',
      rewardLimit: '$apps.tasks.rewardLimit',
      factoryId: '$_id',
      app: {
        _id: '$apps.id',
        name: '$apps.name',
        domain: '$apps.domain',
        description: '$apps.description',
        categories: '$apps.categories',
        pool_id: '$_id'
      }
    }
  })

  return pipeline
}

async function fetchSubmissionCounts(
  taskIds: string[]
): Promise<Map<string, number>> {
  const taskSubmissionsList = await DemonstrationSubmission.aggregate([
    {
      $match: {
        'meta.quest.task_id': { $in: taskIds },
        status: ForgeSubmissionProcessingStatus.COMPLETED,
        onChainReward: { $exists: true }
      }
    },
    { $group: { _id: '$meta.quest.task_id', count: { $sum: 1 } } }
  ])

  return new Map(taskSubmissionsList.map((item) => [item._id.toString(), item.count]))
}


function checkTaskSpecificLimits(
  taskData: Record<string, any>,
  submissionMap: Map<string, number>
): {
  taskLimitReached: boolean
  taskSubmissions: number
  limitReason: string | null
} {
  if (!taskData.uploadLimit) {
    return { taskLimitReached: false, taskSubmissions: 0, limitReason: null }
  }

  const taskSubmissions = submissionMap.get(taskData._id.toString()) || 0

  if (taskSubmissions >= taskData.uploadLimit) {
    return { taskLimitReached: true, taskSubmissions, limitReason: 'Task limit reached' }
  }

  return { taskLimitReached: false, taskSubmissions, limitReason: null }
}


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

/**
 * @swagger
 * tags:
 *   name: Apps
 *   description: Apps management and search
 */

/**
 * @swagger
 * /forge/factories/apps/categories:
 *   get:
 *     summary: Get all possible categories
 *     tags: [Apps]
 */
router.get(
  '/categories',
  errorHandlerAsync(async (_req: Request, res: Response) => {
    // Aggregate to get unique categories across all factories' apps
    const categoriesResult = await FactoryModel.aggregate([
      { $unwind: '$apps' },
      { $unwind: '$apps.categories' },
      { $match: { 'apps.categories': { $type: 'string' } } },
      { $group: { _id: { $trim: { input: '$apps.categories' } } } },
      { $match: { _id: { $ne: '' } } },
      { $sort: { _id: 1 } }
    ])

    // Format the result as an array of category names
    const categories = categoriesResult.map((item) => item._id)

    res.status(200).json(successResponse(categories))
  })
)

/**
 * @swagger
 * /forge/factories/apps:
 *   post:
 *     summary: Generate new apps for factories
 *     tags: [Apps]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               prompt:
 *                 type: string
 *               factoryId:
 *                 type: string
 *             required:
 *               - prompt
 *               - factoryId
 */
router.post(
  '/',
  validateBody(generateContentSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { prompt, factoryId } = req.body

    // Generate new apps using OpenAI
    const formatted_prompt = APP_TASK_GENERATION_PROMPT.replace('{skill list}', prompt)
    const response = await openai.chat.completions.create({
      model: 'o3-mini',
      reasoning_effort: 'medium' as const,
      messages: [
        {
          role: 'user',
          content: formatted_prompt
        }
      ]
    })

    const content = response.choices[0].message.content
    if (!content) {
      throw new Error('Empty response from OpenAI')
    }

    // Parse JSON content and optionally save to factory
    try {
      const parsedContent = JSON.parse(content)

      // If factoryId is provided, add apps to the factory
      if (factoryId) {
        await FactoryModel.findByIdAndUpdate(factoryId, {
          $push: { apps: { $each: parsedContent.apps } }
        })
      }

      res.status(200).json(
        successResponse({
          content: parsedContent
        })
      )
    } catch (_parseError) {
      throw new ApiError(500, ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to parse content as JSON', {
        content
      })
    }
  })
)

// Adult content keywords to check against
const ADULT_KEYWORDS = [
  'adult',
  'xvideo',
  'nsfw',
  'xxx',
  'porn',
  'fuck',
  'sex ',
  'nude',
  'naked',
  'explicit',
  'erotic',
  'mature',
  '18+',
  'adult content',
  'adult material'
]

/**
 * @swagger
 * /forge/factories/apps/tasks:
 *   get:
 *     summary: Get all tasks with filtering options
 *     tags: [Apps]
 */
router.get(
  '/tasks',
  validateQuery(getTasksSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const params = req.query as TaskQueryParams

    const pipeline = buildQueryPipeline(params)
    const tasksFromDB = await FactoryModel.aggregate(pipeline)

    if (tasksFromDB.length === 0) {
      return res.status(200).json(successResponse([]))
    }

    const taskIds = tasksFromDB.map((t) => t._id.toString())
    const taskSubmissions = await fetchSubmissionCounts(taskIds)

    const tasks = []
    for (const taskData of tasksFromDB) {
      if (params.hide_adult === 'true' && checkAdultContent(taskData.prompt)) {
        continue
      }

      const limitInfo = checkTaskSpecificLimits(taskData, taskSubmissions)

      tasks.push({
        _id: taskData._id,
        prompt: taskData.prompt,
        uploadLimit: taskData.uploadLimit,
        rewardLimit: taskData.rewardLimit,
        uploadLimitReached: limitInfo.taskLimitReached,
        currentSubmissions: limitInfo.taskSubmissions,
        limitReason: limitInfo.limitReason,
        app: taskData.app
      })
    }

    res.status(200).json(successResponse(tasks))
  })
)

/**
 * @swagger
 * /forge/factories/apps:
 *   get:
 *     summary: Get all apps with filtering options
 *     tags: [Apps]
 */
router.get(
  '/',
  validateQuery(getTasksSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { pool_id, categories, query } = req.query as TaskQueryParams

    // Build aggregation pipeline for factories
    const pipeline: MongoAggregationPipeline = []

    // Match stage - filter factories
    const matchStage: MongoMatchStage = {}

    // Filter by pool_id (factory _id) if specified
    if (pool_id) {
      matchStage._id = pool_id.toString()
    } else {
      // Only include active factories if no specific pool_id
      matchStage.status = FactoryStatus.active
    }

    pipeline.push({ $match: matchStage })

    // Unwind apps
    pipeline.push({ $unwind: '$apps' })

    // Filter apps
    const appMatchStage: MongoMatchStage = {}

    // Filter by categories if specified
    if (categories) {
      try {
        const categoriesArray = typeof categories === 'string' ? categories.split(',') : categories
        if (Array.isArray(categoriesArray) && categoriesArray.length > 0) {
          appMatchStage['apps.categories'] = { $in: categoriesArray }
        }
      } catch (e) {
        logger.error('Error parsing categories parameter:', e)
      }
    }

    // Text search for app name and task prompts
    if (query && typeof query === 'string') {
      const searchRegex = new RegExp(query, 'i')
      appMatchStage.$or = [{ 'apps.name': searchRegex }, { 'apps.tasks.prompt': searchRegex }]
    }

    if (Object.keys(appMatchStage).length > 0) {
      pipeline.push({ $match: appMatchStage })
    }

    // Add pagination to prevent DoS - limit to 500 apps max
    pipeline.push({ $limit: 500 })

    // Project the required fields for apps
    pipeline.push({
      $project: {
        _id: '$apps.id',
        name: '$apps.name',
        domain: '$apps.domain',
        description: '$apps.description',
        categories: '$apps.categories',
        tasks: '$apps.tasks',
        pool_id: '$_id'
      }
    })

    const appsFromDB = await FactoryModel.aggregate(pipeline)

    if (appsFromDB.length === 0) {
      return res.status(200).json(successResponse([]))
    }

    // Collect all task IDs for batch submission counting
    const allTaskIds: string[] = []
    appsFromDB.forEach(app => {
      app.tasks.forEach((task: FactoryTask) => {
        allTaskIds.push(task.id)
      })
    })

    // Fetch all submission counts in one query
    const submissionMap = allTaskIds.length > 0 ? await fetchSubmissionCounts(allTaskIds) : new Map<string, number>()

    // Process apps with task limit information
    const appsWithLimitInfo = appsFromDB.map(app => {
      // Process tasks and add limit information
      const tasksWithLimitInfo = app.tasks.map((task: FactoryTask) => {
        const limitInfo = checkTaskSpecificLimits(
          { _id: task.id, uploadLimit: task.uploadLimit },
          submissionMap
        )

        return {
          _id: task.id,
          ...task,
          uploadLimitReached: limitInfo.taskLimitReached,
          currentSubmissions: limitInfo.taskSubmissions,
          limitReason: limitInfo.limitReason
        }
      })

      return {
        _id: app._id,
        name: app.name,
        domain: app.domain,
        description: app.description,
        categories: app.categories,
        tasks: tasksWithLimitInfo,
        pool_id: app.pool_id
      }
    })

    res.status(200).json(successResponse(appsWithLimitInfo))
  })
)

/**
 * @swagger
 * /forge/factories/{id}/apps:
 *   put:
 *     summary: Update factory apps
 *     tags: [Apps]
 */
router.put(
  '/:id',
  requireWalletAddress,
  validateParams(factoryIdParamSchema),
  validateBody(updateFactoryAppsSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { id } = req.params
    const { apps } = req.body
    // @ts-expect-error
    const ownerAddress = req.walletAddress.toLowerCase()

    // Find the factory
    const factory = await FactoryModel.findById(id)

    if (!factory) {
      throw ApiError.notFound('Factory not found')
    }

    if (factory.ownerAddress !== ownerAddress) {
      throw ApiError.forbidden('Not authorized to update this factory')
    }

    // Generate IDs for apps and tasks
    const appsWithIds = apps.map((app: Omit<FactoryApp, 'id'>) => ({
      ...app,
      id: `app_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      tasks: app.tasks.map((task: Omit<FactoryTask, 'id'>) => ({
        ...task,
        id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        // Convert rewardLimit to Decimal128 if it exists
        rewardLimit: task.rewardLimit !== undefined
          ? Types.Decimal128.fromString(task.rewardLimit.toString())
          : undefined
      }))
    }))

    // Update the factory apps
    factory.apps = appsWithIds as any
    await factory.save()

    // Return updated factory
    const updatedFactory = await FactoryModel.findById(id)
    res.json(successResponse(updatedFactory?.toJSON()))
  })
)

export { router as forgeFactoryAppsApi }
