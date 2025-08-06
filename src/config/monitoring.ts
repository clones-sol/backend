import { 
  MonitoringConfig, 
  AlertRule, 
  AlertChannelUnion, 
  ChannelType,
  AlertSeverity,
  EventType 
} from '../types/monitoring.ts';

// Validate required environment variables
function validateEnvironmentVariables(): void {
  const requiredVars = ['RPC_URL'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
  
  // Validate RPC URL format
  const rpcUrl = process.env.RPC_URL;
  if (rpcUrl && !rpcUrl.startsWith('http')) {
    throw new Error('RPC_URL must be a valid HTTP/HTTPS URL');
  }
  
  // Validate program ID if provided
  const programId = process.env.REWARD_POOL_PROGRAM_ID;
  if (programId && programId !== '11111111111111111111111111111111') {
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    if (!base58Regex.test(programId)) {
      throw new Error('REWARD_POOL_PROGRAM_ID must be a valid base58 string');
    }
  }
}

// Validate environment variables on module load
try {
  validateEnvironmentVariables();
} catch (error) {
  console.error('Monitoring configuration validation failed:', error);
  // Don't throw here to allow the application to start, but log the error
}

// Default monitoring configuration
export const defaultMonitoringConfig: MonitoringConfig = {
  // General settings
  enabled: true,
  pollInterval: 5000, // 5 seconds
  maxRetries: 3,
  retryDelay: 1000, // 1 second
  
  // Smart contract settings
  programId: process.env.REWARD_POOL_PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
  rpcUrl: process.env.RPC_URL || 'https://api.devnet.solana.com',
  commitment: 'confirmed',
  
  // Alert settings
  alertChannels: [],
  alertRules: [],
  defaultSeverity: AlertSeverity.MEDIUM,
  
  // Health check settings
  healthCheckInterval: 30000, // 30 seconds
  healthCheckTimeout: 10000, // 10 seconds
  
  // Metrics settings
  metricsRetentionPeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
  metricsUpdateInterval: 60000, // 1 minute
  
  // Advanced settings
  enableWebSocket: false,
  enableTransactionParsing: true,
  enableBalanceMonitoring: true,
  enableSuspiciousActivityDetection: true,
  
  // Thresholds
  lowBalanceThreshold: 0.01, // 0.01 SOL
  highVolumeThreshold: 100, // 100 SOL
  suspiciousActivityThreshold: 10, // 10 events per minute
  
  // Filters
  addressFilters: [],
  poolIdFilters: [],
  tokenMintFilters: [],
  
  // Logging
  logLevel: 'info',
  enableEventLogging: true
};

// Example alert rules
export const exampleAlertRules: AlertRule[] = [
  {
    id: 'high-value-transactions',
    name: 'High Value Transactions',
    description: 'Alert when transactions exceed 100 SOL',
    enabled: true,
    severity: AlertSeverity.HIGH,
    eventTypes: [EventType.REWARDS_WITHDRAWN, EventType.TASK_COMPLETION_RECORDED],
    conditions: [
      {
        field: 'amount',
        operator: 'greater_than',
        value: 100
      }
    ],
    channels: ['discord-alerts'],
    cooldown: 300000 // 5 minutes
  },
  {
    id: 'contract-errors',
    name: 'Contract Errors',
    description: 'Alert on any contract errors',
    enabled: true,
    severity: AlertSeverity.CRITICAL,
    eventTypes: [EventType.CONTRACT_ERROR, EventType.TRANSACTION_FAILED],
    channels: ['discord-alerts', 'email-alerts'],
    cooldown: 60000 // 1 minute
  },
  {
    id: 'pool-paused',
    name: 'Pool Paused',
    description: 'Alert when reward pool is paused',
    enabled: true,
    severity: AlertSeverity.HIGH,
    eventTypes: [EventType.POOL_PAUSED],
    channels: ['discord-alerts', 'slack-alerts'],
    cooldown: 0 // No cooldown for critical events
  },
  {
    id: 'suspicious-activity',
    name: 'Suspicious Activity',
    description: 'Alert on suspicious activity patterns',
    enabled: true,
    severity: AlertSeverity.HIGH,
    eventTypes: [EventType.SUSPICIOUS_ACTIVITY],
    rateLimit: {
      maxEvents: 5,
      window: 60000 // 1 minute
    },
    channels: ['discord-alerts', 'slack-alerts'],
    cooldown: 300000 // 5 minutes
  },
  {
    id: 'low-balance',
    name: 'Low Balance',
    description: 'Alert when addresses have low balance',
    enabled: true,
    severity: AlertSeverity.MEDIUM,
    eventTypes: [EventType.BALANCE_LOW],
    conditions: [
      {
        field: 'amount',
        operator: 'less_than',
        value: 0.01
      }
    ],
    channels: ['discord-alerts'],
    cooldown: 1800000 // 30 minutes
  },
  {
    id: 'high-volume-period',
    name: 'High Volume Period',
    description: 'Alert when transaction volume is high',
    enabled: true,
    severity: AlertSeverity.MEDIUM,
    metricThresholds: {
      eventsPerHour: 100
    },
    channels: ['discord-alerts'],
    cooldown: 900000 // 15 minutes
  }
];

// Example alert channels
export const exampleAlertChannels: AlertChannelUnion[] = [
  {
    id: 'discord-alerts',
    name: 'Discord Alerts',
    type: ChannelType.DISCORD,
    enabled: true,
    config: {
      webhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
      username: 'Smart Contract Monitor',
      avatarUrl: 'https://example.com/avatar.png',
      mentions: ['@here']
    }
  },
  {
    id: 'slack-alerts',
    name: 'Slack Alerts',
    type: ChannelType.SLACK,
    enabled: true,
    config: {
      webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
      channel: '#alerts',
      username: 'Smart Contract Monitor',
      iconEmoji: ':warning:'
    }
  },
  {
    id: 'email-alerts',
    name: 'Email Alerts',
    type: ChannelType.EMAIL,
    enabled: false, // Disabled by default
    config: {
      smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
      smtpPort: parseInt(process.env.SMTP_PORT || '587'),
      username: process.env.SMTP_USERNAME || '',
      password: process.env.SMTP_PASSWORD || '',
      fromEmail: process.env.FROM_EMAIL || 'alerts@example.com',
      toEmails: (process.env.TO_EMAILS || '').split(',').filter(Boolean),
      subjectPrefix: '[ALERT]'
    }
  },
  {
    id: 'webhook-alerts',
    name: 'Webhook Alerts',
    type: ChannelType.WEBHOOK,
    enabled: false, // Disabled by default
    config: {
      url: process.env.WEBHOOK_URL || '',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WEBHOOK_TOKEN || ''}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    }
  },
  {
    id: 'telegram-alerts',
    name: 'Telegram Alerts',
    type: ChannelType.TELEGRAM,
    enabled: false, // Disabled by default
    config: {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
      chatIds: (process.env.TELEGRAM_CHAT_IDS || '').split(',').filter(Boolean),
      parseMode: 'HTML'
    }
  }
];

