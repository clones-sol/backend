import express, { type Request, type Response, type Router } from 'express'
import { Types } from 'mongoose'
import OpenAI from 'openai'
import { errorHandlerAsync } from '../../middleware/errorHandler.ts'
import { ApiError, ErrorCode, successResponse } from '../../middleware/types/errors.ts'
import { validateBody, validateParams, validateQuery } from '../../middleware/validator.ts'
import { AppModel, AppRelationModel, DemonstrationSubmission, FactoryModel } from '../../models/Models.ts'
import { APP_TASK_GENERATION_PROMPT } from '../../services/forge/index.ts'
import { randomUUID } from 'crypto'
import {
  type Factory,
  FactoryStatus,
  type FactoryTask,
  ForgeSubmissionProcessingStatus,
  type WorkflowTask,
  type WorkflowGenerationResult
} from '../../types/factory.ts'
import { generateContentSchema, getTasksSchema } from '../schemas/forgeFactory.ts'
import { factoryIdParamSchema, updateFactoryAppsSchema, updateFactoryWorkflowsSchema } from '../schemas/forgeApps.ts'
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

  pipeline.push({ $unwind: '$tasks' })

  const taskMatch = buildTaskMatchStage(params)
  if (Object.keys(taskMatch).length > 0) {
    pipeline.push({ $match: taskMatch })
  }

  pipeline.push({ $limit: 1000 })
  pipeline.push({
    $project: {
      _id: '$tasks.id',
      prompt: '$tasks.prompt',
      uploadLimit: '$tasks.uploadLimit',
      rewardLimit: '$tasks.rewardLimit',
      categories: '$tasks.categories',
      task_name: '$tasks.task_name',
      apps_used: '$tasks.apps_used',
      objectives: '$tasks.objectives',
      factoryId: '$_id',
      pool_id: '$_id'
    }
  })

  return pipeline
}

