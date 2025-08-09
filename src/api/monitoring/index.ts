import { Router, Response, Request, NextFunction } from 'express';
import { Connection } from '@solana/web3.js';
import { SmartContractMonitoring } from '../../services/monitoring/index.ts';
import { 
  MonitoringConfig, 
  AlertRule, 
  AlertChannelUnion, 
  ChannelType,
  EventFilter,
  AlertSeverity,
  EventType
} from '../../types/monitoring.ts';
import { 
  requireWalletAddress 
} from '../../middleware/auth.ts';
import { 
  errorHandlerAsync 
} from '../../middleware/errorHandler.ts';
import { 
  successResponse, 
  errorResponse,
  ErrorCode
} from '../../middleware/types/errors.ts';

// Extend Request type to include walletAddress
interface AuthenticatedRequest extends Request {
  walletAddress?: string;
}

const router = Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     MonitoringStatus:
 *       type: object
 *       properties:
 *         isActive:
 *           type: boolean
 *           description: Whether the monitoring system is currently active
 *         metrics:
 *           $ref: '#/components/schemas/MonitoringMetrics'
 *         healthStatus:
 *           $ref: '#/components/schemas/HealthStatus'
 *         recentEvents:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SmartContractEvent'
 *     
 *     MonitoringMetrics:
 *       type: object
 *       properties:
 *         totalEvents:
 *           type: number
 *           description: Total number of events processed
 *         eventsByType:
 *           type: object
 *           description: Breakdown of events by type
 *         eventsBySeverity:
 *           type: object
 *           description: Breakdown of events by severity level
 *         averageResponseTime:
 *           type: number
 *           description: Average response time in milliseconds
 *         errorRate:
 *           type: number
 *           description: Error rate as a percentage
 *         uptime:
 *           type: number
 *           description: System uptime in milliseconds
 *         lastEventTime:
 *           type: string
 *           format: date-time
 *           description: Timestamp of the last processed event
 *         customMetrics:
 *           type: object
 *           description: Additional custom metrics
 *     
 *     HealthStatus:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: [healthy, unhealthy, degraded]
 *           description: Overall health status
 *         message:
 *           type: string
 *           description: Health status message
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: When the health check was performed
 *         checks:
 *           type: object
 *           description: Individual health check results
 *     
 *     SmartContractEvent:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique event identifier
 *         type:
 *           type: string
 *           enum: [TASK_COMPLETION_RECORDED, REWARDS_WITHDRAWN, REWARD_POOL_INITIALIZED, PLATFORM_FEE_UPDATED, POOL_PAUSED, POOL_UNPAUSED, REWARD_VAULT_CREATED, TRANSACTION_FAILED, BALANCE_LOW, HIGH_VOLUME, SUSPICIOUS_ACTIVITY, CONTRACT_ERROR, NETWORK_ERROR]
 *           description: Type of smart contract event
 *         signature:
 *           type: string
 *           description: Transaction signature
 *         slot:
 *           type: number
 *           description: Solana slot number
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: Event timestamp
 *         severity:
 *           type: number
 *           enum: [1, 2, 3, 4]
 *           description: Alert severity level (1=Low, 2=Medium, 3=High, 4=Critical)
 *         address:
 *           type: string
 *           description: Associated wallet address
 *         amount:
 *           type: number
 *           description: Transaction amount
 *         poolId:
 *           type: string
 *           description: Pool identifier
 *         tokenMint:
 *           type: string
 *           description: Token mint address
 *         taskId:
 *           type: string
 *           description: Task identifier
 *         farmerAddress:
 *           type: string
 *           description: Farmer wallet address
 *         error:
 *           type: string
 *           description: Error message if applicable
 *         success:
 *           type: boolean
 *           description: Whether the transaction was successful
 *     
 *     AlertRule:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique rule identifier
 *         name:
 *           type: string
 *           description: Rule name
 *         description:
 *           type: string
 *           description: Rule description
 *         enabled:
 *           type: boolean
 *           description: Whether the rule is enabled
 *         severity:
 *           type: number
 *           enum: [1, 2, 3, 4]
 *           description: Alert severity level
 *         eventTypes:
 *           type: array
 *           items:
 *             type: string
 *           description: Event types to monitor
 *         conditions:
 *           type: array
 *           items:
 *             type: object
 *           description: Alert conditions
 *         channels:
 *           type: array
 *           items:
 *             type: string
 *           description: Alert channels to use
 *         cooldown:
 *           type: number
 *           description: Cooldown period in milliseconds
 *     
 *     AlertChannel:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique channel identifier
 *         name:
 *           type: string
 *           description: Channel name
 *         type:
 *           type: string
 *           enum: [discord, slack, email, webhook, sms, telegram]
 *           description: Channel type
 *         enabled:
 *           type: boolean
 *           description: Whether the channel is enabled
 *         config:
 *           type: object
 *           description: Channel configuration
 *     
 *     DashboardData:
 *       type: object
 *       properties:
 *         status:
 *           $ref: '#/components/schemas/MonitoringStatus'
 *         recentEvents:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SmartContractEvent'
 *         recentAlerts:
 *           type: array
 *           items:
 *             type: object
 *         metrics:
 *           $ref: '#/components/schemas/MonitoringMetrics'
 *         healthStatus:
 *           $ref: '#/components/schemas/HealthStatus'
 *         topAddresses:
 *           type: array
 *           items:
 *             type: object
 *         topPools:
 *           type: array
 *           items:
 *             type: object
 *         eventTrends:
 *           type: array
 *           items:
 *             type: object
 */

