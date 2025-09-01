import express, { type Request, type Response, type Router } from 'express'
import OpenAI from 'openai'
import { errorHandlerAsync } from '../../middleware/errorHandler.ts'
import { ApiError, ErrorCode, successResponse } from '../../middleware/types/errors.ts'
import { validateBody, validateQuery } from '../../middleware/validator.ts'
import { DemonstrationSubmission, FactoryModel } from '../../models/Models.ts'
import { APP_TASK_GENERATION_PROMPT } from '../../services/forge/index.ts'
import {
  type AppWithLimitInfo,
  FactoryStatus,
  type FactoryTask,
  ForgeSubmissionProcessingStatus,
  type TaskWithLimitInfo,
  UploadLimitType
} from '../../types/factory.ts'
import { generateContentSchema, getTasksSchema } from '../schemas/forgeFactory.ts'

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

function _buildMatchStage(pool_id?: string, min_reward?: number, max_reward?: number) {
  const matchStage: MongoMatchStage = {}

  if (pool_id) {
    matchStage._id = pool_id.toString()
  } else {
    matchStage.status = FactoryStatus.active
  }

  if (min_reward !== undefined || max_reward !== undefined) {
    const priceFilter: Record<string, number> = {}
    if (min_reward !== undefined) {
      priceFilter.$gte = min_reward
    }
    if (max_reward !== undefined) {
      priceFilter.$lte = max_reward
    }
    matchStage.pricePerDemo = priceFilter
  }

  return matchStage
}

function _buildCategoryFilter(categories?: string): Record<string, unknown> | null {
  if (!categories) return null

  const categoryList = categories.split(',').map((cat) => cat.trim().toLowerCase())
  return {
    $or: [{ 'apps.categories': { $in: categoryList } }, { skills: { $in: categoryList } }]
  }
}

function _buildSearchFilter(query?: string): Record<string, unknown> | null {
  if (!query || query.trim().length < 2) return null

  const searchRegex = new RegExp(query.trim(), 'i')
  return {
    $or: [
      { name: searchRegex },
      { description: searchRegex },
      { skills: searchRegex },
      { 'apps.name': searchRegex },
      { 'apps.description': searchRegex },
      { 'apps.categories': searchRegex }
    ]
  }
}

interface TaskQueryParams {
  pool_id?: string
  min_reward?: string
  max_reward?: string
  categories?: string | string[]
  query?: string
  hide_adult?: string
}

interface TaskLimitInfo {
  taskLimitReached: boolean
  taskSubmissions: number
  limitReason: string | null
}

interface SubmissionMaps {
  daily: Map<string, number>
  total: Map<string, number>
  byTask: Map<string, number>
}

interface MongoMatchFilter {
  _id?: string
  status?: string
  pricePerDemo?: {
    $gte?: number
    $lte?: number
  }
}

function buildFactoryMatchStage(params: TaskQueryParams): MongoMatchFilter {
  const matchStage: MongoMatchFilter = {}

  if (params.pool_id) {
    matchStage._id = params.pool_id.toString()
  } else {
    matchStage.status = FactoryStatus.active
  }

  if (params.min_reward !== undefined || params.max_reward !== undefined) {
    const priceFilter: Record<string, number> = {}
    if (params.min_reward !== undefined) {
      priceFilter.$gte = Number(params.min_reward)
    }
    if (params.max_reward !== undefined) {
      priceFilter.$lte = Number(params.max_reward)
    }
    matchStage.pricePerDemo = priceFilter
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
      console.error('Error parsing categories parameter:', e)
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
      pricePerDemo: '$pricePerDemo',
      uploadLimitType: '$uploadLimit.type',
      uploadLimitValue: '$uploadLimit.value',
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
  factoryIds: string[],
  taskIds: string[]
): Promise<SubmissionMaps> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [dailySubmissions, totalSubmissions, taskSubmissionsList] = await Promise.all([
    DemonstrationSubmission.aggregate([
      {
        $match: {
          'meta.quest.pool_id': { $in: factoryIds },
          createdAt: { $gte: today },
          status: ForgeSubmissionProcessingStatus.COMPLETED,
          reward: { $gt: 0 }
        }
      },
      { $group: { _id: '$meta.quest.pool_id', count: { $sum: 1 } } }
    ]),
    DemonstrationSubmission.aggregate([
      {
        $match: {
          'meta.quest.pool_id': { $in: factoryIds },
          status: ForgeSubmissionProcessingStatus.COMPLETED,
          reward: { $gt: 0 }
        }
      },
      { $group: { _id: '$meta.quest.pool_id', count: { $sum: 1 } } }
    ]),
    DemonstrationSubmission.aggregate([
      {
        $match: {
          'meta.quest.task_id': { $in: taskIds },
          status: ForgeSubmissionProcessingStatus.COMPLETED,
          reward: { $gt: 0 }
        }
      },
      { $group: { _id: '$meta.quest.task_id', count: { $sum: 1 } } }
    ])
  ])

  return {
    daily: new Map(dailySubmissions.map((item) => [item._id.toString(), item.count])),
    total: new Map(totalSubmissions.map((item) => [item._id.toString(), item.count])),
    byTask: new Map(taskSubmissionsList.map((item) => [item._id.toString(), item.count]))
  }
}

