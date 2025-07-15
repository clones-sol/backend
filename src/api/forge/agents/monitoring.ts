import express, { Request, Response, Router } from 'express';
import { requireWalletAddress } from '../../../middleware/auth.ts';
import { errorHandlerAsync } from '../../../middleware/errorHandler.ts';
import { validateParams, validateQuery } from '../../../middleware/validator.ts';
import { metricsQuerySchema, searchAgentsSchema } from '../../schemas/forge-agents.ts';
import { successResponse } from '../../../middleware/types/errors.ts';
import { GymAgentModel, GymAgentInvocationModel } from '../../../models/Models.ts';
import { idValidationSchema } from '../../schemas/common.ts';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { requireAgentOwnership } from './middleware.ts';
import { AuthenticatedRequest } from '../../../middleware/types/request.ts';

const router: Router = express.Router();

/**
 * @openapi
 * /forge/agents/search:
 *   get:
 *     tags:
 *       - Agents Monitoring & Public
 *     summary: Search and filter public agents
 *     description: A public endpoint to find and filter `DEPLOYED` agents for a marketplace view. This endpoint is rate-limited.
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: A search term to match against agent name and description.
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [newest, name]
 *           default: newest
 *         description: The sorting criteria.
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: The number of results to return per page.
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: The number of results to skip for pagination.
 *     responses:
 *       '200':
 *         description: A paginated list of public agents.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/GymAgent'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                         limit:
 *                           type: integer
 *                         offset:
 *                           type: integer
 *       '429':
 *         description: Too many requests. Rate limit exceeded.
 */
router.get(
    '/search',
    rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 100, // Limit each IP to 100 requests per windowMs
        standardHeaders: true,
        legacyHeaders: false,
    }),
    validateQuery(searchAgentsSchema),
    errorHandlerAsync(async (req: Request, res: Response) => {
        const { q, sortBy = 'newest', limit = '10', offset = '0' } = req.query;

        const parsedLimit = parseInt(limit as string, 10);
        const parsedOffset = parseInt(offset as string, 10);

        const filters: any = { 'deployment.status': 'DEPLOYED' };
        if (q) {
            filters.$text = { $search: q as string };
        }

        const sortOptions: any = {};
        if (sortBy === 'name') {
            sortOptions.name = 1;
        } else {
            sortOptions.createdAt = -1;
        }

        const projection = {
            name: 1,
            ticker: 1,
            description: 1,
            logoUrl: 1,
            'tokenomics.supply': 1,
            'tokenomics.gatedPercentage': 1,
            'blockchain.tokenAddress': 1,
            'blockchain.poolAddress': 1,
        };

        const agents = await GymAgentModel.find(filters)
            .sort(sortOptions)
            .skip(parsedOffset)
            .limit(parsedLimit)
            .select(projection)
            .lean();

        const total = await GymAgentModel.countDocuments(filters);

        res.status(200).json(successResponse({
            data: agents,
            pagination: {
                total,
                limit: parsedLimit,
                offset: parsedOffset,
            }
        }));
    })
);

/**
 * @openapi
 * /forge/agents/{id}/health:
 *   get:
 *     tags:
 *       - Agents Monitoring & Public
 *     summary: Get agent health status
 *     description: Provides a simple, real-time health status of a deployed agent, including its current deployment status and last known error.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the agent.
 *     responses:
 *       '200':
 *         description: The health status of the agent.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                     isOperational:
 *                       type: boolean
 *                     lastError:
 *                       type: string
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
    '/:id/health',
    requireWalletAddress,
    validateParams(idValidationSchema),
    requireAgentOwnership,
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { agent } = req;

        const healthStatus = {
            status: agent!.deployment.status,
            isOperational: agent!.deployment.status === 'DEPLOYED',
            lastError: agent!.deployment.lastError,
        };

        res.status(200).json(successResponse(healthStatus));
    })
);

/**
 * @openapi
 * /forge/agents/{id}/metrics:
 *   get:
 *     tags:
 *       - Agents Monitoring & Public
 *     summary: Get agent performance metrics
 *     description: Retrieves aggregated performance metrics for an agent over a specified timeframe, such as total requests, error rate, and average response time.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the agent.
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [24h, 7d, 30d]
 *           default: 24h
 *         description: The time window for the metrics.
 *       - in: query
 *         name: versionTag
 *         schema:
 *           type: string
 *         description: An optional version tag to filter metrics for a specific version.
 *     responses:
 *       '200':
 *         description: Aggregated performance metrics for the agent.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     timeframe:
 *                       type: string
 *                     totalRequests:
 *                       type: integer
 *                     errorRate:
 *                       type: number
 *                     averageResponseTimeMs:
 *                       type: integer
 *                     versionTag:
 *                       type: string
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Forbidden'
 *       '404':
 *         $ref: '#/components/responses/NotFound'
 */
router.get(
    '/:id/metrics',
    requireWalletAddress,
    validateParams(idValidationSchema),
    validateQuery(metricsQuerySchema),
    requireAgentOwnership,
    errorHandlerAsync(async (req: AuthenticatedRequest, res: Response) => {
        const { agent } = req; // agent is available for any logic that might need it.
        const { id } = req.params;
        const { timeframe = '24h', versionTag } = req.query as { timeframe?: string; versionTag?: string };

        const agentId = new mongoose.Types.ObjectId(id);
        const now = new Date();
        let startDate;
        switch (timeframe) {
            case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case '24h':
            default:
                startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
        }

        const matchFilter: any = {
            agentId: agentId,
            timestamp: { $gte: startDate },
        };

        if (versionTag) {
            matchFilter.versionTag = versionTag;
        }

        const pipeline = [
            { $match: matchFilter },
            {
                $group: {
                    _id: null,
                    totalRequests: { $sum: 1 },
                    totalSuccessful: { $sum: { $cond: ['$isSuccess', 1, 0] } },
                    totalDurationMs: { $sum: '$durationMs' }
                }
            },
            {
                $project: {
                    _id: 0,
                    totalRequests: 1,
                    errorRate: {
                        $cond: [
                            { $eq: ['$totalRequests', 0] },
                            0,
                            { $divide: [{ $subtract: ['$totalRequests', '$totalSuccessful'] }, '$totalRequests'] }
                        ]
                    },
                    averageResponseTimeMs: {
                        $cond: [
                            { $eq: ['$totalRequests', 0] },
                            0,
                            { $divide: ['$totalDurationMs', '$totalRequests'] }
                        ]
                    }
                }
            }
        ];

        const results = await GymAgentInvocationModel.aggregate(pipeline);

        let metrics: {
            timeframe: string;
            totalRequests: number;
            errorRate: number;
            averageResponseTimeMs: number;
            versionTag?: string;
        };

        if (results.length > 0) {
            metrics = {
                timeframe,
                ...results[0],
                averageResponseTimeMs: Math.round(results[0].averageResponseTimeMs),
            };
        } else {
            metrics = {
                timeframe,
                totalRequests: 0,
                errorRate: 0,
                averageResponseTimeMs: 0,
            };
        }
        if (versionTag) {
            metrics.versionTag = versionTag;
        }

        res.status(200).json(successResponse(metrics));
    })
);

export { router as monitoringRoutes }; 