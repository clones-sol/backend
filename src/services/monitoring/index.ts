import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { Webhook } from '../webhook/index.ts';
import { AlertChannel, AlertRule, MonitoringConfig, SmartContractEvent, EventType, AlertSeverity } from '../../types/monitoring.ts';
import { MonitoringService } from './monitoringService.ts';
import { AlertService } from './alertService.ts';
import { MetricsService } from './metricsService.ts';
import { HealthCheckService } from './healthCheckService.ts';

export class SmartContractMonitoring {
  private static instance: SmartContractMonitoring | null = null;
  private eventEmitter: EventEmitter;
  private monitoringService: MonitoringService;
  private alertService: AlertService;
  private metricsService: MetricsService;
  private healthCheckService: HealthCheckService;
  private config: MonitoringConfig;
  private isRunning: boolean = false;

  private constructor(connection: Connection, config: MonitoringConfig) {
    this.eventEmitter = new EventEmitter();
    this.config = config;
    
    // Initialize services
    this.monitoringService = new MonitoringService(connection, config);
    this.alertService = new AlertService(config.alertChannels);
    this.metricsService = new MetricsService();
    this.healthCheckService = new HealthCheckService(connection, config);
    
    // Set up event listeners
    this.setupEventListeners();
  }

  public static getInstance(connection: Connection, config: MonitoringConfig): SmartContractMonitoring {
    if (!SmartContractMonitoring.instance) {
      SmartContractMonitoring.instance = new SmartContractMonitoring(connection, config);
    }
    return SmartContractMonitoring.instance;
  }

  private setupEventListeners(): void {
    // Listen for smart contract events
    this.monitoringService.on('event', (event: SmartContractEvent) => {
      this.handleSmartContractEvent(event);
    });

    // Listen for health check events
    this.healthCheckService.on('health-check', (status: any) => {
      this.handleHealthCheck(status);
    });

    // Listen for metrics updates
    this.metricsService.on('metrics-update', (metrics: any) => {
      this.handleMetricsUpdate(metrics);
    });
  }

  private async handleSmartContractEvent(event: SmartContractEvent): Promise<void> {
    try {
      // Record metrics
      this.metricsService.recordEvent(event);

      // Check alert rules
      const triggeredRules = this.checkAlertRules(event);
      
      if (triggeredRules.length > 0) {
        await this.alertService.sendAlerts(event, triggeredRules);
      }

      // Emit event for other services
      this.eventEmitter.emit('smart-contract-event', event);
      
      console.log(`[MONITORING] Processed event: ${event.type} - ${event.signature}`);
    } catch (error) {
      console.error('[MONITORING] Error handling smart contract event:', error);
      await this.alertService.sendSystemAlert({
        type: 'MONITORING_ERROR',
        severity: AlertSeverity.HIGH,
        message: `Error processing smart contract event: ${(error as Error).message}`,
        timestamp: new Date(),
        metadata: { event }
      });
    }
  }

  private checkAlertRules(event: SmartContractEvent): AlertRule[] {
    const triggeredRules: AlertRule[] = [];
    
    for (const rule of this.config.alertRules) {
      if (this.evaluateRule(event, rule)) {
        triggeredRules.push(rule);
      }
    }
    
    return triggeredRules;
  }

  private evaluateRule(event: SmartContractEvent, rule: AlertRule): boolean {
    // Check event type
    if (rule.eventTypes && !rule.eventTypes.includes(event.type)) {
      return false;
    }

    // Check severity
    if (rule.minSeverity && event.severity < rule.minSeverity) {
      return false;
    }

    // Check conditions
    if (rule.conditions) {
      for (const condition of rule.conditions) {
        if (!this.evaluateCondition(event, condition)) {
          return false;
        }
      }
    }

    // Check rate limiting
    if (rule.rateLimit) {
      const recentEvents = this.metricsService.getRecentEvents(rule.rateLimit.window);
      const matchingEvents = recentEvents.filter(e => 
        e.type === event.type && 
        this.evaluateRule(e, { ...rule, rateLimit: undefined })
      );
      
      if (matchingEvents.length >= rule.rateLimit.maxEvents) {
        return false;
      }
    }

    return true;
  }

