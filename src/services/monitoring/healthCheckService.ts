import { EventEmitter } from 'events';
import { Connection, PublicKey } from '@solana/web3.js';
import { 
  MonitoringConfig, 
  HealthStatus,
  AlertSeverity 
} from '../../types/monitoring.ts';

export class HealthCheckService extends EventEmitter {
  private connection: Connection;
  private config: MonitoringConfig;
  private healthInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastHealthStatus: HealthStatus;
  private consecutiveFailures: Map<string, number> = new Map();
  private maxConsecutiveFailures: number = 3;

  constructor(connection: Connection, config: MonitoringConfig) {
    super();
    this.connection = connection;
    this.config = config;
    this.lastHealthStatus = this.createInitialHealthStatus();
  }

  private createInitialHealthStatus(): HealthStatus {
    return {
      status: 'healthy',
      message: 'Health checks not started',
      timestamp: new Date(),
      checks: {}
    };
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[HEALTH] Service already running');
      return;
    }

    try {
      console.log('[HEALTH] Starting health check service...');
      
      // Run initial health check
      await this.runHealthChecks();
      
      // Start periodic health checks
      this.startHealthInterval();
      
      this.isRunning = true;
      console.log('[HEALTH] Health check service started successfully');
    } catch (error) {
      console.error('[HEALTH] Failed to start health check service:', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      console.log('[HEALTH] Stopping health check service...');
      
      if (this.healthInterval) {
        clearInterval(this.healthInterval);
        this.healthInterval = null;
      }
      
      this.isRunning = false;
      console.log('[HEALTH] Health check service stopped');
    } catch (error) {
      console.error('[HEALTH] Error stopping health check service:', error);
      throw error;
    }
  }

  private startHealthInterval(): void {
    this.healthInterval = setInterval(async () => {
      try {
        await this.runHealthChecks();
      } catch (error) {
        console.error('[HEALTH] Error running health checks:', error);
      }
    }, this.config.healthCheckInterval);
  }

  private async runHealthChecks(): Promise<void> {
    const startTime = Date.now();
    const checks: HealthStatus['checks'] = {};

    try {
      // Check blockchain connectivity
      checks.blockchain = await this.checkBlockchainConnectivity();

      // Check RPC endpoint health
      checks.rpcEndpoint = await this.checkRPCEndpoint();

      // Check program accessibility
      checks.programAccess = await this.checkProgramAccess();

      // Check network status
      checks.networkStatus = await this.checkNetworkStatus();

      // Check slot progression
      checks.slotProgression = await this.checkSlotProgression();

      // Check memory usage
      checks.memoryUsage = await this.checkMemoryUsage();

      // Check disk space (if applicable)
      checks.diskSpace = await this.checkDiskSpace();

      // Determine overall status
      const overallStatus = this.determineOverallStatus(checks);
      const duration = Date.now() - startTime;

      this.lastHealthStatus = {
        status: overallStatus,
        message: this.getStatusMessage(overallStatus, checks),
        timestamp: new Date(),
        checks
      };

      // Emit health check event
      this.emit('health-check', this.lastHealthStatus);

      console.log(`[HEALTH] Health check completed in ${duration}ms - Status: ${overallStatus}`);

    } catch (error) {
      console.error('[HEALTH] Error during health checks:', error);
      
      this.lastHealthStatus = {
        status: 'unhealthy',
        message: `Health check failed: ${(error as Error).message}`,
        timestamp: new Date(),
        checks: {}
      };

      this.emit('health-check', this.lastHealthStatus);
    }
  }

