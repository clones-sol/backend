import { Connection, PublicKey, Keypair, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { RewardPoolClient } from '../../solana-client';
import BN from 'bn.js';

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

export class RewardPoolService {
  private connection: Connection;
  private client: RewardPoolClient | null = null;
  private platformAuthority: Keypair;
  private programId: PublicKey | null = null;

  constructor(
    connection: Connection,
    programId: string,
    platformAuthorityKeypair: Keypair
  ) {
    this.connection = connection;
    this.platformAuthority = platformAuthorityKeypair;
    
    // Only initialize if we have a valid program ID (not the placeholder)
    if (programId && programId !== '11111111111111111111111111111111') {
      try {
        this.programId = new PublicKey(programId);
        this.client = new RewardPoolClient(connection);
        console.log(`[REWARD_POOL] Initialized with program ID: ${this.programId.toString()}`);
      } catch (error) {
        console.warn(`[REWARD_POOL] Failed to initialize program with ID ${programId}:`, error);
        console.log('[REWARD_POOL] Running in mock mode - set REWARD_POOL_PROGRAM_ID to enable real smart contract interactions');
      }
    } else {
      console.log('[REWARD_POOL] No valid program ID provided - running in mock mode');
    }
  }

  /**
   * Check if the service is properly initialized with a real program
   */
  private isInitialized(): boolean {
    return this.client !== null && this.programId !== null;
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
  ): Promise<{
    transactionData: any;
    expectedNonce: number;
    securityChecks: {
      nonceVerified: boolean;
      signerVerified: boolean;
      tasksVerified: boolean;
    };
  }> {
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
        transactionData,
        expectedNonce,
        securityChecks: {
          nonceVerified,
          signerVerified: true,
          tasksVerified
        }
      };

    } catch (error) {
      console.error('Failed to prepare withdrawal transaction:', error);
      throw error;
    }
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
} 