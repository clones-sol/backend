import { Connection, PublicKey, ParsedTransactionWithMeta, ParsedInstruction, TransactionInstruction } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { 
  MonitoringConfig, 
  SmartContractEvent, 
  EventType, 
  AlertSeverity,
  EventFilter 
} from '../../types/monitoring.ts';
import { RewardPoolClient } from '../../solana-client.ts';

export class MonitoringService extends EventEmitter {
  private connection: Connection;
  private config: MonitoringConfig;
  private client: RewardPoolClient;
  private isRunning: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastSlot: number = 0;
  private programId: PublicKey;
  private eventCache: Map<string, SmartContractEvent> = new Map();
  private recentSignatures: Set<string> = new Set();
  private maxRecentSignatures: number = 1000;

  constructor(connection: Connection, config: MonitoringConfig) {
    super();
    this.connection = connection;
    this.config = config;
    this.programId = new PublicKey(config.programId);
    this.client = new RewardPoolClient(connection);
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[MONITORING] Service already running');
      return;
    }

    try {
      console.log('[MONITORING] Starting monitoring service...');
      
      // Get the latest slot
      this.lastSlot = await this.connection.getSlot();
      console.log(`[MONITORING] Starting from slot: ${this.lastSlot}`);

      // Start polling for new transactions
      this.startPolling();
      
      this.isRunning = true;
      console.log('[MONITORING] Monitoring service started successfully');
    } catch (error) {
      console.error('[MONITORING] Failed to start monitoring service:', error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      console.log('[MONITORING] Stopping monitoring service...');
      
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }
      
      this.isRunning = false;
      console.log('[MONITORING] Monitoring service stopped');
    } catch (error) {
      console.error('[MONITORING] Error stopping monitoring service:', error);
      throw error;
    }
  }

  private startPolling(): void {
    this.pollInterval = setInterval(async () => {
      try {
        await this.pollForNewTransactions();
      } catch (error) {
        console.error('[MONITORING] Error polling for transactions:', error);
        this.emit('error', error);
      }
    }, this.config.pollInterval);
  }

  private async pollForNewTransactions(): Promise<void> {
    try {
      const currentSlot = await this.connection.getSlot();
      
      if (currentSlot <= this.lastSlot) {
        return; // No new blocks
      }

      // Get signatures for our program
      const signatures = await this.connection.getSignaturesForAddress(
        this.programId,
        { limit: 100 },
        this.config.commitment
      );

      // Process new signatures
      for (const sigInfo of signatures) {
        if (this.recentSignatures.has(sigInfo.signature)) {
          continue; // Already processed
        }

        await this.processTransaction(sigInfo.signature);
        
        // Add to recent signatures to avoid duplicates
        this.recentSignatures.add(sigInfo.signature);
        if (this.recentSignatures.size > this.maxRecentSignatures) {
          const firstKey = this.recentSignatures.values().next().value;
          this.recentSignatures.delete(firstKey);
        }
      }

      this.lastSlot = currentSlot;
    } catch (error) {
      console.error('[MONITORING] Error polling for transactions:', error);
      throw error;
    }
  }

  private async processTransaction(signature: string): Promise<void> {
    try {
      // Get transaction details
      const transaction = await this.connection.getParsedTransaction(
        signature,
        this.config.commitment
      );

      if (!transaction) {
        return;
      }

      // Check if transaction involves our program
      if (!this.isRelevantTransaction(transaction)) {
        return;
      }

      // Parse transaction for events
      const events = await this.parseTransactionEvents(transaction, signature);
      
      // Emit events
      for (const event of events) {
        this.emit('event', event);
      }

    } catch (error) {
      console.error(`[MONITORING] Error processing transaction ${signature}:`, error);
      
      // Emit error event
      const errorEvent: SmartContractEvent = {
        id: uuidv4(),
        type: EventType.TRANSACTION_FAILED,
        signature,
        slot: 0,
        timestamp: new Date(),
        severity: AlertSeverity.HIGH,
        error: (error as Error).message,
        success: false,
        metadata: { error }
      };
      
      this.emit('event', errorEvent);
    }
  }

  private isRelevantTransaction(transaction: ParsedTransactionWithMeta): boolean {
    if (!transaction.meta || !transaction.transaction.message.instructions) {
      return false;
    }

    // Check if any instruction involves our program
    return transaction.transaction.message.instructions.some(
      (instruction: ParsedInstruction | TransactionInstruction) => {
        if ('programId' in instruction) {
          // Handle both string and PublicKey types for programId
          if (typeof instruction.programId === 'string') {
            return instruction.programId === this.programId.toBase58();
          } else if (instruction.programId instanceof PublicKey) {
            return instruction.programId.equals(this.programId);
          }
        }
        return false;
      }
    );
  }

  private async parseTransactionEvents(
    transaction: ParsedTransactionWithMeta, 
    signature: string
  ): Promise<SmartContractEvent[]> {
    const events: SmartContractEvent[] = [];
    
    try {
      if (!transaction.meta || !transaction.transaction.message.instructions) {
        return events;
      }

      const instructions = transaction.transaction.message.instructions;
      const blockTime = transaction.blockTime ? new Date(transaction.blockTime * 1000) : new Date();
      const slot = transaction.slot;
      const fee = transaction.meta.fee;

      // Parse each instruction
      for (let i = 0; i < instructions.length; i++) {
        const instruction = instructions[i];
        
        if (!('programId' in instruction) || !instruction.programId.equals(this.programId)) {
          continue;
        }

        const event = await this.parseInstruction(
          instruction,
          signature,
          slot,
          blockTime,
          fee,
          transaction
        );

        if (event) {
          events.push(event);
        }
      }

      // Check for balance changes
      if (this.config.enableBalanceMonitoring) {
        const balanceEvents = await this.checkBalanceChanges(transaction, signature);
        events.push(...balanceEvents);
      }

      // Check for suspicious activity
      if (this.config.enableSuspiciousActivityDetection) {
        const suspiciousEvents = await this.detectSuspiciousActivity(transaction, signature);
        events.push(...suspiciousEvents);
      }

    } catch (error) {
      console.error('[MONITORING] Error parsing transaction events:', error);
      
      const errorEvent: SmartContractEvent = {
        id: uuidv4(),
        type: EventType.CONTRACT_ERROR,
        signature,
        slot: transaction.slot,
        timestamp: new Date(),
        severity: AlertSeverity.HIGH,
        error: (error as Error).message,
        success: false,
        metadata: { transaction: transaction.transaction.signatures }
      };
      
      events.push(errorEvent);
    }

    return events;
  }

  private async parseInstruction(
    instruction: ParsedInstruction,
    signature: string,
    slot: number,
    blockTime: Date,
    fee: number,
    transaction: ParsedTransactionWithMeta
  ): Promise<SmartContractEvent | null> {
    try {
      if (!('parsed' in instruction) || !instruction.parsed) {
        return null;
      }

      const { type, info } = instruction.parsed;
      const eventId = uuidv4();

      switch (type) {
        case 'initializeRewardPool':
          return {
            id: eventId,
            type: EventType.REWARD_POOL_INITIALIZED,
            signature,
            slot,
            timestamp: blockTime,
            severity: AlertSeverity.MEDIUM,
            address: info.platformAuthority,
            metadata: { info, fee }
          };

        case 'recordTaskCompletion':
          return {
            id: eventId,
            type: EventType.TASK_COMPLETION_RECORDED,
            signature,
            slot,
            timestamp: blockTime,
            severity: AlertSeverity.LOW,
            taskId: info.taskId,
            farmerAddress: info.farmerAddress,
            poolId: info.poolId,
            amount: parseFloat(info.rewardAmount),
            tokenMint: info.tokenMint,
            metadata: { info, fee }
          };

        case 'withdrawRewards':
          return {
            id: eventId,
            type: EventType.REWARDS_WITHDRAWN,
            signature,
            slot,
            timestamp: blockTime,
            severity: AlertSeverity.MEDIUM,
            farmerAddress: info.farmerAddress,
            amount: parseFloat(info.totalAmount),
            metadata: { info, fee, taskIds: info.taskIds }
          };

        case 'setPaused':
          return {
            id: eventId,
            type: info.isPaused ? EventType.POOL_PAUSED : EventType.POOL_UNPAUSED,
            signature,
            slot,
            timestamp: blockTime,
            severity: AlertSeverity.HIGH,
            metadata: { info, fee }
          };

        case 'updatePlatformFee':
          return {
            id: eventId,
            type: EventType.PLATFORM_FEE_UPDATED,
            signature,
            slot,
            timestamp: blockTime,
            severity: AlertSeverity.HIGH,
            amount: parseFloat(info.newFeePercentage),
            metadata: { info, fee }
          };

        case 'createRewardVault':
          return {
            id: eventId,
            type: EventType.REWARD_VAULT_CREATED,
            signature,
            slot,
            timestamp: blockTime,
            severity: AlertSeverity.MEDIUM,
            tokenMint: info.tokenMint,
            metadata: { info, fee }
          };

        default:
          // Unknown instruction type
          return {
            id: eventId,
            type: EventType.CONTRACT_ERROR,
            signature,
            slot,
            timestamp: blockTime,
            severity: AlertSeverity.MEDIUM,
            error: `Unknown instruction type: ${type}`,
            metadata: { instruction: type, info, fee }
          };
      }
    } catch (error) {
      console.error('[MONITORING] Error parsing instruction:', error);
      return null;
    }
  }

  private async checkBalanceChanges(
    transaction: ParsedTransactionWithMeta,
    signature: string
  ): Promise<SmartContractEvent[]> {
    const events: SmartContractEvent[] = [];
    
    try {
      if (!transaction.meta || !transaction.meta.preBalances || !transaction.meta.postBalances) {
        return events;
      }

      const preBalances = transaction.meta.preBalances;
      const postBalances = transaction.meta.postBalances;
      const accountKeys = transaction.transaction.message.accountKeys;

      for (let i = 0; i < accountKeys.length; i++) {
        const preBalance = preBalances[i];
        const postBalance = postBalances[i];
        const accountKey = accountKeys[i];

        if (typeof accountKey === 'string') {
          const balanceChange = postBalance - preBalance;
          
          // Check for low balance
          if (postBalance < this.config.lowBalanceThreshold * 1e9) { // Convert SOL to lamports
            events.push({
              id: uuidv4(),
              type: EventType.BALANCE_LOW,
              signature,
              slot: transaction.slot,
              timestamp: new Date(),
              severity: AlertSeverity.HIGH,
              address: accountKey,
              amount: postBalance / 1e9, // Convert lamports to SOL
              metadata: { preBalance: preBalance / 1e9, postBalance: postBalance / 1e9 }
            });
          }

          // Check for high volume transactions
          if (Math.abs(balanceChange) > this.config.highVolumeThreshold * 1e9) {
            events.push({
              id: uuidv4(),
              type: EventType.HIGH_VOLUME,
              signature,
              slot: transaction.slot,
              timestamp: new Date(),
              severity: AlertSeverity.MEDIUM,
              address: accountKey,
              amount: Math.abs(balanceChange) / 1e9,
              metadata: { balanceChange: balanceChange / 1e9 }
            });
          }
        }
      }
    } catch (error) {
      console.error('[MONITORING] Error checking balance changes:', error);
    }

    return events;
  }

  private async detectSuspiciousActivity(
    transaction: ParsedTransactionWithMeta,
    signature: string
  ): Promise<SmartContractEvent[]> {
    const events: SmartContractEvent[] = [];
    
    try {
      // Check for multiple failed transactions from same address
      // Check for unusual transaction patterns
      // Check for rapid successive transactions
      
      // This is a simplified implementation
      // In a real system, you'd implement more sophisticated detection logic
      
      if (transaction.meta && transaction.meta.err) {
        events.push({
          id: uuidv4(),
          type: EventType.SUSPICIOUS_ACTIVITY,
          signature,
          slot: transaction.slot,
          timestamp: new Date(),
          severity: AlertSeverity.HIGH,
          error: 'Transaction failed',
          metadata: { error: transaction.meta.err }
        });
      }
    } catch (error) {
      console.error('[MONITORING] Error detecting suspicious activity:', error);
    }

    return events;
  }

  public async getEvents(filter?: EventFilter): Promise<SmartContractEvent[]> {
    const events = Array.from(this.eventCache.values());
    
    if (!filter) {
      return events;
    }

    return events.filter(event => {
      // Filter by type
      if (filter.types && !filter.types.includes(event.type)) {
        return false;
      }

      // Filter by severity
      if (filter.severity && !filter.severity.includes(event.severity)) {
        return false;
      }

      // Filter by address
      if (filter.addresses && event.address && !filter.addresses.includes(event.address)) {
        return false;
      }

      // Filter by pool ID
      if (filter.poolIds && event.poolId && !filter.poolIds.includes(event.poolId)) {
        return false;
      }

      // Filter by token mint
      if (filter.tokenMints && event.tokenMint && !filter.tokenMints.includes(event.tokenMint)) {
        return false;
      }

      // Filter by date range
      if (filter.dateRange) {
        if (event.timestamp < filter.dateRange.start || event.timestamp > filter.dateRange.end) {
          return false;
        }
      }

      return true;
    }).slice(filter.offset || 0, (filter.offset || 0) + (filter.limit || events.length));
  }

  public getStatus(): { isRunning: boolean; lastSlot: number; eventCount: number } {
    return {
      isRunning: this.isRunning,
      lastSlot: this.lastSlot,
      eventCount: this.eventCache.size
    };
  }
} 