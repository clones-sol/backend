import { PublicKey } from '@solana/web3.js';

// Event types for smart contract monitoring
export enum EventType {
  TASK_COMPLETION_RECORDED = 'TASK_COMPLETION_RECORDED',
  REWARDS_WITHDRAWN = 'REWARDS_WITHDRAWN',
  REWARD_POOL_INITIALIZED = 'REWARD_POOL_INITIALIZED',
  PLATFORM_FEE_UPDATED = 'PLATFORM_FEE_UPDATED',
  POOL_PAUSED = 'POOL_PAUSED',
  POOL_UNPAUSED = 'POOL_UNPAUSED',
  REWARD_VAULT_CREATED = 'REWARD_VAULT_CREATED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  BALANCE_LOW = 'BALANCE_LOW',
  HIGH_VOLUME = 'HIGH_VOLUME',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
  CONTRACT_ERROR = 'CONTRACT_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR'
}

// Alert severity levels
export enum AlertSeverity {
  LOW = 1,
  MEDIUM = 2,
  HIGH = 3,
  CRITICAL = 4
}

// Smart contract event interface
export interface SmartContractEvent {
  id: string;
  type: EventType;
  signature: string;
  slot: number;
  timestamp: Date;
  severity: AlertSeverity;
  address?: string;
  amount?: number;
  poolId?: string;
  tokenMint?: string;
  taskId?: string;
  farmerAddress?: string;
  error?: string;
  metadata?: Record<string, any>;
  blockTime?: number;
  fee?: number;
  success?: boolean;
}

// Alert condition operators
export type ConditionOperator = 
  | 'equals' 
  | 'not_equals' 
  | 'greater_than' 
  | 'less_than' 
  | 'contains' 
  | 'not_contains' 
  | 'regex';

// Alert condition interface
export interface AlertCondition {
  field: string;
  operator: ConditionOperator;
  value: any;
}

// Rate limiting for alerts
export interface RateLimit {
  maxEvents: number;
  window: number; // in milliseconds
}

// Metric thresholds for alerting
export interface MetricThresholds {
  [metric: string]: number;
}

// Alert rule interface
export interface AlertRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  severity: AlertSeverity;
  eventTypes?: EventType[];
  conditions?: AlertCondition[];
  rateLimit?: RateLimit;
  metricThresholds?: MetricThresholds;
  channels: string[]; // Channel names to send alerts to
  cooldown?: number; // Cooldown period in milliseconds
  lastTriggered?: Date;
}

// Alert channel types
export enum ChannelType {
  DISCORD = 'discord',
  SLACK = 'slack',
  EMAIL = 'email',
  WEBHOOK = 'webhook',
  SMS = 'sms',
  TELEGRAM = 'telegram'
}

// Base alert channel interface
export interface AlertChannel {
  id: string;
  name: string;
  type: ChannelType;
  enabled: boolean;
  config: Record<string, any>;
}

// Discord alert channel
export interface DiscordChannel extends AlertChannel {
  type: ChannelType.DISCORD;
  config: {
    webhookUrl: string;
    username?: string;
    avatarUrl?: string;
    channelId?: string;
    mentions?: string[];
  };
}

// Slack alert channel
export interface SlackChannel extends AlertChannel {
  type: ChannelType.SLACK;
  config: {
    webhookUrl: string;
    channel?: string;
    username?: string;
    iconEmoji?: string;
  };
}

// Email alert channel
export interface EmailChannel extends AlertChannel {
  type: ChannelType.EMAIL;
  config: {
    smtpHost: string;
    smtpPort: number;
    username: string;
    password: string;
    fromEmail: string;
    toEmails: string[];
    subjectPrefix?: string;
  };
}

// Webhook alert channel
export interface WebhookChannel extends AlertChannel {
  type: ChannelType.WEBHOOK;
  config: {
    url: string;
    method?: 'POST' | 'PUT' | 'PATCH';
    headers?: Record<string, string>;
    timeout?: number;
  };
}

