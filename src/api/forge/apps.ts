import express, { Request, Response, Router } from 'express';
import { errorHandlerAsync } from '../../middleware/errorHandler.ts';
import { ForgeAppModel, ForgeRaceSubmission, TrainingPoolModel } from '../../models/Models.ts';
import { ApiError, ErrorCode, successResponse } from '../../middleware/types/errors.ts';
import { validateBody, validateQuery } from '../../middleware/validator.ts';
import { generateContentSchema, getTasksSchema } from '../schemas/forge.ts';
import { APP_TASK_GENERATION_PROMPT } from '../../services/forge/index.ts';
import OpenAI from 'openai';
import {
  AppWithLimitInfo,
  DBTrainingPool,
  ForgeSubmissionProcessingStatus,
  TaskWithLimitInfo,
  TrainingPoolStatus,
  UploadLimitType
} from '../../types/index.ts';

const router: Router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Get all possible categories
router.get(
  '/categories',
  errorHandlerAsync(async (_req: Request, res: Response) => {
    // Aggregate to get unique categories across all apps
    const categoriesResult = await ForgeAppModel.aggregate([
      { $unwind: '$categories' },
      { $group: { _id: '$categories' } },
      { $sort: { _id: 1 } }
    ]);

    // Format the result as an array of category names
    const categories = categoriesResult.map((item) => item._id);

    res.status(200).json(successResponse(categories));
  })
);
// Generate apps endpoint
router.post(
  '/',
  validateBody(generateContentSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { prompt } = req.body;

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

    // Parse JSON content
    try {
      const parsedContent = JSON.parse(content);
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

// Get all tasks with filtering options
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

    // Build initial query for apps
    let appQuery: any = {};

    // If hide_adult is true, filter out apps with adult content in name or description
    if (hide_adult === 'true') {
      appQuery.$and = [
        { name: { $not: { $regex: ADULT_KEYWORDS.join('|'), $options: 'i' } } },
        {
          $or: [
            { description: { $exists: false } },
            { description: { $not: { $regex: ADULT_KEYWORDS.join('|'), $options: 'i' } } }
          ]
        }
      ];
    }

    // Filter by pool_id if specified
    if (pool_id) {
      appQuery.pool_id = pool_id.toString();
    }

    // Filter by categories if specified
    if (categories) {
      try {
        const categoriesArray = typeof categories === 'string' ? categories.split(',') : categories;

        if (Array.isArray(categoriesArray) && categoriesArray.length > 0) {
          appQuery.categories = { $in: categoriesArray };
        }
      } catch (e) {
        console.error('Error parsing categories parameter:', e);
      }
    }

    // Text search for app name and task prompts
    if (query && typeof query === 'string') {
      const searchRegex = new RegExp(query, 'i');
      appQuery.$or = [{ name: searchRegex }, { 'tasks.prompt': searchRegex }];
    }

    // Get all apps matching the initial query
    let apps = await ForgeAppModel.find(appQuery).populate(
      'pool_id',
      'name status pricePerDemo uploadLimit'
    );

    // Filter by live pools if no specific pool_id was provided
    if (!pool_id) {
      apps = apps.filter((app) => {
        const pool = app.pool_id as unknown as DBTrainingPool;
        return pool && pool.status === TrainingPoolStatus.live;
      });
    }

    // Process apps to extract tasks and apply reward filtering
    const tasks = [];

    for (const app of apps) {
      const pool = app.pool_id as unknown as DBTrainingPool;

      // Check gym-wide upload limit
      let gymLimitReached = false;
      let gymSubmissions = 0;

      if (pool.uploadLimit?.type) {
        const poolId = (pool as any)._id.toString();

        switch (pool.uploadLimit.limitType) {
          case UploadLimitType.perDay:
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            gymSubmissions = await ForgeRaceSubmission.countDocuments({
              'meta.quest.pool_id': poolId,
              createdAt: { $gte: today },
              status: ForgeSubmissionProcessingStatus.COMPLETED,
              reward: { $gt: 0 }
            });

            // Check if gym has reached daily limit
            gymLimitReached = gymSubmissions >= pool.uploadLimit.type;
            break;

          case UploadLimitType.total:
            gymSubmissions = await ForgeRaceSubmission.countDocuments({
              'meta.quest.pool_id': poolId,
              status: ForgeSubmissionProcessingStatus.COMPLETED,
              reward: { $gt: 0 }
            });

            // Check if gym has reached total limit
            gymLimitReached = gymSubmissions >= pool.uploadLimit.type;
            break;
        }
      }

      // Process each task in the app
      for (const task of app.tasks) {
        // Skip tasks marked as adult content or containing adult keywords when hide_adult is true
        if (hide_adult === 'true' && containsAdultContent(task.prompt)) {
          continue;
        }
        // Determine the effective reward for this task
        // First check if task has a specific rewardLimit, otherwise use pool's pricePerDemo
        const effectiveReward =
          task.rewardLimit !== undefined ? task.rewardLimit : pool.pricePerDemo;

        // Apply reward filtering
        if (
          (min_reward !== undefined && (effectiveReward || 0) < Number(min_reward)) ||
          (max_reward !== undefined && (effectiveReward || 0) > Number(max_reward))
        ) {
          // Skip this task if it doesn't meet the reward criteria
          continue;
        }

        // Calculate task limit information
        let taskLimitReached = false;
        let taskSubmissions = 0;
        let limitReason: string | null = null;

        // Count submissions for this specific task
        if (
          task.uploadLimit ||
          (pool.uploadLimit?.limitType === UploadLimitType.perTask && pool.uploadLimit?.type)
        ) {
          taskSubmissions = await ForgeRaceSubmission.countDocuments({
            'meta.quest.task_id': task._id.toString(),
            status: ForgeSubmissionProcessingStatus.COMPLETED,
            reward: { $gt: 0 }
          });

          // Check if task has reached its limit
          if (task.uploadLimit && taskSubmissions >= task.uploadLimit) {
            taskLimitReached = true;
            limitReason = 'Task limit reached';
          }

          // Check gym-wide per-task limit if applicable
          if (
            !taskLimitReached &&
            pool.uploadLimit?.limitType === UploadLimitType.perTask &&
            pool.uploadLimit?.type &&
            taskSubmissions >= pool.uploadLimit.type
          ) {
            taskLimitReached = true;
            limitReason = 'Per-task gym limit reached';
          }
        }

        // If gym limit is reached, mark all tasks as limited
        if (gymLimitReached) {
          taskLimitReached = true;
          limitReason =
            pool.uploadLimit?.limitType === UploadLimitType.perDay
              ? 'Daily gym limit reached'
              : 'Total gym limit reached';
        }

        // Add task with app information to the result array
        tasks.push({
          _id: task._id,
          prompt: task.prompt,
          uploadLimit: task.uploadLimit,
          rewardLimit: task.rewardLimit,
          uploadLimitReached: taskLimitReached,
          currentSubmissions: taskSubmissions,
          limitReason: limitReason,
          app: {
            _id: app._id,
            name: app.name,
            domain: app.domain,
            description: app.description,
            categories: app.categories,
            gymLimitType: pool.uploadLimit?.limitType,
            gymSubmissions: gymSubmissions,
            gymLimitValue: pool.uploadLimit?.type,
            pool_id: app.pool_id
          }
        });
      }
    }

    res.status(200).json(successResponse(tasks));
  })
);