  private evaluateCondition(event: SmartContractEvent, condition: any): boolean {
    const { field, operator, value } = condition;
    
    let fieldValue: any;
    switch (field) {
      case 'amount':
        fieldValue = event.amount;
        break;
      case 'address':
        fieldValue = event.address;
        break;
      case 'poolId':
        fieldValue = event.poolId;
        break;
      case 'tokenMint':
        fieldValue = event.tokenMint;
        break;
      case 'error':
        fieldValue = event.error;
        break;
      default:
        fieldValue = (event as any)[field];
    }

    switch (operator) {
      case 'equals':
        return fieldValue === value;
      case 'not_equals':
        return fieldValue !== value;
      case 'greater_than':
        return fieldValue > value;
      case 'less_than':
        return fieldValue < value;
      case 'contains':
        return String(fieldValue).includes(String(value));
      case 'not_contains':
        return !String(fieldValue).includes(String(value));
      case 'regex':
        return new RegExp(value).test(String(fieldValue));
      default:
        return false;
    }
  }

  private async handleHealthCheck(status: any): Promise<void> {
    if (status.status === 'unhealthy') {
      await this.alertService.sendSystemAlert({
        type: 'HEALTH_CHECK_FAILED',
        severity: AlertSeverity.HIGH,
        message: `Health check failed: ${status.message}`,
        timestamp: new Date(),
        metadata: status
      });
    }
  }

  private async handleMetricsUpdate(metrics: any): Promise<void> {
    // Check for metric-based alerts
    const metricRules = this.config.alertRules.filter(rule => rule.metricThresholds);
    
    for (const rule of metricRules) {
      if (rule.metricThresholds) {
        for (const [metric, threshold] of Object.entries(rule.metricThresholds)) {
          const currentValue = metrics[metric];
          if (currentValue !== undefined && currentValue > threshold) {
            await this.alertService.sendSystemAlert({
              type: 'METRIC_THRESHOLD_EXCEEDED',
              severity: rule.severity || AlertSeverity.MEDIUM,
              message: `Metric threshold exceeded: ${metric} = ${currentValue} (threshold: ${threshold})`,
              timestamp: new Date(),
              metadata: { metric, currentValue, threshold, rule }
            });
          }
        }
      }
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[MONITORING] Already running');
      return;
    }

    try {
      console.log('[MONITORING] Starting smart contract monitoring...');
      
      // Start all services
      await this.monitoringService.start();
      await this.healthCheckService.start();
      await this.metricsService.start();
      
      this.isRunning = true;
      console.log('[MONITORING] Smart contract monitoring started successfully');
    } catch (error) {
      console.error('[MONITORING] Failed to start monitoring:', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      console.log('[MONITORING] Stopping smart contract monitoring...');
      
      // Stop all services
      await this.monitoringService.stop();
      await this.healthCheckService.stop();
      await this.metricsService.stop();
      
      this.isRunning = false;
      console.log('[MONITORING] Smart contract monitoring stopped');
    } catch (error) {
      console.error('[MONITORING] Error stopping monitoring:', error);
      throw error;
    }
  }

  public async addAlertRule(rule: AlertRule): Promise<void> {
    this.config.alertRules.push(rule);
    console.log(`[MONITORING] Added alert rule: ${rule.name}`);
  }

  public async removeAlertRule(ruleName: string): Promise<void> {
    const index = this.config.alertRules.findIndex(rule => rule.name === ruleName);
    if (index !== -1) {
      this.config.alertRules.splice(index, 1);
      console.log(`[MONITORING] Removed alert rule: ${ruleName}`);
    }
  }

  public async addAlertChannel(channel: AlertChannel): Promise<void> {
    this.config.alertChannels.push(channel);
    this.alertService.addChannel(channel);
    console.log(`[MONITORING] Added alert channel: ${channel.name}`);
  }

  public async removeAlertChannel(channelName: string): Promise<void> {
    const index = this.config.alertChannels.findIndex(channel => channel.name === channelName);
    if (index !== -1) {
      this.config.alertChannels.splice(index, 1);
      this.alertService.removeChannel(channelName);
      console.log(`[MONITORING] Removed alert channel: ${channelName}`);
    }
  }

  public getMetrics(): any {
    return this.metricsService.getMetrics();
  }

  public getHealthStatus(): any {
    return this.healthCheckService.getStatus();
  }

  public getRecentEvents(limit: number = 100): SmartContractEvent[] {
    return this.metricsService.getRecentEvents(limit);
  }

  public on(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  public off(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.off(event, listener);
  }

  public isActive(): boolean {
    return this.isRunning;
  }
} 