// SMS alert channel
export interface SMSChannel extends AlertChannel {
  type: ChannelType.SMS;
  config: {
    provider: 'twilio' | 'aws-sns' | 'custom';
    accountSid?: string;
    authToken?: string;
    fromNumber?: string;
    toNumbers: string[];
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
}

// Telegram alert channel
export interface TelegramChannel extends AlertChannel {
  type: ChannelType.TELEGRAM;
  config: {
    botToken: string;
    chatIds: string[];
    parseMode?: 'HTML' | 'Markdown';
  };
}

// Union type for all channel types
export type AlertChannelUnion = 
  | DiscordChannel 
  | SlackChannel 
  | EmailChannel 
  | WebhookChannel 
  | SMSChannel 
  | TelegramChannel;

// Health check status
export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message: string;
  timestamp: Date;
  checks: {
    [checkName: string]: {
      status: 'pass' | 'fail' | 'warn';
      message: string;
      duration: number;
    };
  };
}

// Metrics interface
export interface Metrics {
  totalEvents: number;
  eventsByType: Record<EventType, number>;
  eventsBySeverity: Record<AlertSeverity, number>;
  averageResponseTime: number;
  errorRate: number;
  lastEventTime?: Date;
  uptime: number;
  customMetrics: Record<string, number>;
}

// Monitoring configuration
export interface MonitoringConfig {
  // General settings
  enabled: boolean;
  pollInterval: number; // milliseconds
  maxRetries: number;
  retryDelay: number; // milliseconds
  
  // Smart contract settings
  programId: string;
  rpcUrl: string;
  commitment: 'processed' | 'confirmed' | 'finalized';
  
  // Alert settings
  alertChannels: AlertChannelUnion[];
  alertRules: AlertRule[];
  defaultSeverity: AlertSeverity;
  
  // Health check settings
  healthCheckInterval: number; // milliseconds
  healthCheckTimeout: number; // milliseconds
  
  // Metrics settings
  metricsRetentionPeriod: number; // milliseconds
  metricsUpdateInterval: number; // milliseconds
  
  // Advanced settings
  enableWebSocket: boolean;
  enableTransactionParsing: boolean;
  enableBalanceMonitoring: boolean;
  enableSuspiciousActivityDetection: boolean;
  
  // Thresholds
  lowBalanceThreshold: number;
  highVolumeThreshold: number;
  suspiciousActivityThreshold: number;
  
  // Filters
  addressFilters?: string[];
  poolIdFilters?: string[];
  tokenMintFilters?: string[];
  
  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enableEventLogging: boolean;
}

// Alert message interface
export interface AlertMessage {
  id: string;
  ruleId: string;
  event: SmartContractEvent;
  severity: AlertSeverity;
  message: string;
  timestamp: Date;
  channels: string[];
  metadata?: Record<string, any>;
}

// System alert interface
export interface SystemAlert {
  type: string;
  severity: AlertSeverity;
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

// Monitoring status
export interface MonitoringStatus {
  isActive: boolean;
  startTime?: Date;
  uptime: number;
  totalEventsProcessed: number;
  totalAlertsSent: number;
  lastEventTime?: Date;
  healthStatus: HealthStatus;
  metrics: Metrics;
}

// Event filter interface
export interface EventFilter {
  types?: EventType[];
  severity?: AlertSeverity[];
  addresses?: string[];
  poolIds?: string[];
  tokenMints?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  limit?: number;
  offset?: number;
}

// Dashboard data interface
export interface DashboardData {
  status: MonitoringStatus;
  recentEvents: SmartContractEvent[];
  recentAlerts: AlertMessage[];
  metrics: Metrics;
  healthStatus: HealthStatus;
  topAddresses: Array<{
    address: string;
    eventCount: number;
    totalAmount: number;
  }>;
  topPools: Array<{
    poolId: string;
    eventCount: number;
    totalAmount: number;
  }>;
  eventTrends: Array<{
    timestamp: Date;
    count: number;
    type: EventType;
  }>;
} 