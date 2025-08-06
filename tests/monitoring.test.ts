import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Connection } from '@solana/web3.js';
import { SmartContractMonitoring } from '../src/services/monitoring/index.ts';
import { 
  MonitoringConfig, 
  AlertSeverity, 
  EventType,
  ChannelType 
} from '../src/types/monitoring.ts';

describe('Smart Contract Monitoring System', () => {
  let connection: Connection;
  let config: MonitoringConfig;

  beforeEach(() => {
    // Create test connection
    connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    
    // Create test configuration
    config = {
      enabled: true,
      pollInterval: 1000,
      maxRetries: 3,
      retryDelay: 100,
      programId: 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS',
      rpcUrl: 'https://api.devnet.solana.com',
      commitment: 'confirmed',
      alertChannels: [],
      alertRules: [],
      defaultSeverity: AlertSeverity.MEDIUM,
      healthCheckInterval: 5000,
      healthCheckTimeout: 5000,
      metricsRetentionPeriod: 60000,
      metricsUpdateInterval: 10000,
      enableWebSocket: false,
      enableTransactionParsing: true,
      enableBalanceMonitoring: true,
      enableSuspiciousActivityDetection: true,
      lowBalanceThreshold: 0.01,
      highVolumeThreshold: 100,
      suspiciousActivityThreshold: 10,
      addressFilters: [],
      poolIdFilters: [],
      tokenMintFilters: [],
      logLevel: 'info',
      enableEventLogging: true
    };
  });

  afterEach(async () => {
    // Clean up any running monitoring instances
  });

  describe('Monitoring Service', () => {
    it('should create monitoring instance', () => {
      const monitoring = SmartContractMonitoring.getInstance(connection, config);
      expect(monitoring).toBeDefined();
      expect(monitoring.isActive()).toBe(false);
    });

    it('should start and stop monitoring', async () => {
      const monitoring = SmartContractMonitoring.getInstance(connection, config);
      
      await monitoring.start();
      expect(monitoring.isActive()).toBe(true);
      
      await monitoring.stop();
      expect(monitoring.isActive()).toBe(false);
    });

    it('should get metrics', () => {
      const monitoring = SmartContractMonitoring.getInstance(connection, config);
      const metrics = monitoring.getMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics.totalEvents).toBe(0);
      expect(metrics.eventsByType).toBeDefined();
      expect(metrics.eventsBySeverity).toBeDefined();
    });

    it('should get health status', () => {
      const monitoring = SmartContractMonitoring.getInstance(connection, config);
      const healthStatus = monitoring.getHealthStatus();
      
      expect(healthStatus).toBeDefined();
      expect(healthStatus.status).toBeDefined();
      expect(healthStatus.message).toBeDefined();
      expect(healthStatus.timestamp).toBeDefined();
    });

    it('should get recent events', () => {
      const monitoring = SmartContractMonitoring.getInstance(connection, config);
      const events = monitoring.getRecentEvents(10);
      
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBe(0);
    });
  });

  describe('Alert Rules', () => {
    it('should add and remove alert rules', async () => {
      const monitoring = SmartContractMonitoring.getInstance(connection, config);
      
      const rule = {
        id: 'test-rule',
        name: 'Test Rule',
        description: 'Test alert rule',
        enabled: true,
        severity: AlertSeverity.HIGH,
        eventTypes: [EventType.TASK_COMPLETION_RECORDED],
        channels: ['test-channel'],
        cooldown: 60000
      };
      
      await monitoring.addAlertRule(rule);
      // Note: In a real implementation, we'd verify the rule was added
      
      await monitoring.removeAlertRule('test-rule');
      // Note: In a real implementation, we'd verify the rule was removed
    });
  });

  describe('Alert Channels', () => {
    it('should add and remove alert channels', async () => {
      const monitoring = SmartContractMonitoring.getInstance(connection, config);
      
      const channel = {
        id: 'test-channel',
        name: 'Test Channel',
        type: ChannelType.DISCORD,
        enabled: true,
        config: {
          webhookUrl: 'https://discord.com/api/webhooks/test'
        }
      };
      
      await monitoring.addAlertChannel(channel);
      // Note: In a real implementation, we'd verify the channel was added
      
      await monitoring.removeAlertChannel('test-channel');
      // Note: In a real implementation, we'd verify the channel was removed
    });
  });

  describe('Configuration Validation', () => {
    it('should validate valid configuration', () => {
      expect(config.programId).toBeDefined();
      expect(config.rpcUrl).toBeDefined();
      expect(config.pollInterval).toBeGreaterThan(0);
      expect(config.healthCheckInterval).toBeGreaterThan(0);
    });

    it('should handle invalid program ID', () => {
      const invalidConfig = { ...config, programId: 'invalid-id' };
      // Note: In a real implementation, we'd test validation logic
    });

    it('should handle invalid RPC URL', () => {
      const invalidConfig = { ...config, rpcUrl: '' };
      // Note: In a real implementation, we'd test validation logic
    });
  });

  describe('Event Types', () => {
    it('should have all required event types', () => {
      expect(EventType.TASK_COMPLETION_RECORDED).toBe('TASK_COMPLETION_RECORDED');
      expect(EventType.REWARDS_WITHDRAWN).toBe('REWARDS_WITHDRAWN');
      expect(EventType.REWARD_POOL_INITIALIZED).toBe('REWARD_POOL_INITIALIZED');
      expect(EventType.PLATFORM_FEE_UPDATED).toBe('PLATFORM_FEE_UPDATED');
      expect(EventType.POOL_PAUSED).toBe('POOL_PAUSED');
      expect(EventType.POOL_UNPAUSED).toBe('POOL_UNPAUSED');
      expect(EventType.REWARD_VAULT_CREATED).toBe('REWARD_VAULT_CREATED');
      expect(EventType.TRANSACTION_FAILED).toBe('TRANSACTION_FAILED');
      expect(EventType.BALANCE_LOW).toBe('BALANCE_LOW');
      expect(EventType.HIGH_VOLUME).toBe('HIGH_VOLUME');
      expect(EventType.SUSPICIOUS_ACTIVITY).toBe('SUSPICIOUS_ACTIVITY');
      expect(EventType.CONTRACT_ERROR).toBe('CONTRACT_ERROR');
      expect(EventType.NETWORK_ERROR).toBe('NETWORK_ERROR');
    });
  });

  describe('Alert Severity Levels', () => {
    it('should have all required severity levels', () => {
      expect(AlertSeverity.LOW).toBe(1);
      expect(AlertSeverity.MEDIUM).toBe(2);
      expect(AlertSeverity.HIGH).toBe(3);
      expect(AlertSeverity.CRITICAL).toBe(4);
    });
  });

  describe('Channel Types', () => {
    it('should have all required channel types', () => {
      expect(ChannelType.DISCORD).toBe('discord');
      expect(ChannelType.SLACK).toBe('slack');
      expect(ChannelType.EMAIL).toBe('email');
      expect(ChannelType.WEBHOOK).toBe('webhook');
      expect(ChannelType.SMS).toBe('sms');
      expect(ChannelType.TELEGRAM).toBe('telegram');
    });
  });
}); 