function checkGymLimits(
  taskData: Record<string, any>,
  submissionMaps: SubmissionMaps
): {
  gymLimitReached: boolean
  gymSubmissions: number
} {
  if (!taskData.uploadLimitValue) {
    return { gymLimitReached: false, gymSubmissions: 0 }
  }

  const factoryId = taskData.factoryId.toString()
  let gymSubmissions = 0

  switch (taskData.uploadLimitType) {
    case UploadLimitType.perDay:
      gymSubmissions = submissionMaps.daily.get(factoryId) || 0
      break
    case UploadLimitType.total:
      gymSubmissions = submissionMaps.total.get(factoryId) || 0
      break
  }

  return {
    gymLimitReached: gymSubmissions >= taskData.uploadLimitValue,
    gymSubmissions
  }
}

function checkTaskSpecificLimits(
  taskData: Record<string, any>,
  submissionMaps: SubmissionMaps
): {
  taskLimitReached: boolean
  taskSubmissions: number
  limitReason: string | null
} {
  const hasTaskLimit =
    taskData.uploadLimit ||
    (taskData.uploadLimitType === UploadLimitType.perTask && taskData.uploadLimitValue)

  if (!hasTaskLimit) {
    return { taskLimitReached: false, taskSubmissions: 0, limitReason: null }
  }

  const taskSubmissions = submissionMaps.byTask.get(taskData._id.toString()) || 0

  if (taskData.uploadLimit && taskSubmissions >= taskData.uploadLimit) {
    return { taskLimitReached: true, taskSubmissions, limitReason: 'Task limit reached' }
  }

  if (
    taskData.uploadLimitType === UploadLimitType.perTask &&
    taskData.uploadLimitValue &&
    taskSubmissions >= taskData.uploadLimitValue
  ) {
    return { taskLimitReached: true, taskSubmissions, limitReason: 'Per-task gym limit reached' }
  }

  return { taskLimitReached: false, taskSubmissions, limitReason: null }
}

function calculateTaskLimits(
  taskData: Record<string, any>,
  submissionMaps: SubmissionMaps
): TaskLimitInfo {
  const gymCheck = checkGymLimits(taskData, submissionMaps)
  const taskCheck = checkTaskSpecificLimits(taskData, submissionMaps)

  if (gymCheck.gymLimitReached) {
    return {
      taskLimitReached: true,
      taskSubmissions: taskCheck.taskSubmissions,
      limitReason:
        taskData.uploadLimitType === UploadLimitType.perDay
          ? 'Daily gym limit reached'
          : 'Total gym limit reached'
    }
  }

  return taskCheck
}

