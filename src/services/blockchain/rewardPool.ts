import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { Program, AnchorProvider, web3 } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
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
  private program: Program;
  private platformAuthority: Keypair;

  constructor(
    connection: Connection,
    programId: string,
    platformAuthorityKeypair: Keypair
  ) {
    this.connection = connection;
    this.platformAuthority = platformAuthorityKeypair;
    
    // Initialize the program (this will be updated when the actual program is deployed)
    const provider = new AnchorProvider(
      connection,
      { publicKey: platformAuthorityKeypair.publicKey, signTransaction: async (tx) => tx },
      { commitment: 'confirmed' }
    );
    
    // TODO: Replace with actual program IDL when deployed
    this.program = {} as Program;
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
      const farmerPubkey = new PublicKey(farmerAddress);
      const tokenMintPubkey = new PublicKey(tokenMint);
      
      // Create task completion record
      const taskRecord: TaskCompletionRecord = {
        taskId,
        farmerAddress: farmerPubkey,
        poolId,
        rewardAmount: new BN(rewardAmount * Math.pow(10, 6)), // Convert to token decimals
        tokenMint: tokenMintPubkey,
        isClaimed: false,
        completionSlot: await this.connection.getSlot(),
        signature: '' // Will be filled after transaction
      };

      // TODO: Implement actual smart contract call to record task completion
      // For now, return mock response
      const mockSignature = Buffer.from(Math.random().toString()).toString('hex');
      const mockSlot = await this.connection.getSlot();

      console.log(`[REWARD_POOL] Recorded task completion:`, {
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
      const farmerPubkey = new PublicKey(farmerAddress);
      
      // TODO: Implement actual smart contract call to get pending rewards
      // For now, return mock data
      const mockData = {
        totalPending: 0,
        taskCount: 0,
        tokenBreakdown: {}
      };

      console.log(`[REWARD_POOL] Retrieved pending rewards for ${farmerAddress}:`, mockData);
      return mockData;

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
      const farmerPubkey = new PublicKey(farmerAddress);
      
      // TODO: Implement actual smart contract call to get farmer account
      // For now, return mock data
      const mockData: FarmerAccountData = {
        farmerAddress: farmerPubkey,
        withdrawalNonce: 0,
        totalRewardsEarned: new BN(0),
        totalRewardsWithdrawn: new BN(0),
        lastWithdrawalSlot: 0
      };

      console.log(`[REWARD_POOL] Retrieved farmer account for ${farmerAddress}:`, mockData);
      return mockData;

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
      // TODO: Implement actual smart contract call to get platform stats
      // For now, return mock data
      const mockData = {
        totalRewardsDistributed: 0,
        totalPlatformFeesCollected: 0,
        isPaused: false
      };

      console.log(`[REWARD_POOL] Retrieved platform stats:`, mockData);
      return mockData;

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
      // TODO: Implement actual smart contract call to pause/unpause
      // For now, return mock response
      const mockSignature = Buffer.from(Math.random().toString()).toString('hex');
      const mockSlot = await this.connection.getSlot();

      console.log(`[REWARD_POOL] Set paused state to ${isPaused}:`, {
        signature: mockSignature,
        slot: mockSlot
      });

      return {
        signature: mockSignature,
        slot: mockSlot
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
      // TODO: Implement actual smart contract initialization
      // For now, return mock response
      const mockSignature = Buffer.from(Math.random().toString()).toString('hex');
      const mockSlot = await this.connection.getSlot();

      console.log(`[REWARD_POOL] Initialized reward pool with ${platformFeePercentage}% platform fee:`, {
        signature: mockSignature,
        slot: mockSlot
      });

      return {
        signature: mockSignature,
        slot: mockSlot
      };

    } catch (error) {
      console.error('Failed to initialize reward pool:', error);
      throw error;
    }
  }
} 