/**
 * @swagger
 * /monitoring/status:
 *   get:
 *     summary: Get monitoring system status
 *     description: Returns the current status of the smart contract monitoring system including metrics, health status, and recent events
 *     tags: [Monitoring]
 *     responses:
 *       200:
 *         description: Monitoring status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 isActive: true
 *                 metrics:
 *                   totalEvents: 1250
 *                   eventsByType:
 *                     TASK_COMPLETION_RECORDED: 800
 *                     REWARDS_WITHDRAWN: 300
 *                   eventsBySeverity:
 *                     1: 1000
 *                     2: 200
 *                     3: 50
 *                   averageResponseTime: 150
 *                   errorRate: 0.02
 *                   uptime: 86400000
 *                 healthStatus:
 *                   status: "healthy"
 *                   message: "All health checks passed"
 *                   timestamp: "2024-01-15T10:30:00Z"
 *                 recentEvents:
 *                   - id: "event_123"
 *                     type: "TASK_COMPLETION_RECORDED"
 *                     signature: "5J7X...abc123"
 *                     severity: 1
 *                     timestamp: "2024-01-15T10:29:45Z"
 *       503:
 *         description: Monitoring service not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get monitoring status
router.get(
  '/status',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    const status = {
      isActive: monitoring.isActive(),
      metrics: monitoring.getMetrics(),
      healthStatus: monitoring.getHealthStatus(),
      recentEvents: monitoring.getRecentEvents(10)
    };

    res.status(200).json(successResponse(status));
  })
);

/**
 * @swagger
 * /monitoring/dashboard:
 *   get:
 *     summary: Get monitoring dashboard data
 *     description: Returns comprehensive dashboard data including status, metrics, health status, recent events, and analytics
 *     tags: [Monitoring]
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 status:
 *                   isActive: true
 *                   startTime: "2024-01-14T10:30:00Z"
 *                   uptime: 86400000
 *                   totalEventsProcessed: 1250
 *                   totalAlertsSent: 45
 *                   lastEventTime: "2024-01-15T10:29:45Z"
 *                 recentEvents:
 *                   - id: "event_123"
 *                     type: "TASK_COMPLETION_RECORDED"
 *                     signature: "5J7X...abc123"
 *                     severity: 1
 *                     timestamp: "2024-01-15T10:29:45Z"
 *                 metrics:
 *                   totalEvents: 1250
 *                   eventsByType:
 *                     TASK_COMPLETION_RECORDED: 800
 *                     REWARDS_WITHDRAWN: 300
 *                   errorRate: 0.02
 *                 healthStatus:
 *                   status: "healthy"
 *                   message: "All health checks passed"
 *                 topAddresses:
 *                   - address: "ABC123..."
 *                     eventCount: 150
 *                     totalAmount: 5000
 *                 topPools:
 *                   - poolId: "pool_1"
 *                     eventCount: 300
 *                     totalAmount: 15000
 *       503:
 *         description: Monitoring service not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get dashboard data
router.get(
  '/dashboard',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    const metrics = monitoring.getMetrics();
    const healthStatus = monitoring.getHealthStatus();
    const recentEvents = monitoring.getRecentEvents(50);

    const dashboardData = {
      status: {
        isActive: monitoring.isActive(),
        startTime: new Date(Date.now() - metrics.uptime),
        uptime: metrics.uptime,
        totalEventsProcessed: metrics.totalEvents,
        totalAlertsSent: 0,
        lastEventTime: metrics.lastEventTime,
        healthStatus,
        metrics
      },
      recentEvents,
      recentAlerts: [],
      metrics,
      healthStatus,
      topAddresses: [],
      topPools: [],
      eventTrends: []
    };

    res.status(200).json(successResponse(dashboardData));
  })
);

/**
 * @swagger
 * /monitoring/events:
 *   get:
 *     summary: Get monitoring events
 *     description: Retrieve smart contract events with optional filtering and pagination
 *     tags: [Monitoring]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           minimum: 1
 *           maximum: 1000
 *         description: Maximum number of events to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *           minimum: 0
 *         description: Number of events to skip for pagination
 *     responses:
 *       200:
 *         description: Events retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 events:
 *                   - id: "event_123"
 *                     type: "TASK_COMPLETION_RECORDED"
 *                     signature: "5J7X...abc123"
 *                     slot: 123456789
 *                     timestamp: "2024-01-15T10:29:45Z"
 *                     severity: 1
 *                     address: "ABC123..."
 *                     amount: 100
 *                     poolId: "pool_1"
 *                     taskId: "task_456"
 *                     success: true
 *                 total: 1250
 *                 offset: 0
 *                 limit: 100
 *       503:
 *         description: Monitoring service not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get events with filtering
router.get(
  '/events',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    const events = monitoring.getRecentEvents();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    
    const paginatedEvents = events.slice(offset, offset + limit);

    res.status(200).json(successResponse({
      events: paginatedEvents,
      total: events.length,
      offset,
      limit
    }));
  })
);

/**
 * @swagger
 * /monitoring/metrics:
 *   get:
 *     summary: Get monitoring metrics
 *     description: Retrieve current monitoring metrics including event counts, performance data, and custom metrics
 *     tags: [Monitoring]
 *     responses:
 *       200:
 *         description: Metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 totalEvents: 1250
 *                 eventsByType:
 *                   TASK_COMPLETION_RECORDED: 800
 *                   REWARDS_WITHDRAWN: 300
 *                   REWARD_POOL_INITIALIZED: 50
 *                   CONTRACT_ERROR: 100
 *                 eventsBySeverity:
 *                   1: 1000
 *                   2: 200
 *                   3: 50
 *                 averageResponseTime: 150
 *                 errorRate: 0.02
 *                 uptime: 86400000
 *                 lastEventTime: "2024-01-15T10:29:45Z"
 *                 customMetrics:
 *                   uniqueAddresses: 150
 *                   uniquePools: 25
 *                   totalVolume: 50000
 *                   averageTransactionAmount: 40
 *                   eventsPerHour: 52
 *                   successRate: 0.98
 *       503:
 *         description: Monitoring service not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get metrics
router.get(
  '/metrics',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    const metrics = monitoring.getMetrics();
    res.status(200).json(successResponse(metrics));
  })
);

/**
 * @swagger
 * /monitoring/health:
 *   get:
 *     summary: Get monitoring health status
 *     description: Retrieve the current health status of the monitoring system including individual health checks
 *     tags: [Monitoring]
 *     responses:
 *       200:
 *         description: Health status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 status: "healthy"
 *                 message: "All health checks passed"
 *                 timestamp: "2024-01-15T10:30:00Z"
 *                 checks:
 *                   blockchain:
 *                     status: "pass"
 *                     message: "Connected to blockchain at slot 123456789"
 *                     duration: 150
 *                   rpcEndpoint:
 *                     status: "pass"
 *                     message: "RPC endpoint healthy - Solana version: 1.17.0"
 *                     duration: 200
 *                   programAccess:
 *                     status: "pass"
 *                     message: "Program accessible - Size: 8192 bytes"
 *                     duration: 100
 *                   networkStatus:
 *                     status: "pass"
 *                     message: "Network healthy - 1500 active nodes"
 *                     duration: 300
 *                   slotProgression:
 *                     status: "pass"
 *                     message: "Slot progression normal - 2 slots in 1s"
 *                     duration: 1000
 *                   memoryUsage:
 *                     status: "pass"
 *                     message: "Memory usage normal - Heap: 150MB/200MB, RSS: 180MB"
 *                     duration: 50
 *       503:
 *         description: Monitoring service not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get health status
router.get(
  '/health',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    const healthStatus = monitoring.getHealthStatus();
    res.status(200).json(successResponse(healthStatus));
  })
);

// Run manual health check
router.post(
  '/health/check',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    const healthStatus = monitoring.getHealthStatus();
    res.status(200).json(successResponse(healthStatus));
  })
);

/**
 * @swagger
 * /monitoring/alerts/rules:
 *   get:
 *     summary: Get alert rules
 *     description: Retrieve all configured alert rules for the monitoring system
 *     tags: [Monitoring - Alerts]
 *     responses:
 *       200:
 *         description: Alert rules retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 - id: "high-value-transactions"
 *                   name: "High Value Transactions"
 *                   description: "Alert when transactions exceed 100 SOL"
 *                   enabled: true
 *                   severity: 3
 *                   eventTypes: ["REWARDS_WITHDRAWN", "TASK_COMPLETION_RECORDED"]
 *                   conditions:
 *                     - field: "amount"
 *                       operator: "greater_than"
 *                       value: 100
 *                   channels: ["discord-alerts"]
 *                   cooldown: 300000
 *                 - id: "contract-errors"
 *                   name: "Contract Errors"
 *                   description: "Alert on any contract errors"
 *                   enabled: true
 *                   severity: 4
 *                   eventTypes: ["CONTRACT_ERROR", "TRANSACTION_FAILED"]
 *                   channels: ["discord-alerts", "email-alerts"]
 *                   cooldown: 60000
 *       503:
 *         description: Monitoring service not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get alert rules
router.get(
  '/alerts/rules',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    // TODO: Get alert rules from monitoring service
    const rules: AlertRule[] = [];
    res.status(200).json(successResponse(rules));
  })
);

/**
 * @swagger
 * /monitoring/alerts/rules:
 *   post:
 *     summary: Create alert rule
 *     description: Create a new alert rule for monitoring smart contract events
 *     tags: [Monitoring - Alerts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - severity
 *               - channels
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name of the alert rule
 *                 example: "High Value Transactions"
 *               description:
 *                 type: string
 *                 description: Description of the alert rule
 *                 example: "Alert when transactions exceed 100 SOL"
 *               enabled:
 *                 type: boolean
 *                 default: true
 *                 description: Whether the rule is enabled
 *               severity:
 *                 type: number
 *                 enum: [1, 2, 3, 4]
 *                 description: Alert severity level (1=Low, 2=Medium, 3=High, 4=Critical)
 *                 example: 3
 *               eventTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Event types to monitor
 *                 example: ["REWARDS_WITHDRAWN", "TASK_COMPLETION_RECORDED"]
 *               conditions:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     field:
 *                       type: string
 *                       description: Field to check
 *                       example: "amount"
 *                     operator:
 *                       type: string
 *                       enum: [equals, not_equals, greater_than, less_than, contains, not_contains, regex]
 *                       description: Comparison operator
 *                       example: "greater_than"
 *                     value:
 *                       description: Value to compare against
 *                       example: 100
 *                 description: Alert conditions
 *               channels:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Alert channels to use
 *                 example: ["discord-alerts"]
 *               cooldown:
 *                 type: number
 *                 description: Cooldown period in milliseconds
 *                 example: 300000
 *     responses:
 *       201:
 *         description: Alert rule created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Invalid request data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       503:
 *         description: Monitoring service not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Create alert rule
router.post(
  '/alerts/rules',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    const rule: AlertRule = {
      id: req.body.id || generateId(),
      name: req.body.name,
      description: req.body.description,
      enabled: req.body.enabled ?? true,
      severity: req.body.severity,
      eventTypes: req.body.eventTypes,
      conditions: req.body.conditions,
      rateLimit: req.body.rateLimit,
      metricThresholds: req.body.metricThresholds,
      channels: req.body.channels,
      cooldown: req.body.cooldown
    };

    await monitoring.addAlertRule(rule);
    res.status(201).json(successResponse(rule));
  })
);

// Update alert rule
router.put(
  '/alerts/rules/:id',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    const ruleId = req.params.id;
    
    // TODO: Update alert rule in monitoring service
    res.status(200).json(successResponse({ message: 'Alert rule updated' }));
  })
);

// Delete alert rule
router.delete(
  '/alerts/rules/:id',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    const ruleId = req.params.id;
    await monitoring.removeAlertRule(ruleId);
    
    res.status(200).json(successResponse({ message: 'Alert rule deleted' }));
  })
);

/**
 * @swagger
 * /monitoring/alerts/channels:
 *   get:
 *     summary: Get alert channels
 *     description: Retrieve all configured alert channels for the monitoring system
 *     tags: [Monitoring - Alerts]
 *     responses:
 *       200:
 *         description: Alert channels retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 - id: "discord-alerts"
 *                   name: "Discord Alerts"
 *                   type: "discord"
 *                   enabled: true
 *                   config:
 *                     webhookUrl: "https://discord.com/api/webhooks/..."
 *                     username: "Monitoring Bot"
 *                     avatarUrl: "https://example.com/avatar.png"
 *                 - id: "email-alerts"
 *                   name: "Email Alerts"
 *                   type: "email"
 *                   enabled: true
 *                   config:
 *                     smtpHost: "smtp.gmail.com"
 *                     smtpPort: 587
 *                     username: "alerts@example.com"
 *                     password: "app-password"
 *                     to: ["admin@example.com", "ops@example.com"]
 *                 - id: "slack-alerts"
 *                   name: "Slack Alerts"
 *                   type: "slack"
 *                   enabled: false
 *                   config:
 *                     webhookUrl: "https://hooks.slack.com/services/..."
 *                     channel: "#monitoring"
 *       503:
 *         description: Monitoring service not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Get alert channels
router.get(
  '/alerts/channels',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    // TODO: Get alert channels from monitoring service
    const channels: AlertChannelUnion[] = [];
    res.status(200).json(successResponse(channels));
  })
);

/**
 * @swagger
 * /monitoring/alerts/channels:
 *   post:
 *     summary: Create alert channel
 *     description: Create a new alert channel for sending notifications
 *     tags: [Monitoring - Alerts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - type
 *               - config
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name of the alert channel
 *                 example: "Discord Alerts"
 *               type:
 *                 type: string
 *                 enum: [discord, slack, email, webhook, sms, telegram]
 *                 description: Type of alert channel
 *                 example: "discord"
 *               enabled:
 *                 type: boolean
 *                 default: true
 *                 description: Whether the channel is enabled
 *               config:
 *                 type: object
 *                 description: Channel-specific configuration
 *                 example:
 *                   webhookUrl: "https://discord.com/api/webhooks/..."
 *                   username: "Monitoring Bot"
 *                   avatarUrl: "https://example.com/avatar.png"
 *     responses:
 *       201:
 *         description: Alert channel created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Invalid request data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       503:
 *         description: Monitoring service not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Create alert channel
router.post(
  '/alerts/channels',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    const channel: AlertChannelUnion = {
      id: req.body.id || generateId(),
      name: req.body.name,
      type: req.body.type,
      enabled: req.body.enabled ?? true,
      config: req.body.config
    } as AlertChannelUnion;

    await monitoring.addAlertChannel(channel);
    res.status(201).json(successResponse(channel));
  })
);

// Update alert channel
router.put(
  '/alerts/channels/:id',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    const channelId = req.params.id;
    
    // TODO: Update alert channel in monitoring service
    res.status(200).json(successResponse({ message: 'Alert channel updated' }));
  })
);

// Delete alert channel
router.delete(
  '/alerts/channels/:id',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    const channelId = req.params.id;
    await monitoring.removeAlertChannel(channelId);
    
    res.status(200).json(successResponse({ message: 'Alert channel deleted' }));
  })
);

// Get alert history
router.get(
  '/alerts/history',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    
    // TODO: Get alert history from monitoring service
    const alerts: any[] = [];
    res.status(200).json(successResponse(alerts));
  })
);

/**
 * @swagger
 * /monitoring/start:
 *   post:
 *     summary: Start monitoring system
 *     description: Start the smart contract monitoring system if it's not already running
 *     tags: [Monitoring - Control]
 *     responses:
 *       200:
 *         description: Monitoring system started successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 message: "Monitoring started"
 *       400:
 *         description: Monitoring is already active
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       503:
 *         description: Monitoring service not available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Start monitoring
router.post(
  '/start',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    if (monitoring.isActive()) {
      return res.status(400).json(errorResponse(ErrorCode.BAD_REQUEST, 'Monitoring is already active'));
    }

    await monitoring.start();
    res.status(200).json(successResponse({ message: 'Monitoring started' }));
  })
);

// Stop monitoring
router.post(
  '/stop',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const monitoring = getMonitoringInstance();
    
    if (!monitoring) {
      return res.status(503).json(errorResponse(ErrorCode.SERVICE_UNAVAILABLE, 'Monitoring service not available'));
    }

    if (!monitoring.isActive()) {
      return res.status(400).json(errorResponse(ErrorCode.BAD_REQUEST, 'Monitoring is not active'));
    }

    await monitoring.stop();
    res.status(200).json(successResponse({ message: 'Monitoring stopped' }));
  })
);

/**
 * @swagger
 * /monitoring/events/types:
 *   get:
 *     summary: Get event types
 *     description: Retrieve all available smart contract event types that can be monitored
 *     tags: [Monitoring - Reference]
 *     responses:
 *       200:
 *         description: Event types retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 - "TASK_COMPLETION_RECORDED"
 *                 - "REWARDS_WITHDRAWN"
 *                 - "REWARD_POOL_INITIALIZED"
 *                 - "PLATFORM_FEE_UPDATED"
 *                 - "POOL_PAUSED"
 *                 - "POOL_UNPAUSED"
 *                 - "REWARD_VAULT_CREATED"
 *                 - "TRANSACTION_FAILED"
 *                 - "BALANCE_LOW"
 *                 - "HIGH_VOLUME"
 *                 - "SUSPICIOUS_ACTIVITY"
 *                 - "CONTRACT_ERROR"
 *                 - "NETWORK_ERROR"
 */
