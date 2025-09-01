import express, { Request, Response, Router } from 'express';
import { errorHandlerAsync } from '../../middleware/errorHandler.ts';
import { DemonstrationSubmission, FactoryModel } from '../../models/Models.ts';
import { ApiError, ErrorCode, successResponse } from '../../middleware/types/errors.ts';
import { validateBody, validateQuery } from '../../middleware/validator.ts';
import { generateContentSchema, getTasksSchema } from '../schemas/forgeFactory.ts';
import { APP_TASK_GENERATION_PROMPT } from '../../services/forge/index.ts';
import OpenAI from 'openai';
import {
  AppWithLimitInfo,
  ForgeSubmissionProcessingStatus,
  TaskWithLimitInfo,
  UploadLimitType
} from '../../types/index.ts';
import { FactoryStatus } from '../../types/factory.ts';

const router: Router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});



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
      { $group: { _id: '$apps.categories' } },
      { $sort: { _id: 1 } }
    ]);

    // Format the result as an array of category names
    const categories = categoriesResult.map((item) => item._id);

    res.status(200).json(successResponse(categories));
  })
);

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
    const { prompt, factoryId } = req.body;

    // Generate new apps using OpenAI
    const formatted_prompt = APP_TASK_GENERATION_PROMPT.replace('{skill list}', prompt);
    const response = await openai.chat.completions.create({
      model: 'o3-mini',
      reasoning_effort: 'medium',
      messages: [
        {
          role: 'user',
          content: formatted_prompt
        }
      ]
    } as any); // Type assertion to handle custom model params

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    // Parse JSON content and optionally save to factory
    try {
      const parsedContent = JSON.parse(content);

      // If factoryId is provided, add apps to the factory
      if (factoryId) {
        await FactoryModel.findByIdAndUpdate(
          factoryId,
          { $push: { apps: { $each: parsedContent.apps } } }
        );
      }

      res.status(200).json(
        successResponse({
          content: parsedContent
        })
      );
    } catch (parseError) {
      throw new ApiError(500, ErrorCode.INTERNAL_SERVER_ERROR, 'Failed to parse content as JSON', {
        content
      });
    }
  })
);

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
];

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
    const { pool_id, min_reward, max_reward, categories, query, hide_adult } = req.query;

    // Function to check if text contains adult content
    const containsAdultContent = (text: string): boolean => {
      const lowerText = text.toLowerCase();
      return ADULT_KEYWORDS.some((keyword) => lowerText.includes(keyword.toLowerCase()));
    };

    // Build aggregation pipeline for factories
    const pipeline: any[] = [];

    // Match stage - filter factories
    const matchStage: any = {};

    // Filter by pool_id (factory _id) if specified
    if (pool_id) {
      matchStage._id = pool_id.toString();
    } else {
      // Only include active factories if no specific pool_id
      matchStage.status = FactoryStatus.active;
    }

    // Apply reward filtering at factory level
    if (min_reward !== undefined || max_reward !== undefined) {
      if (min_reward !== undefined) {
        matchStage.pricePerDemo = { $gte: Number(min_reward) };
      }
      if (max_reward !== undefined) {
        matchStage.pricePerDemo = {
          ...matchStage.pricePerDemo,
          $lte: Number(max_reward)
        };
      }
    }

    pipeline.push({ $match: matchStage });

    // Unwind apps and tasks
    pipeline.push({ $unwind: '$apps' });
    pipeline.push({ $unwind: '$apps.tasks' });

    // Filter apps and tasks
    const appTaskMatchStage: any = {};

    // Filter by categories if specified
    if (categories) {
      try {
        const categoriesArray = typeof categories === 'string' ? categories.split(',') : categories;
        if (Array.isArray(categoriesArray) && categoriesArray.length > 0) {
          appTaskMatchStage['apps.categories'] = { $in: categoriesArray };
        }
      } catch (e) {
        console.error('Error parsing categories parameter:', e);
      }
    }

    // Text search for app name and task prompts
    if (query && typeof query === 'string') {
      const searchRegex = new RegExp(query, 'i');
      appTaskMatchStage.$or = [
        { 'apps.name': searchRegex },
        { 'apps.tasks.prompt': searchRegex }
      ];
    }

    // Hide adult content filter
    if (hide_adult === 'true') {
      const adultRegex = ADULT_KEYWORDS.join('|');
      appTaskMatchStage.$and = [
        { 'apps.name': { $not: { $regex: adultRegex, $options: 'i' } } },
        { 'apps.tasks.prompt': { $not: { $regex: adultRegex, $options: 'i' } } },
        {
          $or: [
            { 'apps.description': { $exists: false } },
            { 'apps.description': { $not: { $regex: adultRegex, $options: 'i' } } }
          ]
        }
      ];
    }

    if (Object.keys(appTaskMatchStage).length > 0) {
      pipeline.push({ $match: appTaskMatchStage });
    }

    // Add pagination to prevent DoS - limit to 1000 tasks max
    pipeline.push({ $limit: 1000 });

    // Project the required fields
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
    });

    const tasksFromDB = await FactoryModel.aggregate(pipeline);

    // Process tasks and calculate limits
    const tasks = [];

    for (const taskData of tasksFromDB) {
      // Skip tasks with adult content if hide_adult is true (already filtered in pipeline but double check)
      if (hide_adult === 'true' && containsAdultContent(taskData.prompt)) {
        continue;
      }

      // Determine the effective reward for this task
      const effectiveReward = taskData.rewardLimit !== undefined ? taskData.rewardLimit : taskData.pricePerDemo;

      // Apply additional reward filtering (already done in pipeline but double check for task-specific rewards)
      if (
        (min_reward !== undefined && (effectiveReward || 0) < Number(min_reward)) ||
        (max_reward !== undefined && (effectiveReward || 0) > Number(max_reward))
      ) {
        continue;
      }

      // Calculate factory-wide upload limits
      let gymLimitReached = false;
      let gymSubmissions = 0;

      if (taskData.uploadLimitValue) {
        switch (taskData.uploadLimitType) {
          case UploadLimitType.perDay:
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            gymSubmissions = await DemonstrationSubmission.countDocuments({
              'meta.quest.pool_id': taskData.factoryId,
              createdAt: { $gte: today },
              status: ForgeSubmissionProcessingStatus.COMPLETED,
              reward: { $gt: 0 }
            });
            gymLimitReached = gymSubmissions >= taskData.uploadLimitValue;
            break;

          case UploadLimitType.total:
            gymSubmissions = await DemonstrationSubmission.countDocuments({
              'meta.quest.pool_id': taskData.factoryId,
              status: ForgeSubmissionProcessingStatus.COMPLETED,
              reward: { $gt: 0 }
            });
            gymLimitReached = gymSubmissions >= taskData.uploadLimitValue;
            break;
        }
      }

      // Calculate task-specific limits
      let taskLimitReached = false;
      let taskSubmissions = 0;
      let limitReason: string | null = null;

      // Count submissions for this specific task
      if (
        taskData.uploadLimit ||
        (taskData.uploadLimitType === UploadLimitType.perTask && taskData.uploadLimitValue)
      ) {
        taskSubmissions = await DemonstrationSubmission.countDocuments({
          'meta.quest.task_id': taskData._id,
          status: ForgeSubmissionProcessingStatus.COMPLETED,
          reward: { $gt: 0 }
        });

        // Check if task has reached its limit
        if (taskData.uploadLimit && taskSubmissions >= taskData.uploadLimit) {
          taskLimitReached = true;
          limitReason = 'Task limit reached';
        }

        // Check factory-wide per-task limit if applicable
        if (
          !taskLimitReached &&
          taskData.uploadLimitType === UploadLimitType.perTask &&
          taskData.uploadLimitValue &&
          taskSubmissions >= taskData.uploadLimitValue
        ) {
          taskLimitReached = true;
          limitReason = 'Per-task gym limit reached';
        }
      }

      // If factory limit is reached, mark all tasks as limited
      if (gymLimitReached) {
        taskLimitReached = true;
        limitReason =
          taskData.uploadLimitType === UploadLimitType.perDay
            ? 'Daily gym limit reached'
            : 'Total gym limit reached';
      }

      // Add task with app information to the result array
      tasks.push({
        _id: taskData._id,
        prompt: taskData.prompt,
        uploadLimit: taskData.uploadLimit,
        rewardLimit: taskData.rewardLimit,
        uploadLimitReached: taskLimitReached,
        currentSubmissions: taskSubmissions,
        limitReason: limitReason,
        app: {
          ...taskData.app,
          gymLimitType: taskData.uploadLimitType,
          gymSubmissions: gymSubmissions,
          gymLimitValue: taskData.uploadLimitValue
        }
      });
    }

    res.status(200).json(successResponse(tasks));
  })
);

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
    const { pool_id, min_reward, max_reward, categories, query } = req.query;

    // Build aggregation pipeline for factories
    const pipeline: any[] = [];

    // Match stage - filter factories
    const matchStage: any = {};

    // Filter by pool_id (factory _id) if specified
    if (pool_id) {
      matchStage._id = pool_id.toString();
    } else {
      // Only include active factories if no specific pool_id
      matchStage.status = FactoryStatus.active;
    }

    // Apply reward filtering at factory level
    if (min_reward !== undefined || max_reward !== undefined) {
      if (min_reward !== undefined) {
        matchStage.pricePerDemo = { $gte: Number(min_reward) };
      }
      if (max_reward !== undefined) {
        matchStage.pricePerDemo = {
          ...matchStage.pricePerDemo,
          $lte: Number(max_reward)
        };
      }
    }

    pipeline.push({ $match: matchStage });

    // Unwind apps
    pipeline.push({ $unwind: '$apps' });

    // Filter apps
    const appMatchStage: any = {};

    // Filter by categories if specified
    if (categories) {
      try {
        const categoriesArray = typeof categories === 'string' ? categories.split(',') : categories;
        if (Array.isArray(categoriesArray) && categoriesArray.length > 0) {
          appMatchStage['apps.categories'] = { $in: categoriesArray };
        }
      } catch (e) {
        console.error('Error parsing categories parameter:', e);
      }
    }

    // Text search for app name and task prompts
    if (query && typeof query === 'string') {
      const searchRegex = new RegExp(query, 'i');
      appMatchStage.$or = [
        { 'apps.name': searchRegex },
        { 'apps.tasks.prompt': searchRegex }
      ];
    }

    if (Object.keys(appMatchStage).length > 0) {
      pipeline.push({ $match: appMatchStage });
    }

    // Add pagination to prevent DoS - limit to 500 apps max
    pipeline.push({ $limit: 500 });

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
    });

    const appsFromDB = await FactoryModel.aggregate(pipeline);

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
        };

        // Check factory-wide upload limit
        let gymLimitReached = false;
        let gymSubmissions = 0;

        if (app.uploadLimit?.value) {
          switch (app.uploadLimit.type) {
            case UploadLimitType.perDay:
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              gymSubmissions = await DemonstrationSubmission.countDocuments({
                'meta.quest.pool_id': app.factoryId,
                createdAt: { $gte: today },
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                reward: { $gt: 0 }
              });
              gymLimitReached = gymSubmissions >= app.uploadLimit.value;
              break;

            case UploadLimitType.total:
              gymSubmissions = await DemonstrationSubmission.countDocuments({
                'meta.quest.pool_id': app.factoryId,
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                reward: { $gt: 0 }
              });
              gymLimitReached = gymSubmissions >= app.uploadLimit.value;
              break;
          }
        }

        // Add factory limit info to app object
        appObj.gymLimitReached = gymLimitReached;
        appObj.gymSubmissions = gymSubmissions;
        appObj.gymLimitType = app.uploadLimit?.type;
        appObj.gymLimitValue = app.uploadLimit?.value;

        // Process tasks and add limit information
        const tasksWithLimitInfo = await Promise.all(
          app.tasks.map(async (task: any) => {
            let taskLimitReached = false;
            let taskSubmissions = 0;
            let limitReason: string | null = null;

            // Count submissions for this specific task
            if (
              task.uploadLimit ||
              (app.uploadLimit?.type === UploadLimitType.perTask && app.uploadLimit?.value)
            ) {
              taskSubmissions = await DemonstrationSubmission.countDocuments({
                'meta.quest.task_id': task.id,
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                reward: { $gt: 0 }
              });

              // Check if task has reached its limit
              if (task.uploadLimit && taskSubmissions >= task.uploadLimit) {
                taskLimitReached = true;
                limitReason = 'Task limit reached';
              }

              // Check factory-wide per-task limit if applicable
              if (
                !taskLimitReached &&
                app.uploadLimit?.type === UploadLimitType.perTask &&
                app.uploadLimit?.value &&
                taskSubmissions >= app.uploadLimit.value
              ) {
                taskLimitReached = true;
                limitReason = 'Per-task gym limit reached';
              }
            }

            // If factory limit is reached, mark all tasks as limited
            if (gymLimitReached) {
              taskLimitReached = true;
              limitReason =
                app.uploadLimit?.type === UploadLimitType.perDay
                  ? 'Daily gym limit reached'
                  : 'Total gym limit reached';
            }

            // Add limit info to task object
            return {
              ...task,
              uploadLimitReached: taskLimitReached,
              currentSubmissions: taskSubmissions,
              limitReason: limitReason
            } as TaskWithLimitInfo;
          })
        );

        // Return app with all tasks and limit information
        return {
          ...appObj,
          tasks: tasksWithLimitInfo
        };
      })
    );

    // Return all apps with limit information
    res.status(200).json(successResponse(appsWithLimitInfo));
  })
);

export { router as forgeFactoryAppsApi };