async function _processTasksWithLimitInfo(app: Record<string, any>, _submissions: any[]) {
  return Promise.all(
    app.tasks.map(async (task: FactoryTask) => {
      let taskLimitReached = false
      let taskSubmissions = 0
      let taskUniqueSubmissions = 0

      if (task.rewardLimit && task.rewardLimit > 0) {
        const taskFilter = {
          'meta.app.id': app.id,
          'meta.task': task.id
        }

        const [totalSubmissions, uniqueSubmissions] = await Promise.all([
          DemonstrationSubmission.countDocuments(taskFilter),
          DemonstrationSubmission.distinct('meta.id', taskFilter).then((docs) => docs.length)
        ])

        taskSubmissions = totalSubmissions
        taskUniqueSubmissions = uniqueSubmissions
        taskLimitReached = totalSubmissions >= task.rewardLimit
      }

      return {
        ...task,
        limitReached: taskLimitReached,
        submissions: taskSubmissions,
        uniqueSubmissions: taskUniqueSubmissions
      }
    })
  )
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

    const factoryIds = [...new Set(tasksFromDB.map((t) => t.factoryId.toString()))]
    const taskIds = tasksFromDB.map((t) => t._id.toString())
    const submissionMaps = await fetchSubmissionCounts(factoryIds, taskIds)

    const tasks = []
    for (const taskData of tasksFromDB) {
      if (params.hide_adult === 'true' && checkAdultContent(taskData.prompt)) {
        continue
      }

      const effectiveReward =
        taskData.rewardLimit !== undefined ? taskData.rewardLimit : taskData.pricePerDemo
      if (
        (params.min_reward !== undefined && (effectiveReward || 0) < Number(params.min_reward)) ||
        (params.max_reward !== undefined && (effectiveReward || 0) > Number(params.max_reward))
      ) {
        continue
      }

      const limitInfo = calculateTaskLimits(taskData, submissionMaps)
      const gymSubmissions =
        submissionMaps.daily.get(taskData.factoryId.toString()) ||
        submissionMaps.total.get(taskData.factoryId.toString()) ||
        0

      tasks.push({
        _id: taskData._id,
        prompt: taskData.prompt,
        uploadLimit: taskData.uploadLimit,
        rewardLimit: taskData.rewardLimit,
        uploadLimitReached: limitInfo.taskLimitReached,
        currentSubmissions: limitInfo.taskSubmissions,
        limitReason: limitInfo.limitReason,
        app: {
          ...taskData.app,
          gymLimitType: taskData.uploadLimitType,
          gymSubmissions: gymSubmissions,
          gymLimitValue: taskData.uploadLimitValue
        }
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
    const { pool_id, min_reward, max_reward, categories, query } = req.query

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

    // Apply reward filtering at factory level
    if (min_reward !== undefined || max_reward !== undefined) {
      if (min_reward !== undefined) {
        matchStage.pricePerDemo = { $gte: Number(min_reward) }
      }
      if (max_reward !== undefined) {
        matchStage.pricePerDemo = {
          ...(matchStage.pricePerDemo || {}),
          $lte: Number(max_reward)
        }
      }
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
        console.error('Error parsing categories parameter:', e)
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
        factoryId: '$_id',
        pricePerDemo: '$pricePerDemo',
        uploadLimit: '$uploadLimit',
        pool_id: '$_id'
      }
    })

    const appsFromDB = await FactoryModel.aggregate(pipeline)

    // Process apps and calculate limits
    const appsWithLimitInfo = await Promise.all(
      appsFromDB.map(async (app) => {
        // Create app object with limit info
        const appObj: AppWithLimitInfo = {
          _id: app._id,
          name: app.name,
          domain: app.domain,
          description: app.description,
          categories: app.categories,
          tasks: app.tasks,
          pool_id: app.pool_id,
          gymLimitReached: false,
          gymSubmissions: 0,
          gymLimitType: undefined,
          gymLimitValue: undefined
        }

        // Check factory-wide upload limit
        let gymLimitReached = false
        let gymSubmissions = 0

        if (app.uploadLimit?.value) {
          switch (app.uploadLimit.type) {
            case UploadLimitType.perDay: {
              const today = new Date()
              today.setHours(0, 0, 0, 0)
              gymSubmissions = await DemonstrationSubmission.countDocuments({
                'meta.quest.pool_id': app.factoryId,
                createdAt: { $gte: today },
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                reward: { $gt: 0 }
              })
              gymLimitReached = gymSubmissions >= app.uploadLimit.value
              break
            }

            case UploadLimitType.total:
              gymSubmissions = await DemonstrationSubmission.countDocuments({
                'meta.quest.pool_id': app.factoryId,
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                reward: { $gt: 0 }
              })
              gymLimitReached = gymSubmissions >= app.uploadLimit.value
              break
          }
        }

        // Add factory limit info to app object
        appObj.gymLimitReached = gymLimitReached
        appObj.gymSubmissions = gymSubmissions
        appObj.gymLimitType = app.uploadLimit?.type
        appObj.gymLimitValue = app.uploadLimit?.value

        // Process tasks and add limit information
        const tasksWithLimitInfo = await Promise.all(
          app.tasks.map(async (task: FactoryTask) => {
            let taskLimitReached = false
            let taskSubmissions = 0
            let limitReason: string | null = null

            // Count submissions for this specific task
            if (
              task.uploadLimit ||
              (app.uploadLimit?.type === UploadLimitType.perTask && app.uploadLimit?.value)
            ) {
              taskSubmissions = await DemonstrationSubmission.countDocuments({
                'meta.quest.task_id': task.id,
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                reward: { $gt: 0 }
              })

              // Check if task has reached its limit
              if (task.uploadLimit && taskSubmissions >= task.uploadLimit) {
                taskLimitReached = true
                limitReason = 'Task limit reached'
              }

              // Check factory-wide per-task limit if applicable
              if (
                !taskLimitReached &&
                app.uploadLimit?.type === UploadLimitType.perTask &&
                app.uploadLimit?.value &&
                taskSubmissions >= app.uploadLimit.value
              ) {
                taskLimitReached = true
                limitReason = 'Per-task gym limit reached'
              }
            }

            // If factory limit is reached, mark all tasks as limited
            if (gymLimitReached) {
              taskLimitReached = true
              limitReason =
                app.uploadLimit?.type === UploadLimitType.perDay
                  ? 'Daily gym limit reached'
                  : 'Total gym limit reached'
            }

            // Add limit info to task object
            return {
              _id: task.id,
              ...task,
              uploadLimitReached: taskLimitReached,
              currentSubmissions: taskSubmissions,
              limitReason: limitReason
            } as TaskWithLimitInfo
          })
        )

        // Return app with all tasks and limit information
        return {
          ...appObj,
          tasks: tasksWithLimitInfo
        }
      })
    )

    // Return all apps with limit information
    res.status(200).json(successResponse(appsWithLimitInfo))
  })
)

export { router as forgeFactoryAppsApi }