// Get event types
router.get(
  '/events/types',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const eventTypes = Object.values(EventType);
    res.status(200).json(successResponse(eventTypes));
  })
);

/**
 * @swagger
 * /monitoring/alerts/severity:
 *   get:
 *     summary: Get alert severity levels
 *     description: Retrieve all available alert severity levels
 *     tags: [Monitoring - Reference]
 *     responses:
 *       200:
 *         description: Severity levels retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 - 1
 *                 - 2
 *                 - 3
 *                 - 4
 */
// Get severity levels
router.get(
  '/alerts/severity',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const severityLevels = Object.values(AlertSeverity);
    res.status(200).json(successResponse(severityLevels));
  })
);

/**
 * @swagger
 * /monitoring/alerts/channels/types:
 *   get:
 *     summary: Get alert channel types
 *     description: Retrieve all available alert channel types
 *     tags: [Monitoring - Reference]
 *     responses:
 *       200:
 *         description: Channel types retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               success: true
 *               data:
 *                 - "discord"
 *                 - "slack"
 *                 - "email"
 *                 - "webhook"
 *                 - "sms"
 *                 - "telegram"
 */
// Get channel types
router.get(
  '/alerts/channels/types',
  errorHandlerAsync(async (req: Request, res: Response, next: NextFunction) => {
    const channelTypes = Object.values(ChannelType);
    res.status(200).json(successResponse(channelTypes));
  })
);

// Helper function to get monitoring instance
function getMonitoringInstance(): SmartContractMonitoring | null {
  // TODO: Get from global state or dependency injection
  return null;
}

// Helper function to generate ID
function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export const monitoringApi = router; 