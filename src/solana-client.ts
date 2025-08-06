import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  getAccount,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import BN from 'bn.js';

// Program ID
const PROGRAM_ID = new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

// Instruction types
export enum RewardPoolInstruction {
  InitializeRewardPool = 0,
  RecordTaskCompletion = 1,
  WithdrawRewards = 2,
  SetPaused = 3,
  UpdatePlatformFee = 4,
}

// Account structures
export interface RewardPool {
  isInitialized: boolean;
  platformAuthority: PublicKey;
  platformFeePercentage: number;
  totalRewardsDistributed: BN;
  totalPlatformFeesCollected: BN;
  isPaused: boolean;
}

export interface FarmerAccount {
  isInitialized: boolean;
  farmerAddress: PublicKey;
  withdrawalNonce: BN;
  totalRewardsEarned: BN;
  totalRewardsWithdrawn: BN;
  lastWithdrawalSlot: BN;
}

export interface TaskCompletionRecord {
  isInitialized: boolean;
  taskId: string;
  farmerAddress: PublicKey;
  poolId: string;
  rewardAmount: BN;
  tokenMint: PublicKey;
  isClaimed: boolean;
  completionSlot: BN;
}

export class RewardPoolClient {
  private connection: Connection;
  private programId: PublicKey;

  constructor(connection: Connection) {
    this.connection = connection;
    this.programId = PROGRAM_ID;
  }

  // Helper methods for PDAs
  private getRewardPoolPDA(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('reward_pool')],
      this.programId
    );
  }

  private getFarmerAccountPDA(farmerAddress: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('farmer'), farmerAddress.toBuffer()],
      this.programId
    );
  }

  private getTaskRecordPDA(taskId: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('task'), Buffer.from(taskId)],
      this.programId
    );
  }

  // Initialize reward pool
  async initializeRewardPool(
    platformAuthority: Keypair,
    platformFeePercentage: number = 10
  ): Promise<string> {
    const [rewardPoolPDA] = this.getRewardPoolPDA();

    const data = Buffer.alloc(1 + 1);
    data.writeUint8(RewardPoolInstruction.InitializeRewardPool, 0);
    data.writeUint8(platformFeePercentage, 1);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: rewardPoolPDA, isSigner: false, isWritable: true },
        { pubkey: platformAuthority.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });

    const transaction = new Transaction().add(instruction);
    transaction.recentBlockhash = (
      await this.connection.getLatestBlockhash()
    ).blockhash;
    transaction.feePayer = platformAuthority.publicKey;

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [platformAuthority]
    );

    return signature;
  }

  // Get reward pool data
  async getRewardPool(): Promise<RewardPool | null> {
    const [rewardPoolPDA] = this.getRewardPoolPDA();
    
    try {
      const accountInfo = await this.connection.getAccountInfo(rewardPoolPDA);
      if (!accountInfo) return null;

      const data = accountInfo.data;
      let offset = 0;

      const isInitialized = data.readUint8(offset) === 1;
      offset += 1;
      
      const platformAuthority = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      const platformFeePercentage = data.readUint8(offset);
      offset += 1;
      
      const totalRewardsDistributed = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;
      
      const totalPlatformFeesCollected = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;
      
      const isPaused = data.readUint8(offset) === 1;

      return {
        isInitialized,
        platformAuthority,
        platformFeePercentage,
        totalRewardsDistributed,
        totalPlatformFeesCollected,
        isPaused,
      };
    } catch (error) {
      console.error('Error fetching reward pool:', error);
      return null;
    }
  }

  // Get farmer account data
  async getFarmerAccount(farmerAddress: PublicKey): Promise<FarmerAccount | null> {
    const [farmerAccountPDA] = this.getFarmerAccountPDA(farmerAddress);
    
    try {
      const accountInfo = await this.connection.getAccountInfo(farmerAccountPDA);
      if (!accountInfo) return null;

      const data = accountInfo.data;
      let offset = 0;

      const isInitialized = data.readUint8(offset) === 1;
      offset += 1;
      
      const farmerAddressFromData = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      const withdrawalNonce = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;
      
      const totalRewardsEarned = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;
      
      const totalRewardsWithdrawn = new BN(data.slice(offset, offset + 8), 'le');
      offset += 8;
      
      const lastWithdrawalSlot = new BN(data.slice(offset, offset + 8), 'le');

      return {
        isInitialized,
        farmerAddress: farmerAddressFromData,
        withdrawalNonce,
        totalRewardsEarned,
        totalRewardsWithdrawn,
        lastWithdrawalSlot,
      };
    } catch (error) {
      console.error('Error fetching farmer account:', error);
      return null;
    }
  }

  // Record task completion
  async recordTaskCompletion(
    taskId: string,
    poolId: string,
    rewardAmount: BN,
    farmerAddress: PublicKey,
    tokenMint: PublicKey,
    platformAuthority: Keypair
  ): Promise<string> {
    const [rewardPoolPDA] = this.getRewardPoolPDA();
    const [farmerAccountPDA] = this.getFarmerAccountPDA(farmerAddress);
    const [taskRecordPDA] = this.getTaskRecordPDA(taskId);

    // Serialize instruction data
    const taskIdBuffer = Buffer.from(taskId, 'utf8');
    const poolIdBuffer = Buffer.from(poolId, 'utf8');
    
    const data = Buffer.alloc(
      1 + // instruction
      4 + taskIdBuffer.length + // string length + taskId
      4 + poolIdBuffer.length + // string length + poolId
      8 // rewardAmount (u64)
    );

    let offset = 0;
    data.writeUint8(RewardPoolInstruction.RecordTaskCompletion, offset);
    offset += 1;
    
    data.writeUint32LE(taskIdBuffer.length, offset);
    offset += 4;
    taskIdBuffer.copy(data, offset);
    offset += taskIdBuffer.length;
    
    data.writeUint32LE(poolIdBuffer.length, offset);
    offset += 4;
    poolIdBuffer.copy(data, offset);
    offset += poolIdBuffer.length;
    
    data.writeBigUInt64LE(BigInt(rewardAmount.toString()), offset);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: rewardPoolPDA, isSigner: false, isWritable: false },
        { pubkey: farmerAccountPDA, isSigner: false, isWritable: true },
        { pubkey: taskRecordPDA, isSigner: false, isWritable: true },
        { pubkey: farmerAddress, isSigner: false, isWritable: false },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
        { pubkey: platformAuthority.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });

    const transaction = new Transaction().add(instruction);
    transaction.recentBlockhash = (
      await this.connection.getLatestBlockhash()
    ).blockhash;
    transaction.feePayer = platformAuthority.publicKey;

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [platformAuthority]
    );

    return signature;
  }

  // Set paused state
  async setPaused(
    isPaused: boolean,
    platformAuthority: Keypair
  ): Promise<string> {
    const [rewardPoolPDA] = this.getRewardPoolPDA();

    const data = Buffer.alloc(1 + 1);
    data.writeUint8(RewardPoolInstruction.SetPaused, 0);
    data.writeUint8(isPaused ? 1 : 0, 1);

    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: rewardPoolPDA, isSigner: false, isWritable: true },
        { pubkey: platformAuthority.publicKey, isSigner: true, isWritable: false },
      ],
      programId: this.programId,
      data,
    });

    const transaction = new Transaction().add(instruction);
    transaction.recentBlockhash = (
      await this.connection.getLatestBlockhash()
    ).blockhash;
    transaction.feePayer = platformAuthority.publicKey;

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [platformAuthority]
    );

    return signature;
  }
} 