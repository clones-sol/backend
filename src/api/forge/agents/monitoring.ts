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

// GET /search
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

// GET /:id/health
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

// GET /:id/metrics
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