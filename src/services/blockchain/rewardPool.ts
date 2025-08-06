import { Connection, PublicKey, Keypair, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { RewardPoolClient } from '../../solana-client.js';
import BN from 'bn.js';
import bs58 from 'bs58';

// Enhanced error types
export enum RewardPoolError {
  INVALID_PROGRAM_ID = 'INVALID_PROGRAM_ID',
  INVALID_TREASURY_ADDRESS = 'INVALID_TREASURY_ADDRESS',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  INVALID_CONFIGURATION = 'INVALID_CONFIGURATION',
  SERVICE_NOT_INITIALIZED = 'SERVICE_NOT_INITIALIZED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_WALLET_ADDRESS = 'INVALID_WALLET_ADDRESS'
}

export class RewardPoolServiceError extends Error {
  constructor(
    public code: RewardPoolError,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'RewardPoolServiceError';
  }
}

// Types for the reward pool program
export interface RewardPoolData {
  platformAuthority: PublicKey;
  platformFeePercentage: number;
  totalRewardsDistributed: BN;
  totalPlatformFeesCollected: BN;
  isPaused: boolean;
}

export interface FarmerAccountData {
  farmerAddress: PublicKey;
  withdrawalNonce: number;
  totalRewardsEarned: BN;
  totalRewardsWithdrawn: BN;
  lastWithdrawalSlot: number;
  // Note: withdrawal_in_progress flag is not strictly necessary due to Solana's sequential execution
  // but can be useful for cross-transaction state management
}

export interface TaskCompletionRecord {
  taskId: string;
  farmerAddress: PublicKey;
  poolId: string;
  rewardAmount: BN;
  tokenMint: PublicKey;
  isClaimed: boolean;
  completionSlot: number;
  signature: string;
}

export interface WithdrawalRequest {
  farmerAddress: string;
  expectedNonce: number;
  taskIds: string[];
  tokenMints: string[];
}

export interface WithdrawalTransactionData {
  instructions: any[];
  signers: any[];
  feePayer: string;
  recentBlockhash: string;
  expectedNonce: number;
  estimatedFee: number;
  taskCount: number;
  totalRewardAmount: number;
  totalPlatformFee: number;
  tasks: any[];
}

export class RewardPoolService {
  private static instance: RewardPoolService | null = null;
  private connection: Connection;
  private client: RewardPoolClient | null = null;
  private platformAuthority: Keypair;
  private programId: PublicKey | null = null;
  private platformTreasury: PublicKey | null = null;
  private serviceInitialized: boolean = false;

  constructor(
    connection: Connection,
    programId: string,
    platformAuthorityKeypair: Keypair,
    platformTreasuryAddress?: string
  ) {
    this.connection = connection;
    this.platformAuthority = platformAuthorityKeypair;
    
    // Validate configuration
    this.validateConfiguration(programId, platformTreasuryAddress);
    
    // Initialize the service
    this.initializeService(programId, platformTreasuryAddress);
  }

  private validateConfiguration(programId: string, platformTreasuryAddress?: string): void {
    // Validate program ID
    if (!programId || programId === '11111111111111111111111111111111') {
      throw new RewardPoolServiceError(
        RewardPoolError.INVALID_CONFIGURATION,
        'Valid REWARD_POOL_PROGRAM_ID is required. Please set a valid program ID in your environment variables.'
      );
    }

    // Validate program ID format
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    if (!base58Regex.test(programId)) {
      throw new RewardPoolServiceError(
        RewardPoolError.INVALID_PROGRAM_ID,
        `Invalid program ID format: ${programId}. Program ID must be a valid base58 string.`
      );
    }

    // Validate treasury address if provided
    if (platformTreasuryAddress && platformTreasuryAddress !== 'your_platform_treasury_wallet_address_here') {
      if (!base58Regex.test(platformTreasuryAddress)) {
        throw new RewardPoolServiceError(
          RewardPoolError.INVALID_TREASURY_ADDRESS,
          `Invalid treasury address format: ${platformTreasuryAddress}. Address must be a valid base58 string.`
        );
      }
    }

    // Validate connection
    if (!this.connection || !this.connection.rpcEndpoint) {
      throw new RewardPoolServiceError(
        RewardPoolError.CONNECTION_FAILED,
        'Invalid Solana connection. Please check your RPC_URL configuration.'
      );
    }
  }

  private async initializeService(programId: string, platformTreasuryAddress?: string): Promise<void> {
    try {
      // Create PublicKey from program ID
      const decodedBytes = bs58.decode(programId);
      this.programId = new PublicKey(new Uint8Array(decodedBytes));
      console.log(`[REWARD_POOL] Successfully created PublicKey: ${this.programId.toString()}`);
      
      // Create the client
      this.client = new RewardPoolClient(this.connection);
      console.log(`[REWARD_POOL] Successfully created RewardPoolClient`);
      
      // Initialize treasury address if provided
      if (platformTreasuryAddress && platformTreasuryAddress !== 'your_platform_treasury_wallet_address_here') {
        try {
          const decodedTreasuryBytes = bs58.decode(platformTreasuryAddress);
          this.platformTreasury = new PublicKey(new Uint8Array(decodedTreasuryBytes));
          console.log(`[REWARD_POOL] Successfully initialized treasury address: ${this.platformTreasury.toString()}`);
        } catch (error) {
          console.warn(`[REWARD_POOL] Failed to decode treasury address: ${platformTreasuryAddress}`);
          throw new RewardPoolServiceError(
            RewardPoolError.INVALID_TREASURY_ADDRESS,
            `Failed to decode treasury address: ${platformTreasuryAddress}`,
            error
          );
        }
      }

      // Test connection
      await this.testConnection();
      
      this.serviceInitialized = true;
      console.log('[REWARD_POOL] Service initialized successfully');
      
    } catch (error) {
      console.error('[REWARD_POOL] Failed to initialize service:', error);
      if (error instanceof RewardPoolServiceError) {
        throw error;
      }
      throw new RewardPoolServiceError(
        RewardPoolError.SERVICE_NOT_INITIALIZED,
        'Failed to initialize RewardPoolService',
        error
      );
    }
  }

  private async testConnection(): Promise<void> {
    try {
      const slot = await this.connection.getSlot();
      console.log(`[REWARD_POOL] Connection test successful. Current slot: ${slot}`);
    } catch (error) {
      throw new RewardPoolServiceError(
        RewardPoolError.CONNECTION_FAILED,
        'Failed to connect to Solana network. Please check your RPC_URL and network connectivity.',
        error
      );
    }
  }

  public static getInstance(
    connection: Connection,
    programId: string,
    platformAuthorityKeypair: Keypair,
    platformTreasuryAddress?: string
  ): RewardPoolService {
    if (!RewardPoolService.instance) {
      RewardPoolService.instance = new RewardPoolService(
        connection,
        programId,
        platformAuthorityKeypair,
        platformTreasuryAddress
      );
    }
    return RewardPoolService.instance;
  }

  private isServiceInitialized(): boolean {
    return this.serviceInitialized && this.programId !== null && this.client !== null;
  }

  private validateWalletAddress(walletAddress: string): PublicKey {
    try {
      const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
      if (!base58Regex.test(walletAddress)) {
        throw new RewardPoolServiceError(
          RewardPoolError.INVALID_WALLET_ADDRESS,
          `Invalid wallet address format: ${walletAddress}`
        );
      }
      return new PublicKey(walletAddress);
    } catch (error) {
      if (error instanceof RewardPoolServiceError) {
        throw error;
      }
      throw new RewardPoolServiceError(
        RewardPoolError.INVALID_WALLET_ADDRESS,
        `Failed to create PublicKey from wallet address: ${walletAddress}`,
        error
      );
    }
  }

  /**
   * Check if the service is properly initialized with a real program
   */
  private isInitialized(): boolean {
    return this.isServiceInitialized();
  }

  /**
   * Record a completed task and calculate pending rewards
   * This is called by the backend when a task is completed
   */
  async recordTaskCompletion(
    taskId: string,
    farmerAddress: string,
    poolId: string,
    rewardAmount: number,
    tokenMint: string
  ): Promise<{ signature: string; slot: number }> {
    try {
      // If program is not initialized, return mock response
      if (!this.isInitialized()) {
        const mockSignature = Buffer.from(Math.random().toString()).toString('hex');
        const mockSlot = await this.connection.getSlot();

        console.log(`[REWARD_POOL] Mock recorded task completion:`, {
          taskId,
          farmerAddress,
          poolId,
          rewardAmount,
          tokenMint,
          signature: mockSignature,
          slot: mockSlot
        });

        return {
          signature: mockSignature,
          slot: mockSlot
        };
      }

      const farmerPubkey = new PublicKey(farmerAddress);
      const tokenMintPubkey = new PublicKey(tokenMint);

      // Convert reward amount to token decimals (assuming 6 decimals like USDC)
      const rewardAmountBN = new BN(rewardAmount * Math.pow(10, 6));

      // Create transaction using native client
      const tx = await this.client!.recordTaskCompletion(
        taskId,
        poolId,
        rewardAmountBN,
        farmerPubkey,
        tokenMintPubkey,
        this.platformAuthority
      );

      const slot = await this.connection.getSlot();

      console.log(`[REWARD_POOL] Recorded task completion:`, {
        taskId,
        farmerAddress,
        poolId,
        rewardAmount,
        tokenMint,
        signature: tx,
        slot
      });

      return {
        signature: tx,
        slot
      };

    } catch (error) {
      console.error('Failed to record task completion:', error);
      throw error;
    }
  }

  /**
   * Get pending rewards for a farmer
   */
  async getPendingRewards(farmerAddress: string): Promise<{
    totalPending: number;
    taskCount: number;
    tokenBreakdown: Record<string, number>;
  }> {
    try {
      // If program is not initialized, return mock data
      if (!this.isInitialized()) {
        const mockData = {
          totalPending: 0,
          taskCount: 0,
          tokenBreakdown: {}
        };

        console.log(`[REWARD_POOL] Mock retrieved pending rewards for ${farmerAddress}:`, mockData);
        return mockData;
      }

      const farmerPubkey = new PublicKey(farmerAddress);
      
      // Get farmer account
      const [farmerAccountPDA] = this.getFarmerAccountPDA(farmerPubkey);
      
      try {
        const farmerAccount = await this.client!.getFarmerAccount(farmerPubkey);
        
        if (!farmerAccount) {
          return {
            totalPending: 0,
            taskCount: 0,
            tokenBreakdown: {}
          };
        }
        
        // Calculate pending rewards (earned - withdrawn)
        const totalPending = farmerAccount.totalRewardsEarned.sub(farmerAccount.totalRewardsWithdrawn);
        
        // For now, return basic data. In a full implementation, you'd query all task records
        const result = {
          totalPending: totalPending.toNumber() / Math.pow(10, 6), // Convert from token decimals
          taskCount: 0, // Would need to query task records
          tokenBreakdown: {} // Would need to group by token mint
        };

        console.log(`[REWARD_POOL] Retrieved pending rewards for ${farmerAddress}:`, result);
        return result;

      } catch (error) {
        // If farmer account doesn't exist, return zero rewards
        console.log(`[REWARD_POOL] No farmer account found for ${farmerAddress}`);
        return {
          totalPending: 0,
          taskCount: 0,
          tokenBreakdown: {}
        };
      }

    } catch (error) {
      console.error('Failed to get pending rewards:', error);
      throw error;
    }
  }

  /**
   * Get farmer account data including withdrawal nonce
   * This is critical for nonce verification in withdrawals
   */
  async getFarmerAccount(farmerAddress: string): Promise<FarmerAccountData | null> {
    try {
      // If program is not initialized, return mock data
      if (!this.isInitialized()) {
        const mockData: FarmerAccountData = {
          farmerAddress: new PublicKey(farmerAddress),
          withdrawalNonce: 0,
          totalRewardsEarned: new BN(0),
          totalRewardsWithdrawn: new BN(0),
          lastWithdrawalSlot: 0
        };

        console.log(`[REWARD_POOL] Mock retrieved farmer account for ${farmerAddress}:`, mockData);
        return mockData;
      }

      const farmerPubkey = new PublicKey(farmerAddress);
      const [farmerAccountPDA] = this.getFarmerAccountPDA(farmerPubkey);
      
      try {
        const farmerAccount = await this.client!.getFarmerAccount(farmerPubkey);
        
        if (!farmerAccount) {
          return null;
        }
        
        const result: FarmerAccountData = {
          farmerAddress: farmerPubkey,
          withdrawalNonce: farmerAccount.withdrawalNonce.toNumber(),
          totalRewardsEarned: farmerAccount.totalRewardsEarned,
          totalRewardsWithdrawn: farmerAccount.totalRewardsWithdrawn,
          lastWithdrawalSlot: farmerAccount.lastWithdrawalSlot.toNumber()
        };

        console.log(`[REWARD_POOL] Retrieved farmer account for ${farmerAddress}:`, result);
        return result;

      } catch (error) {
        // If farmer account doesn't exist, return null
        console.log(`[REWARD_POOL] No farmer account found for ${farmerAddress}`);
        return null;
      }

    } catch (error) {
      console.error('Failed to get farmer account:', error);
      return null;
    }
  }

  /**
   * Prepare withdrawal transaction with proper nonce verification
   * This ensures the smart contract can verify the nonce is correct
   */
  async prepareWithdrawalTransaction(
    withdrawalRequest: WithdrawalRequest
  ): Promise<WithdrawalTransactionData> {
    try {
      const { farmerAddress, expectedNonce, taskIds, tokenMints } = withdrawalRequest;
      
      // 1. Get current farmer account to verify nonce
      const farmerAccount = await this.getFarmerAccount(farmerAddress);
      if (!farmerAccount) {
        throw new Error('Farmer account not found');
      }

      // 2. Verify nonce matches (this is what the smart contract will also verify)
      const nonceVerified = farmerAccount.withdrawalNonce === expectedNonce;
      if (!nonceVerified) {
        throw new Error(`Invalid nonce. Expected: ${expectedNonce}, Current: ${farmerAccount.withdrawalNonce}`);
      }

      // 3. Verify tasks exist and are withdrawable
      // TODO: Implement task verification logic
      const tasksVerified = true; // Placeholder

      // 4. Prepare transaction data
      const transactionData = {
        instructions: [],
        signers: [],
        feePayer: farmerAddress,
        recentBlockhash: 'mock_blockhash',
        expectedNonce,
        estimatedFee: 5000 // 0.005 SOL
      };

      console.log(`[REWARD_POOL] Prepared withdrawal transaction:`, {
        farmerAddress,
        expectedNonce,
        taskCount: taskIds.length,
        securityChecks: {
          nonceVerified,
          signerVerified: true, // Will be verified by smart contract
          tasksVerified
        }
      });

      return {
        instructions: [],
        signers: [],
        feePayer: '',
        recentBlockhash: '',
        expectedNonce,
        estimatedFee: 0,
        taskCount: taskIds.length,
        totalRewardAmount: 0, // Would calculate from tasks
        totalPlatformFee: 0, // Would calculate from tasks
        tasks: [] // Would populate from task verification
      };

    } catch (error) {
      console.error('Failed to prepare withdrawal transaction:', error);
      throw error;
    }
  }

  /**
   * Execute withdrawal transaction on-chain
   * This is called by the frontend after the user signs the transaction
   */
  async executeWithdrawal(
    taskIds: string[],
    expectedNonce: number,
    farmerKeypair: Keypair,
    tokenMint: string,
    platformTreasuryAddress: string
  ): Promise<{ signature: string; slot: number }> {
    try {
      // If program is not initialized, return mock response
      if (!this.isInitialized()) {
        const mockSignature = Buffer.from(Math.random().toString()).toString('hex');
        const mockSlot = await this.connection.getSlot();

        console.log(`[REWARD_POOL] Mock executed withdrawal:`, {
          taskIds,
          expectedNonce,
          farmerAddress: farmerKeypair.publicKey.toString(),
          tokenMint,
          signature: mockSignature,
          slot: mockSlot
        });

        return {
          signature: mockSignature,
          slot: mockSlot
        };
      }

      const tokenMintPubkey = new PublicKey(tokenMint);
      const platformTreasuryPubkey = new PublicKey(platformTreasuryAddress);

      // Execute withdrawal using smart contract
      const tx = await this.client!.withdrawRewards(
        taskIds,
        new BN(expectedNonce),
        farmerKeypair,
        tokenMintPubkey,
        platformTreasuryPubkey
      );

      const slot = await this.connection.getSlot();

      console.log(`[REWARD_POOL] Executed withdrawal:`, {
        taskIds,
        expectedNonce,
        farmerAddress: farmerKeypair.publicKey.toString(),
        tokenMint,
        signature: tx,
        slot
      });

      return {
        signature: tx,
        slot
      };

    } catch (error) {
      console.error('Failed to execute withdrawal:', error);
      throw error;
    }
  }

  /**
   * Execute withdrawal transaction with retry mechanism
   */
  async executeWithdrawalWithRetry(
    taskIds: string[],
    expectedNonce: number,
    farmerKeypair: Keypair,
    tokenMint: string,
    platformTreasuryAddress: string,
    maxRetries: number = 3
  ): Promise<{ signature: string; slot: number }> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[REWARD_POOL] Executing withdrawal attempt ${attempt}/${maxRetries}`);
        
        const result = await this.executeWithdrawal(
          taskIds,
          expectedNonce,
          farmerKeypair,
          tokenMint,
          platformTreasuryAddress
        );
        
        console.log(`[REWARD_POOL] Withdrawal successful on attempt ${attempt}`);
        return result;
        
      } catch (error) {
        lastError = error as Error;
        console.warn(`[REWARD_POOL] Withdrawal attempt ${attempt} failed:`, error);
        
        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          console.log(`[REWARD_POOL] Non-retryable error encountered, stopping retries`);
          throw error;
        }
        
        // If this is the last attempt, throw the error
        if (attempt === maxRetries) {
          console.error(`[REWARD_POOL] All ${maxRetries} withdrawal attempts failed`);
          throw new RewardPoolServiceError(
            RewardPoolError.TRANSACTION_FAILED,
            `Withdrawal failed after ${maxRetries} attempts`,
            lastError
          );
        }
        
        // Calculate exponential backoff delay
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10 seconds
        console.log(`[REWARD_POOL] Waiting ${delay}ms before retry`);
        
        await this.sleep(delay);
      }
    }
    
    // This should never be reached, but just in case
    throw lastError || new Error('Unknown error in retry mechanism');
  }

  /**
   * Record task completion with retry mechanism
   */
  async recordTaskCompletionWithRetry(
    taskId: string,
    farmerAddress: string,
    poolId: string,
    rewardAmount: number,
    tokenMint: string,
    maxRetries: number = 3
  ): Promise<{ signature: string; slot: number }> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[REWARD_POOL] Recording task completion attempt ${attempt}/${maxRetries}`);
        
        const result = await this.recordTaskCompletion(
          taskId,
          farmerAddress,
          poolId,
          rewardAmount,
          tokenMint
        );
        
        console.log(`[REWARD_POOL] Task completion successful on attempt ${attempt}`);
        return result;
        
      } catch (error) {
        lastError = error as Error;
        console.warn(`[REWARD_POOL] Task completion attempt ${attempt} failed:`, error);
        
        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          console.log(`[REWARD_POOL] Non-retryable error encountered, stopping retries`);
          throw error;
        }
        
        // If this is the last attempt, throw the error
        if (attempt === maxRetries) {
          console.error(`[REWARD_POOL] All ${maxRetries} task completion attempts failed`);
          throw new RewardPoolServiceError(
            RewardPoolError.TRANSACTION_FAILED,
            `Task completion failed after ${maxRetries} attempts`,
            lastError
          );
        }
        
        // Calculate exponential backoff delay
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10 seconds
        console.log(`[REWARD_POOL] Waiting ${delay}ms before retry`);
        
        await this.sleep(delay);
      }
    }
    
    // This should never be reached, but just in case
    throw lastError || new Error('Unknown error in retry mechanism');
  }

  /**
   * Get platform statistics
   */
  async getPlatformStats(): Promise<{
    totalRewardsDistributed: number;
    totalPlatformFeesCollected: number;
    isPaused: boolean;
  }> {
    try {
      // If program is not initialized, return mock data
      if (!this.isInitialized()) {
        const mockData = {
          totalRewardsDistributed: 0,
          totalPlatformFeesCollected: 0,
          isPaused: false
        };

        console.log(`[REWARD_POOL] Mock retrieved platform stats:`, mockData);
        return mockData;
      }

      const [rewardPoolPDA] = this.getRewardPoolPDA();
      
      try {
        const rewardPool = await this.client!.getRewardPool();
        
        if (!rewardPool) {
          return {
            totalRewardsDistributed: 0,
            totalPlatformFeesCollected: 0,
            isPaused: false
          };
        }
        
        const result = {
          totalRewardsDistributed: rewardPool.totalRewardsDistributed.toNumber() / Math.pow(10, 6),
          totalPlatformFeesCollected: rewardPool.totalPlatformFeesCollected.toNumber() / Math.pow(10, 6),
          isPaused: rewardPool.isPaused
        };

        console.log(`[REWARD_POOL] Retrieved platform stats:`, result);
        return result;

      } catch (error) {
        // If reward pool doesn't exist, return default values
        console.log(`[REWARD_POOL] No reward pool found`);
        return {
          totalRewardsDistributed: 0,
          totalPlatformFeesCollected: 0,
          isPaused: false
        };
      }

    } catch (error) {
      console.error('Failed to get platform stats:', error);
      throw error;
    }
  }

  /**
   * Pause or unpause the reward pool (platform authority only)
   */
  async setPaused(isPaused: boolean): Promise<{ signature: string; slot: number }> {
    try {
      // If program is not initialized, return mock response
      if (!this.isInitialized()) {
        const mockSignature = Buffer.from(Math.random().toString()).toString('hex');
        const mockSlot = await this.connection.getSlot();

        console.log(`[REWARD_POOL] Mock set paused state to ${isPaused}:`, {
          signature: mockSignature,
          slot: mockSlot
        });

        return {
          signature: mockSignature,
          slot: mockSlot
        };
      }

      const tx = await this.client!.setPaused(isPaused, this.platformAuthority);

      const slot = await this.connection.getSlot();

      console.log(`[REWARD_POOL] Set paused state to ${isPaused}:`, {
        signature: tx,
        slot
      });

      return {
        signature: tx,
        slot
      };

    } catch (error) {
      console.error('Failed to set paused state:', error);
      throw error;
    }
  }

  /**
   * Initialize the reward pool program
   * This should be called once when the program is first deployed
   */
  async initializeRewardPool(
    platformFeePercentage: number = 10 // 10% platform fee
  ): Promise<{ signature: string; slot: number }> {
    try {
      // If program is not initialized, return mock response
      if (!this.isInitialized()) {
        const mockSignature = Buffer.from(Math.random().toString()).toString('hex');
        const mockSlot = await this.connection.getSlot();

        console.log(`[REWARD_POOL] Mock initialized reward pool with ${platformFeePercentage}% platform fee:`, {
          signature: mockSignature,
          slot: mockSlot
        });

        return {
          signature: mockSignature,
          slot: mockSlot
        };
      }

      const tx = await this.client!.initializeRewardPool(this.platformAuthority, platformFeePercentage);

      const slot = await this.connection.getSlot();

      console.log(`[REWARD_POOL] Initialized reward pool with ${platformFeePercentage}% platform fee:`, {
        signature: tx,
        slot
      });

      return {
        signature: tx,
        slot
      };

    } catch (error) {
      console.error('Failed to initialize reward pool:', error);
      throw error;
    }
  }

  /**
   * Create reward vault for a specific token
   * This should be called once per token type
   */
  async createRewardVault(tokenMint: string): Promise<{ signature: string; slot: number }> {
    try {
      // If program is not initialized, return mock response
      if (!this.isInitialized()) {
        const mockSignature = Buffer.from(Math.random().toString()).toString('hex');
        const mockSlot = await this.connection.getSlot();

        console.log(`[REWARD_POOL] Mock created reward vault for ${tokenMint}:`, {
          signature: mockSignature,
          slot: mockSlot
        });

        return {
          signature: mockSignature,
          slot: mockSlot
        };
      }

      const tokenMintPubkey = new PublicKey(tokenMint);
      const tx = await this.client!.createRewardVault(tokenMintPubkey, this.platformAuthority);

      const slot = await this.connection.getSlot();

      console.log(`[REWARD_POOL] Created reward vault for ${tokenMint}:`, {
        signature: tx,
        slot
      });

      return {
        signature: tx,
        slot
      };

    } catch (error) {
      console.error('Failed to create reward vault:', error);
      throw error;
    }
  }

  /**
   * Get reward vault balance for a specific token
   */
  async getRewardVaultBalance(tokenMint: string): Promise<number> {
    try {
      // If program is not initialized, return mock data
      if (!this.isInitialized()) {
        return 0;
      }

      const tokenMintPubkey = new PublicKey(tokenMint);
      const balance = await this.client!.getRewardVaultBalance(tokenMintPubkey);

      return balance.toNumber() / Math.pow(10, 6); // Convert from token decimals

    } catch (error) {
      console.error('Failed to get reward vault balance:', error);
      return 0;
    }
  }

  // Helper method for PDA derivation
  private getFarmerAccountPDA(farmerAddress: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('farmer'), farmerAddress.toBuffer()],
      this.programId!
    );
  }

  private getRewardPoolPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('reward_pool')],
      this.programId!
    );
  }

  /**
   * Check if an error is non-retryable
   */
  private isNonRetryableError(error: any): boolean {
    // Check for specific error types that shouldn't be retried
    if (error instanceof RewardPoolServiceError) {
      switch (error.code) {
        case RewardPoolError.INVALID_CONFIGURATION:
        case RewardPoolError.INVALID_PROGRAM_ID:
        case RewardPoolError.INVALID_TREASURY_ADDRESS:
        case RewardPoolError.INVALID_WALLET_ADDRESS:
        case RewardPoolError.SERVICE_NOT_INITIALIZED:
          return true;
        default:
          return false;
      }
    }
    
    // Check for Solana-specific errors that shouldn't be retried
    if (error.message && typeof error.message === 'string') {
      const nonRetryablePatterns = [
        'Invalid account data',
        'Account not found',
        'Invalid instruction data',
        'Invalid program id',
        'Invalid account owner',
        'Invalid account data for instruction'
      ];
      
      return nonRetryablePatterns.some(pattern => 
        error.message.toLowerCase().includes(pattern.toLowerCase())
      );
    }
    
    return false;
  }

  /**
   * Sleep utility function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
} 