  private async checkBlockchainConnectivity(): Promise<{ status: 'pass' | 'fail' | 'warn'; message: string; duration: number }> {
    const startTime = Date.now();
    
    try {
      const slot = await this.connection.getSlot();
      const duration = Date.now() - startTime;
      
      if (slot > 0) {
        return {
          status: 'pass',
          message: `Connected to blockchain at slot ${slot}`,
          duration
        };
      } else {
        return {
          status: 'fail',
          message: 'Invalid slot returned',
          duration
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.incrementFailureCount('blockchain');
      
      return {
        status: this.getFailureStatus('blockchain'),
        message: `Blockchain connectivity failed: ${(error as Error).message}`,
        duration
      };
    }
  }

  private async checkRPCEndpoint(): Promise<{ status: 'pass' | 'fail' | 'warn'; message: string; duration: number }> {
    const startTime = Date.now();
    
    try {
      const version = await this.connection.getVersion();
      const duration = Date.now() - startTime;
      
      if (version && version['solana-core']) {
        return {
          status: 'pass',
          message: `RPC endpoint healthy - Solana version: ${version['solana-core']}`,
          duration
        };
      } else {
        return {
          status: 'warn',
          message: 'RPC endpoint responded but version info missing',
          duration
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.incrementFailureCount('rpc');
      
      return {
        status: this.getFailureStatus('rpc'),
        message: `RPC endpoint check failed: ${(error as Error).message}`,
        duration
      };
    }
  }

  private async checkProgramAccess(): Promise<{ status: 'pass' | 'fail' | 'warn'; message: string; duration: number }> {
    const startTime = Date.now();
    
    try {
      const programId = new PublicKey(this.config.programId);
      const accountInfo = await this.connection.getAccountInfo(programId);
      const duration = Date.now() - startTime;
      
      if (accountInfo) {
        return {
          status: 'pass',
          message: `Program accessible - Size: ${accountInfo.data.length} bytes`,
          duration
        };
      } else {
        return {
          status: 'fail',
          message: 'Program account not found',
          duration
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.incrementFailureCount('program');
      
      return {
        status: this.getFailureStatus('program'),
        message: `Program access check failed: ${(error as Error).message}`,
        duration
      };
    }
  }

  private async checkNetworkStatus(): Promise<{ status: 'pass' | 'fail' | 'warn'; message: string; duration: number }> {
    const startTime = Date.now();
    
    try {
      const clusterNodes = await this.connection.getClusterNodes();
      const duration = Date.now() - startTime;
      
      if (clusterNodes && clusterNodes.length > 0) {
        const activeNodes = clusterNodes.filter(node => node.featureSet !== null);
        
        return {
          status: 'pass',
          message: `Network healthy - ${activeNodes.length} active nodes`,
          duration
        };
      } else {
        return {
          status: 'warn',
          message: 'Network status unclear - no node information',
          duration
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.incrementFailureCount('network');
      
      return {
        status: this.getFailureStatus('network'),
        message: `Network status check failed: ${(error as Error).message}`,
        duration
      };
    }
  }

  private async checkSlotProgression(): Promise<{ status: 'pass' | 'fail' | 'warn'; message: string; duration: number }> {
    const startTime = Date.now();
    
    try {
      const currentSlot = await this.connection.getSlot();
      const duration = Date.now() - startTime;
      
      // Wait a bit and check if slot has progressed
      await new Promise(resolve => setTimeout(resolve, 1000));
      const newSlot = await this.connection.getSlot();
      
      if (newSlot > currentSlot) {
        return {
          status: 'pass',
          message: `Slot progression normal - ${newSlot - currentSlot} slots in 1s`,
          duration
        };
      } else {
        return {
          status: 'warn',
          message: 'Slot progression may be slow',
          duration
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.incrementFailureCount('slot');
      
      return {
        status: this.getFailureStatus('slot'),
        message: `Slot progression check failed: ${(error as Error).message}`,
        duration
      };
    }
  }

  private async checkMemoryUsage(): Promise<{ status: 'pass' | 'fail' | 'warn'; message: string; duration: number }> {
    const startTime = Date.now();
    
    try {
      const memUsage = process.memoryUsage();
      const duration = Date.now() - startTime;
      
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
      const rssMB = Math.round(memUsage.rss / 1024 / 1024);
      
      // Check if memory usage is reasonable
      if (heapUsedMB < 500) { // Less than 500MB
        return {
          status: 'pass',
          message: `Memory usage normal - Heap: ${heapUsedMB}MB/${heapTotalMB}MB, RSS: ${rssMB}MB`,
          duration
        };
      } else if (heapUsedMB < 1000) { // Less than 1GB
        return {
          status: 'warn',
          message: `Memory usage elevated - Heap: ${heapUsedMB}MB/${heapTotalMB}MB, RSS: ${rssMB}MB`,
          duration
        };
      } else {
        return {
          status: 'fail',
          message: `Memory usage high - Heap: ${heapUsedMB}MB/${heapTotalMB}MB, RSS: ${rssMB}MB`,
          duration
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      
      return {
        status: 'warn',
        message: `Memory check failed: ${(error as Error).message}`,
        duration
      };
    }
  }

  private async checkDiskSpace(): Promise<{ status: 'pass' | 'fail' | 'warn'; message: string; duration: number }> {
    const startTime = Date.now();
    
    try {
      // This is a simplified disk space check
      // In a real implementation, you'd use a library like 'diskusage'
      const duration = Date.now() - startTime;
      
      return {
        status: 'pass',
        message: 'Disk space check not implemented',
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      return {
        status: 'warn',
        message: `Disk space check failed: ${(error as Error).message}`,
        duration
      };
    }
  }

  private determineOverallStatus(checks: HealthStatus['checks']): 'healthy' | 'unhealthy' | 'degraded' {
    const checkResults = Object.values(checks);
    const failedChecks = checkResults.filter(check => check.status === 'fail');
    const warningChecks = checkResults.filter(check => check.status === 'warn');
    
    if (failedChecks.length > 0) {
      return 'unhealthy';
    } else if (warningChecks.length > 0) {
      return 'degraded';
    } else {
      return 'healthy';
    }
  }

  private getStatusMessage(status: string, checks: HealthStatus['checks']): string {
    switch (status) {
      case 'healthy':
        return 'All health checks passed';
      case 'degraded':
        const warnings = Object.entries(checks)
          .filter(([_, check]) => check.status === 'warn')
          .map(([name, check]) => `${name}: ${check.message}`)
          .join(', ');
        return `System degraded - Warnings: ${warnings}`;
      case 'unhealthy':
        const failures = Object.entries(checks)
          .filter(([_, check]) => check.status === 'fail')
          .map(([name, check]) => `${name}: ${check.message}`)
          .join(', ');
        return `System unhealthy - Failures: ${failures}`;
      default:
        return 'Unknown status';
    }
  }

  private incrementFailureCount(checkName: string): void {
    const currentCount = this.consecutiveFailures.get(checkName) || 0;
    this.consecutiveFailures.set(checkName, currentCount + 1);
  }

  private getFailureStatus(checkName: string): 'fail' | 'warn' {
    const failureCount = this.consecutiveFailures.get(checkName) || 0;
    
    if (failureCount >= this.maxConsecutiveFailures) {
      return 'fail';
    } else {
      return 'warn';
    }
  }

  public getStatus(): HealthStatus {
    return { ...this.lastHealthStatus };
  }

  public async runManualHealthCheck(): Promise<HealthStatus> {
    console.log('[HEALTH] Running manual health check...');
    await this.runHealthChecks();
    return this.getStatus();
  }

  public getFailureCounts(): Record<string, number> {
    return Object.fromEntries(this.consecutiveFailures);
  }

  public resetFailureCount(checkName: string): void {
    this.consecutiveFailures.delete(checkName);
  }

  public resetAllFailureCounts(): void {
    this.consecutiveFailures.clear();
  }
} 