// Get all apps with filtering options
router.get(
  '/',
  validateQuery(getTasksSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    const { pool_id, min_reward, max_reward, categories, query } = req.query;

    // First, build a query for pools if we need to filter by reward
    let poolQuery: any = {};
    let poolIds: string[] = [];

    if (min_reward !== undefined || max_reward !== undefined) {
      if (min_reward !== undefined) {
        poolQuery.pricePerDemo = { $gte: Number(min_reward) };
      }

      if (max_reward !== undefined) {
        poolQuery.pricePerDemo = {
          ...poolQuery.pricePerDemo,
          $lte: Number(max_reward)
        };
      }

      // If no pool_id specified, only include live pools
      if (!pool_id) {
        poolQuery.status = TrainingPoolStatus.live;
      }

      // Get matching pool IDs
      const pools = await TrainingPoolModel.find(poolQuery).select('_id');
      poolIds = pools.map((pool) => pool._id.toString());

      // If no pools match the reward criteria, return empty array early
      if (poolIds.length === 0) {
        res.json([]);
        return;
      }
    }

    // Build query for apps
    let appQuery: any = {};

    // Filter by pool_id if specified, or by poolIds from reward filter
    if (pool_id) {
      appQuery.pool_id = pool_id.toString();
    } else if (poolIds.length > 0) {
      appQuery.pool_id = { $in: poolIds };
    }

    // Filter by categories if specified
    if (categories) {
      try {
        // Parse the JSON array of categories
        const categoriesArray = (categories as string).split(',');
        if (Array.isArray(categoriesArray) && categoriesArray.length > 0) {
          // Use $in operator to match any of the categories
          appQuery.categories = { $in: categoriesArray };
        }
      } catch (e) {
        console.error('Error parsing categories parameter:', e);
        // If parsing fails, just don't apply the category filter
      }
    }

    // Text search for app name and task prompts
    if (query && typeof query === 'string') {
      // We need to use $or to search across multiple fields
      const searchRegex = new RegExp(query, 'i');

      appQuery.$or = [{ name: searchRegex }, { 'tasks.prompt': searchRegex }];
    }

    // Execute the query with appropriate population
    let apps;
    if (pool_id || poolIds.length > 0) {
      // If we're already filtering by specific pools, just get those apps
      apps = await ForgeAppModel.find(appQuery).populate(
        'pool_id',
        'name status pricePerDemo uploadLimit'
      );
    } else {
      // Otherwise, get all apps and filter by live pools
      apps = await ForgeAppModel.find(appQuery)
        .populate('pool_id', 'name status pricePerDemo uploadLimit')
        .then((apps) =>
          apps.filter((app) => {
            const pool = app.pool_id as unknown as DBTrainingPool;
            return pool && pool.status === TrainingPoolStatus.live;
          })
        );
    }

    // Mark tasks that have reached their upload limits instead of filtering them out
    const appsWithLimitInfo = await Promise.all(
      apps.map(async (app) => {
        const pool = app.pool_id as unknown as DBTrainingPool;
        // Create a new object with the required properties
        const appObj: AppWithLimitInfo = {
          ...app.toObject(),
          gymLimitReached: false,
          gymSubmissions: 0,
          gymLimitType: undefined,
          gymLimitValue: undefined
        };

        // Check gym-wide upload limit
        let gymLimitReached = false;
        let gymSubmissions = 0;

        if (pool.uploadLimit?.type) {
          const poolId = (pool as any)._id.toString();

          switch (pool.uploadLimit.limitType) {
            case UploadLimitType.perDay:
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              gymSubmissions = await ForgeRaceSubmission.countDocuments({
                'meta.quest.pool_id': poolId,
                createdAt: { $gte: today },
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                reward: { $gt: 0 } // Only count submissions that received a reward
              });

              // Check if gym has reached daily limit
              gymLimitReached = gymSubmissions >= pool.uploadLimit.type;
              break;

            case UploadLimitType.total:
              gymSubmissions = await ForgeRaceSubmission.countDocuments({
                'meta.quest.pool_id': poolId,
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                reward: { $gt: 0 } // Only count submissions that received a reward
              });

              // Check if gym has reached total limit
              gymLimitReached = gymSubmissions >= pool.uploadLimit.type;
              break;
          }
        }

        // Add gym limit info to app object
        appObj.gymLimitReached = gymLimitReached;
        appObj.gymSubmissions = gymSubmissions;
        appObj.gymLimitType = pool.uploadLimit?.limitType;
        appObj.gymLimitValue = pool.uploadLimit?.type;

        // Process tasks and add limit information
        const tasksWithLimitInfo = await Promise.all(
          app.tasks.map(async (task) => {
            //@ts-ignore - not sure how to type the task correectly, but its  a mongoose object until we call this
            task = task.toObject();
            let taskLimitReached = false;
            let taskSubmissions = 0;
            let limitReason: string | null = null;

            // Count submissions for this specific task
            if (
              task.uploadLimit ||
              (pool.uploadLimit?.limitType === UploadLimitType.perTask && pool.uploadLimit?.type)
            ) {
              taskSubmissions = await ForgeRaceSubmission.countDocuments({
                'meta.quest.task_id': task._id.toString(),
                status: ForgeSubmissionProcessingStatus.COMPLETED,
                reward: { $gt: 0 } // Only count submissions that received a reward
              });

              // Check if task has reached its limit
              if (task.uploadLimit && taskSubmissions >= task.uploadLimit) {
                taskLimitReached = true;
                limitReason = 'Task limit reached';
              }

              // Check gym-wide per-task limit if applicable
              if (
                !taskLimitReached &&
                pool.uploadLimit?.limitType === UploadLimitType.perTask &&
                pool.uploadLimit?.type &&
                taskSubmissions >= pool.uploadLimit.type
              ) {
                taskLimitReached = true;
                limitReason = 'Per-task gym limit reached';
              }
            }

            // If gym limit is reached, mark all tasks as limited
            if (gymLimitReached) {
              taskLimitReached = true;
              limitReason =
                pool.uploadLimit?.limitType === UploadLimitType.perDay
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

export { router as forgeAppsApi };