function buildTaskMatchStage(params: TaskQueryParams): Record<string, unknown> {
  const taskMatchStage: Record<string, unknown> = {}

  if (params.categories) {
    try {
      const categoriesArray =
        typeof params.categories === 'string' ? params.categories.split(',') : params.categories
      if (Array.isArray(categoriesArray) && categoriesArray.length > 0) {
        taskMatchStage['tasks.categories'] = { $in: categoriesArray }
      }
    } catch (e) {
      logger.error('Error parsing categories parameter:', e)
    }
  }

  if (params.query && typeof params.query === 'string') {
    const searchRegex = new RegExp(params.query, 'i')
    taskMatchStage.$or = [
      { 'tasks.prompt': searchRegex },
      { 'tasks.apps_used.name': searchRegex }
    ]
  }

  if (params.hide_adult === 'true') {
    const adultRegex = ADULT_KEYWORDS.join('|')
    taskMatchStage.$and = [
      { 'tasks.prompt': { $not: { $regex: adultRegex, $options: 'i' } } },
      { 'tasks.apps_used.name': { $not: { $regex: adultRegex, $options: 'i' } } },
      {
        $or: [
          { 'tasks.apps_used.description': { $exists: false } },
          { 'tasks.apps_used.description': { $not: { $regex: adultRegex, $options: 'i' } } }
        ]
      }
    ]
  }

  return taskMatchStage
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
    // Aggregate to get unique categories across all factories' tasks
    const categoriesResult = await FactoryModel.aggregate([
      { $unwind: '$tasks' },
      { $unwind: '$tasks.categories' },
      { $match: { 'tasks.categories': { $type: 'string' } } },
      { $group: { _id: { $trim: { input: '$tasks.categories' } } } },
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
 * /forge/factories/workflows:
 *   post:
 *     summary: Generate new workflow tasks for factories
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
 *                 description: Optional factory ID to add generated tasks to
 *             required:
 *               - prompt
 */
router.post(
  '/workflows',
  requireWalletAddress,
  validateBody(generateContentSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { prompt, factoryId } = req.body
    // @ts-expect-error
    const ownerAddress = req.walletAddress?.toLowerCase()

    // If factoryId provided, verify factory exists and user is authorized
    if (factoryId) {
      const factory = await FactoryModel.findById(factoryId)
      if (!factory) {
        throw ApiError.notFound('Factory not found')
      }
      if (factory.ownerAddress !== ownerAddress) {
        throw ApiError.forbidden('Not authorized to modify this factory')
      }
    }

    // Generate new workflow tasks using OpenAI
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
    logger.debug('Response:', response)
    const content = response.choices[0].message.content
    logger.debug('Content:', content)
    if (!content) {
      throw new Error('Empty response from OpenAI')
    }

    // Parse JSON content and optionally save to factory
    try {
      const parsedContent: WorkflowGenerationResult = JSON.parse(content)
      logger.debug('Parsed content:', parsedContent)

      // If factoryId is provided, add tasks to the factory
      if (factoryId) {
        // Generate IDs for new tasks
        const tasksWithIds = parsedContent.tasks.map((task) => ({
          ...task,
          id: `task_${randomUUID()}`
        }))

        await FactoryModel.findByIdAndUpdate(factoryId, {
          $push: { tasks: { $each: tasksWithIds } }
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
    logger.debug('Response:', response)
    const content = response.choices[0].message.content
    logger.debug('Content:', content)
    if (!content) {
      throw new Error('Empty response from OpenAI')
    }

    // Parse JSON content and optionally save to factory
    try {
      const parsedContent = JSON.parse(content)
      logger.debug('Parsed content:', parsedContent)

      // Note: This endpoint maintains compatibility with the old apps structure
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
        categories: taskData.categories,
        task_name: taskData.task_name,
        apps_used: taskData.apps_used,
        objectives: taskData.objectives,
        uploadLimitReached: limitInfo.taskLimitReached,
        currentSubmissions: limitInfo.taskSubmissions,
        limitReason: limitInfo.limitReason,
        factoryId: taskData.factoryId,
        pool_id: taskData.pool_id
      })
    }

    res.status(200).json(successResponse(tasks))
  })
)

/**
 * @swagger
 * /forge/factories/apps:
 *   get:
 *     summary: Get all apps with filtering options (reconstructed from tasks)
 *     tags: [Apps]
 */
router.get(
  '/',
  validateQuery(getTasksSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { pool_id, categories, query } = req.query as TaskQueryParams

    // Build aggregation pipeline to reconstruct apps view from tasks
    const pipeline: MongoAggregationPipeline = []

    // Match stage - filter factories
    const matchStage: MongoMatchStage = {}
    if (pool_id) {
      matchStage._id = pool_id.toString()
    } else {
      matchStage.status = FactoryStatus.active
    }
    pipeline.push({ $match: matchStage })

    // Unwind tasks and apps_used to create app-centric view
    pipeline.push({ $unwind: { path: '$tasks', preserveNullAndEmptyArrays: false } })
    pipeline.push({ $unwind: { path: '$tasks.apps_used', preserveNullAndEmptyArrays: false } })

    // Filter by categories and query
    const taskFilterStage: MongoMatchStage = {}
    if (categories) {
      try {
        const categoriesArray = typeof categories === 'string' ? categories.split(',') : categories
        if (Array.isArray(categoriesArray) && categoriesArray.length > 0) {
          taskFilterStage['tasks.categories'] = { $in: categoriesArray }
        }
      } catch (e) {
        logger.error('Error parsing categories parameter:', e)
      }
    }

    if (query && typeof query === 'string') {
      const searchRegex = new RegExp(query, 'i')
      taskFilterStage.$or = [
        { 'tasks.apps_used.name': searchRegex },
        { 'tasks.prompt': searchRegex }
      ]
    }

    if (Object.keys(taskFilterStage).length > 0) {
      pipeline.push({ $match: taskFilterStage })
    }

    // Group by app to reconstruct app-centric view
    pipeline.push({
      $group: {
        _id: {
          app_name: '$tasks.apps_used.name',
          app_domain: '$tasks.apps_used.domain',
          pool_id: '$_id'
        },
        name: { $first: '$tasks.apps_used.name' },
        domain: { $first: '$tasks.apps_used.domain' },
        description: { $first: '$tasks.apps_used.description' },
        categories: { $addToSet: '$tasks.categories' },
        tasks: {
          $push: {
            id: '$tasks.id',
            prompt: '$tasks.prompt',
            uploadLimit: '$tasks.uploadLimit',
            rewardLimit: '$tasks.rewardLimit',
            categories: '$tasks.categories',
            objectives: '$tasks.objectives'
          }
        },
        pool_id: { $first: '$_id' }
      }
    })

    // Project final structure
    pipeline.push({
      $project: {
        _id: { $concat: ['app_', '$name'] },
        name: 1,
        domain: 1,
        description: 1,
        categories: { $reduce: { input: '$categories', initialValue: [], in: { $setUnion: ['$$value', '$$this'] } } },
        tasks: 1,
        pool_id: 1
      }
    })

    pipeline.push({ $limit: 500 })

    const appsFromDB = await FactoryModel.aggregate(pipeline)

    if (appsFromDB.length === 0) {
      return res.status(200).json(successResponse([]))
    }

    // Collect all task IDs for batch submission counting
    const allTaskIds: string[] = []
    appsFromDB.forEach(app => {
      app.tasks.forEach((task: any) => {
        allTaskIds.push(task.id)
      })
    })

    // Fetch all submission counts in one query
    const submissionMap = allTaskIds.length > 0 ? await fetchSubmissionCounts(allTaskIds) : new Map<string, number>()

    // Process apps with task limit information
    const appsWithLimitInfo = appsFromDB.map(app => {
      const tasksWithLimitInfo = app.tasks.map((task: any) => {
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
 * /forge/factories/{id}/workflows:
 *   put:
 *     summary: Update factory workflow tasks
 *     tags: [Apps]
 */
router.put(
  '/:id/workflows',
  requireWalletAddress,
  validateParams(factoryIdParamSchema),
  validateBody(updateFactoryWorkflowsSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { id } = req.params
    const { tasks } = req.body

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

    // Generate IDs only for new tasks (preserve existing IDs)
    const tasksWithIds = tasks.map((task: any) => ({
      ...task,
      // Only generate new ID if task doesn't have one
      id: task.id || `task_${randomUUID()}`,
      // Convert rewardLimit to Decimal128 if it exists
      rewardLimit: task.rewardLimit !== undefined
        ? Types.Decimal128.fromString(task.rewardLimit.toString())
        : undefined
    }))

    // Update the factory tasks
    factory.tasks = tasksWithIds as any
    await factory.save()

    // Return updated factory
    const updatedFactory = await FactoryModel.findById(id)
    res.json(successResponse(updatedFactory?.toJSON()))
  })
)

/**
 * @swagger
 * /forge/factories/apps/{id}:
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

    // Generate IDs only for new apps and tasks (preserve existing IDs)
    const appsWithIds = apps.map((app: any) => ({
      ...app,
      // Only generate new ID if app doesn't have one
      id: app.id || `app_${randomUUID()}`,
      tasks: app.tasks?.map((task: any) => ({
        ...task,
        // Only generate new ID if task doesn't have one
        id: task.id || `task_${randomUUID()}`,
        // Convert rewardLimit to Decimal128 if it exists
        rewardLimit: task.rewardLimit !== undefined
          ? Types.Decimal128.fromString(task.rewardLimit.toString())
          : undefined
      })) || []
    }))

    // Update the factory tasks
    factory.tasks = appsWithIds as any
    await factory.save()

    // Return updated factory
    const updatedFactory = await FactoryModel.findById(id)
    res.json(successResponse(updatedFactory?.toJSON()))
  })
)

/**
 * @swagger
 * /forge/factories/apps/alternatives/{identifier}:
 *   get:
 *     summary: Get alternative apps for a given app by name or domain
 *     tags: [Apps]
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema:
 *           type: string
 *         description: Name or domain of the app to find alternatives for
 *       - in: query
 *         name: categories
 *         schema:
 *           type: string
 *         description: Comma-separated list of categories to filter by (open_source, webapp, desktop, api)
 */
router.get(
  '/alternatives/:identifier',
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { identifier } = req.params
    const { categories } = req.query as { categories?: string }

    // Try to find by name first (case-insensitive), then fallback to domain
    let app = await AppModel.findOne({ nameLowercase: identifier.toLowerCase() })

    if (!app) {
      // Fallback: try to find by domain
      app = await AppModel.findOne({ domain: identifier.toLowerCase() })
    }

    if (!app) {
      throw ApiError.notFound(`App with identifier '${identifier}' not found`)
    }

    // Find all relations for this app
    const relations = await AppRelationModel.find({ appId: app._id })
      .sort({ relevanceScore: -1 })
      .lean()

    if (relations.length === 0) {
      return res.status(200).json(successResponse([]))
    }

    // Get alternative app IDs
    const alternativeIds = relations.map((rel) => rel.alternativeId)

    // Build query to fetch full app details for alternatives
    const query: Record<string, unknown> = {
      _id: { $in: alternativeIds }
    }

    // Filter by categories if specified
    if (categories) {
      const categoryArray = categories.split(',')
      query.categories = { $in: categoryArray }
    }

    // Fetch alternative apps with full details
    const alternativeApps = await AppModel.find(query).lean()

    // Map to include relevance scores from relations
    const alternativesWithScores = alternativeApps.map((altApp) => {
      const relation = relations.find((rel) => rel.alternativeId === altApp._id)
      return {
        id: altApp._id,
        name: altApp.name,
        domain: altApp.domain,
        description: altApp.description,
        categories: altApp.categories,
        relevanceScore: relation?.relevanceScore || 50
      }
    })

    // Sort by relevance score descending
    alternativesWithScores.sort((a, b) => b.relevanceScore - a.relevanceScore)

    res.status(200).json(successResponse(alternativesWithScores))
  })
)

/**
 * @swagger
 * /forge/factories/apps/increment-usage/{identifier}:
 *   post:
 *     summary: Increment usage count for an app (called when app is selected in a task)
 *     tags: [Apps]
 *     parameters:
 *       - in: path
 *         name: identifier
 *         required: true
 *         schema:
 *           type: string
 *         description: Name or domain of the app
 */
router.post(
  '/increment-usage/:identifier',
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { identifier } = req.params

    // Try to find by name first (case-insensitive), then fallback to domain
    let app = await AppModel.findOneAndUpdate(
      { nameLowercase: identifier.toLowerCase() },
      { $inc: { usageCount: 1 } },
      { new: true }
    )

    if (!app) {
      // Fallback: try to find by domain
      app = await AppModel.findOneAndUpdate(
        { domain: identifier.toLowerCase() },
        { $inc: { usageCount: 1 } },
        { new: true }
      )
    }

    if (!app) {
      throw ApiError.notFound(`App with identifier '${identifier}' not found`)
    }

    res.status(200).json(successResponse({ usageCount: app.usageCount }))
  })
)

export { router as forgeFactoryAppsApi }