// Production configuration
export const productionMonitoringConfig: MonitoringConfig = {
  ...defaultMonitoringConfig,
  pollInterval: 2000, // 2 seconds for faster response
  healthCheckInterval: 15000, // 15 seconds
  logLevel: 'warn',
  enableEventLogging: false, // Disable detailed logging in production
  alertChannels: exampleAlertChannels.filter(channel => channel.enabled),
  alertRules: exampleAlertRules.filter(rule => rule.enabled)
};

// Development configuration
export const developmentMonitoringConfig: MonitoringConfig = {
  ...defaultMonitoringConfig,
  pollInterval: 10000, // 10 seconds for development
  healthCheckInterval: 60000, // 1 minute
  logLevel: 'debug',
  enableEventLogging: true,
  alertChannels: exampleAlertChannels,
  alertRules: exampleAlertRules
};

// Test configuration
export const testMonitoringConfig: MonitoringConfig = {
  ...defaultMonitoringConfig,
  enabled: false, // Disabled for tests
  pollInterval: 1000,
  healthCheckInterval: 5000,
  logLevel: 'error',
  enableEventLogging: false,
  alertChannels: [],
  alertRules: []
};

// Get configuration based on environment
export function getMonitoringConfig(): MonitoringConfig {
  const env = process.env.NODE_ENV || 'development';
  
  switch (env) {
    case 'production':
      return productionMonitoringConfig;
    case 'test':
      return testMonitoringConfig;
    case 'development':
    default:
      return developmentMonitoringConfig;
  }
}

// Validate configuration
export function validateMonitoringConfig(config: MonitoringConfig): string[] {
  const errors: string[] = [];
  
  if (!config.programId || config.programId === '11111111111111111111111111111111') {
    errors.push('Invalid program ID');
  }
  
  if (!config.rpcUrl) {
    errors.push('RPC URL is required');
  }
  
  if (config.pollInterval < 1000) {
    errors.push('Poll interval must be at least 1000ms');
  }
  
  if (config.healthCheckInterval < 5000) {
    errors.push('Health check interval must be at least 5000ms');
  }
  
  // Validate alert channels
  for (const channel of config.alertChannels) {
    if (!channel.name) {
      errors.push('Alert channel must have a name');
    }
    
    if (!channel.enabled) continue;
    
    switch (channel.type) {
      case ChannelType.DISCORD:
        if (!channel.config.webhookUrl) {
          errors.push(`Discord channel '${channel.name}' must have a webhook URL`);
        }
        break;
      case ChannelType.SLACK:
        if (!channel.config.webhookUrl) {
          errors.push(`Slack channel '${channel.name}' must have a webhook URL`);
        }
        break;
      case ChannelType.EMAIL:
        if (!channel.config.smtpHost || !channel.config.username || !channel.config.password) {
          errors.push(`Email channel '${channel.name}' must have SMTP configuration`);
        }
        if (!channel.config.toEmails || channel.config.toEmails.length === 0) {
          errors.push(`Email channel '${channel.name}' must have recipient emails`);
        }
        break;
      case ChannelType.WEBHOOK:
        if (!channel.config.url) {
          errors.push(`Webhook channel '${channel.name}' must have a URL`);
        }
        break;
      case ChannelType.TELEGRAM:
        if (!channel.config.botToken) {
          errors.push(`Telegram channel '${channel.name}' must have a bot token`);
        }
        if (!channel.config.chatIds || channel.config.chatIds.length === 0) {
          errors.push(`Telegram channel '${channel.name}' must have chat IDs`);
        }
        break;
    }
  }
  
  return errors;
} 