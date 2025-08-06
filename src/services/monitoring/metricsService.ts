import { EventEmitter } from 'events';
import { 
  SmartContractEvent, 
  EventType, 
  AlertSeverity, 
  Metrics,
  EventFilter 
} from '../../types/monitoring.ts';

export class MetricsService extends EventEmitter {
  private events: SmartContractEvent[] = [];
  private metrics: Metrics;
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private startTime: Date = new Date();
  private maxEvents: number = 10000;

  constructor() {
    super();
    this.initializeMetrics();
  }

  private initializeMetrics(): void {
    this.metrics = {
      totalEvents: 0,
      eventsByType: {} as Record<EventType, number>,
      eventsBySeverity: {} as Record<AlertSeverity, number>,
      averageResponseTime: 0,
      errorRate: 0,
      uptime: 0,
      customMetrics: {}
    };

    // Initialize counters for all event types
    Object.values(EventType).forEach(type => {
      this.metrics.eventsByType[type] = 0;
    });

    // Initialize counters for all severity levels
    Object.values(AlertSeverity).forEach(severity => {
      this.metrics.eventsBySeverity[severity] = 0;
    });
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[METRICS] Service already running');
      return;
    }

    try {
      console.log('[METRICS] Starting metrics service...');
      
      this.startTime = new Date();
      this.startUpdateInterval();
      
      this.isRunning = true;
      console.log('[METRICS] Metrics service started successfully');
    } catch (error) {
      console.error('[METRICS] Failed to start metrics service:', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      console.log('[METRICS] Stopping metrics service...');
      
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
      }
      
      this.isRunning = false;
      console.log('[METRICS] Metrics service stopped');
    } catch (error) {
      console.error('[METRICS] Error stopping metrics service:', error);
      throw error;
    }
  }

  private startUpdateInterval(): void {
    this.updateInterval = setInterval(() => {
      this.updateMetrics();
    }, 60000); // Update every minute
  }

  public recordEvent(event: SmartContractEvent): void {
    try {
      // Add event to list
      this.events.push(event);
      
      // Keep list size manageable
      if (this.events.length > this.maxEvents) {
        this.events = this.events.slice(-this.maxEvents);
      }

      // Update metrics immediately
      this.updateEventMetrics(event);
      
      // Emit metrics update
      this.emit('metrics-update', this.metrics);
      
    } catch (error) {
      console.error('[METRICS] Error recording event:', error);
    }
  }

  private updateEventMetrics(event: SmartContractEvent): void {
    // Update total events
    this.metrics.totalEvents++;

    // Update events by type
    this.metrics.eventsByType[event.type]++;

    // Update events by severity
    this.metrics.eventsBySeverity[event.severity]++;

    // Update last event time
    this.metrics.lastEventTime = event.timestamp;

    // Update error rate
    const errorEvents = this.events.filter(e => 
      e.type === EventType.TRANSACTION_FAILED || 
      e.type === EventType.CONTRACT_ERROR || 
      e.type === EventType.NETWORK_ERROR ||
      e.error
    );
    this.metrics.errorRate = errorEvents.length / this.metrics.totalEvents;

    // Update custom metrics
    this.updateCustomMetrics(event);
  }

  private updateCustomMetrics(event: SmartContractEvent): void {
    // Track unique addresses
    if (event.address) {
      const uniqueAddresses = new Set(
        this.events
          .filter(e => e.address)
          .map(e => e.address!)
      );
      this.metrics.customMetrics.uniqueAddresses = uniqueAddresses.size;
    }

    // Track unique pools
    if (event.poolId) {
      const uniquePools = new Set(
        this.events
          .filter(e => e.poolId)
          .map(e => e.poolId!)
      );
      this.metrics.customMetrics.uniquePools = uniquePools.size;
    }

    // Track total volume
    if (event.amount) {
      this.metrics.customMetrics.totalVolume = 
        (this.metrics.customMetrics.totalVolume || 0) + event.amount;
    }

    // Track average transaction amount
    const eventsWithAmount = this.events.filter(e => e.amount);
    if (eventsWithAmount.length > 0) {
      const totalAmount = eventsWithAmount.reduce((sum, e) => sum + (e.amount || 0), 0);
      this.metrics.customMetrics.averageTransactionAmount = totalAmount / eventsWithAmount.length;
    }

    // Track events per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentEvents = this.events.filter(e => e.timestamp > oneHourAgo);
    this.metrics.customMetrics.eventsPerHour = recentEvents.length;

    // Track success rate
    const successfulEvents = this.events.filter(e => e.success !== false);
    this.metrics.customMetrics.successRate = successfulEvents.length / this.metrics.totalEvents;
  }

  private updateMetrics(): void {
    try {
      // Update uptime
      this.metrics.uptime = Date.now() - this.startTime.getTime();

      // Update average response time (simplified)
      const recentEvents = this.events.slice(-100);
      if (recentEvents.length > 0) {
        const totalTime = recentEvents.reduce((sum, event) => {
          return sum + (event.metadata?.processingTime || 0);
        }, 0);
        this.metrics.averageResponseTime = totalTime / recentEvents.length;
      }

      // Emit metrics update
      this.emit('metrics-update', this.metrics);
      
    } catch (error) {
      console.error('[METRICS] Error updating metrics:', error);
    }
  }

  public getMetrics(): Metrics {
    return { ...this.metrics };
  }

  public getRecentEvents(windowMs: number = 60000): SmartContractEvent[] {
    const cutoffTime = new Date(Date.now() - windowMs);
    return this.events.filter(event => event.timestamp > cutoffTime);
  }

  public getEvents(filter?: EventFilter): SmartContractEvent[] {
    let filteredEvents = [...this.events];

    if (!filter) {
      return filteredEvents;
    }

    // Filter by type
    if (filter.types && filter.types.length > 0) {
      filteredEvents = filteredEvents.filter(event => filter.types!.includes(event.type));
    }

    // Filter by severity
    if (filter.severity && filter.severity.length > 0) {
      filteredEvents = filteredEvents.filter(event => filter.severity!.includes(event.severity));
    }

    // Filter by address
    if (filter.addresses && filter.addresses.length > 0) {
      filteredEvents = filteredEvents.filter(event => 
        event.address && filter.addresses!.includes(event.address)
      );
    }

    // Filter by pool ID
    if (filter.poolIds && filter.poolIds.length > 0) {
      filteredEvents = filteredEvents.filter(event => 
        event.poolId && filter.poolIds!.includes(event.poolId)
      );
    }

    // Filter by token mint
    if (filter.tokenMints && filter.tokenMints.length > 0) {
      filteredEvents = filteredEvents.filter(event => 
        event.tokenMint && filter.tokenMints!.includes(event.tokenMint)
      );
    }

    // Filter by date range
    if (filter.dateRange) {
      filteredEvents = filteredEvents.filter(event => 
        event.timestamp >= filter.dateRange!.start && 
        event.timestamp <= filter.dateRange!.end
      );
    }

    // Apply limit and offset
    const offset = filter.offset || 0;
    const limit = filter.limit || filteredEvents.length;
    
    return filteredEvents.slice(offset, offset + limit);
  }

  public getTopAddresses(limit: number = 10): Array<{ address: string; eventCount: number; totalAmount: number }> {
    const addressStats = new Map<string, { eventCount: number; totalAmount: number }>();

    for (const event of this.events) {
      if (event.address) {
        const stats = addressStats.get(event.address) || { eventCount: 0, totalAmount: 0 };
        stats.eventCount++;
        if (event.amount) {
          stats.totalAmount += event.amount;
        }
        addressStats.set(event.address, stats);
      }
    }

    return Array.from(addressStats.entries())
      .map(([address, stats]) => ({ address, ...stats }))
      .sort((a, b) => b.eventCount - a.eventCount)
      .slice(0, limit);
  }

  public getTopPools(limit: number = 10): Array<{ poolId: string; eventCount: number; totalAmount: number }> {
    const poolStats = new Map<string, { eventCount: number; totalAmount: number }>();

    for (const event of this.events) {
      if (event.poolId) {
        const stats = poolStats.get(event.poolId) || { eventCount: 0, totalAmount: 0 };
        stats.eventCount++;
        if (event.amount) {
          stats.totalAmount += event.amount;
        }
        poolStats.set(event.poolId, stats);
      }
    }

    return Array.from(poolStats.entries())
      .map(([poolId, stats]) => ({ poolId, ...stats }))
      .sort((a, b) => b.eventCount - a.eventCount)
      .slice(0, limit);
  }

  public getEventTrends(timeWindow: number = 24 * 60 * 60 * 1000, interval: number = 60 * 60 * 1000): Array<{ timestamp: Date; count: number; type: EventType }> {
    const trends: Array<{ timestamp: Date; count: number; type: EventType }> = [];
    const now = Date.now();
    const startTime = now - timeWindow;

    // Group events by type and time interval
    const eventGroups = new Map<string, Map<number, number>>();

    for (const event of this.events) {
      if (event.timestamp.getTime() < startTime) continue;

      const eventType = event.type;
      const timeSlot = Math.floor(event.timestamp.getTime() / interval) * interval;

      if (!eventGroups.has(eventType)) {
        eventGroups.set(eventType, new Map());
      }

      const typeGroup = eventGroups.get(eventType)!;
      typeGroup.set(timeSlot, (typeGroup.get(timeSlot) || 0) + 1);
    }

    // Convert to trends array
    for (const [eventType, timeSlots] of eventGroups) {
      for (const [timestamp, count] of timeSlots) {
        trends.push({
          timestamp: new Date(timestamp),
          count,
          type: eventType as EventType
        });
      }
    }

    return trends.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  public getErrorAnalysis(): {
    errorTypes: Record<string, number>;
    errorTrends: Array<{ timestamp: Date; errorCount: number }>;
    topErrorSources: Array<{ source: string; count: number }>;
  } {
    const errorEvents = this.events.filter(e => e.error || 
      e.type === EventType.TRANSACTION_FAILED || 
      e.type === EventType.CONTRACT_ERROR || 
      e.type === EventType.NETWORK_ERROR
    );

    // Error types
    const errorTypes: Record<string, number> = {};
    for (const event of errorEvents) {
      const errorType = event.type;
      errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
    }

    // Error trends (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentErrors = errorEvents.filter(e => e.timestamp > oneDayAgo);
    const errorTrends: Array<{ timestamp: Date; errorCount: number }> = [];
    
    for (let i = 0; i < 24; i++) {
      const hourStart = new Date(oneDayAgo.getTime() + i * 60 * 60 * 1000);
      const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);
      const hourErrors = recentErrors.filter(e => 
        e.timestamp >= hourStart && e.timestamp < hourEnd
      );
      errorTrends.push({
        timestamp: hourStart,
        errorCount: hourErrors.length
      });
    }

    // Top error sources
    const errorSources = new Map<string, number>();
    for (const event of errorEvents) {
      const source = event.address || event.poolId || 'unknown';
      errorSources.set(source, (errorSources.get(source) || 0) + 1);
    }

    const topErrorSources = Array.from(errorSources.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      errorTypes,
      errorTrends,
      topErrorSources
    };
  }

  public getPerformanceMetrics(): {
    averageResponseTime: number;
    throughput: number;
    successRate: number;
    errorRate: number;
  } {
    const recentEvents = this.events.slice(-1000);
    
    const averageResponseTime = recentEvents.reduce((sum, event) => 
      sum + (event.metadata?.processingTime || 0), 0
    ) / recentEvents.length;

    const successfulEvents = recentEvents.filter(e => e.success !== false);
    const successRate = successfulEvents.length / recentEvents.length;
    const errorRate = 1 - successRate;

    // Calculate throughput (events per minute)
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const recentMinuteEvents = this.events.filter(e => e.timestamp > oneMinuteAgo);
    const throughput = recentMinuteEvents.length;

    return {
      averageResponseTime,
      throughput,
      successRate,
      errorRate
    };
  }

  public reset(): void {
    this.events = [];
    this.initializeMetrics();
    this.startTime = new Date();
    console.log('[METRICS] Metrics reset');
  }

  public getStatus(): { isRunning: boolean; eventCount: number; uptime: number } {
    return {
      isRunning: this.isRunning,
      eventCount: this.events.length,
      uptime: Date.now() - this.startTime.getTime()
    };
  }
} 