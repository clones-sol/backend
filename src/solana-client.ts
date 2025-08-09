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
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import BN from 'bn.js';

// Import serialization module
import {
  RewardPool,
  FarmerAccount,
  TaskCompletionRecord,
  validateStringLength,
  validateRewardAmount,
  validateFeePercentage,
  validatePublicKey,
} from './serialization/reward-pool';

// Program ID - should be configurable per environment
const PROGRAM_ID = new PublicKey(process.env.REWARD_POOL_PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

// Instruction types
export enum RewardPoolInstruction {
  InitializeRewardPool = 0,
  RecordTaskCompletion = 1,
  WithdrawRewards = 2,
  SetPaused = 3,
  UpdatePlatformFee = 4,
}

export class RewardPoolClient {
  private connection: Connection;
  private programId: PublicKey;

  constructor(connection: Connection) {
    this.connection = connection;
    this.programId = PROGRAM_ID;
  }

  // Helper method to send transactions with proper error handling
  private async sendTransaction(
    instruction: TransactionInstruction,
    signers: Keypair[],
    feePayer: PublicKey
  ): Promise<string> {
    try {
      const transaction = new Transaction().add(instruction);
      transaction.recentBlockhash = (
        await this.connection.getLatestBlockhash()
      ).blockhash;
      transaction.feePayer = feePayer;

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        signers
      );

      return signature;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Transaction failed: ${errorMessage}`);
    }
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

  private getRewardVaultPDA(tokenMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('reward_vault'), tokenMint.toBuffer()],
      this.programId
    );
  }

  // Initialize reward pool
  async initializeRewardPool(
    platformAuthority: Keypair,
    platformFeePercentage: number = 10
  ): Promise<string> {
    // Validate inputs
    validatePublicKey(platformAuthority.publicKey, 'platformAuthority');
    validateFeePercentage(platformFeePercentage, 'platformFeePercentage');
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

    return await this.sendTransaction(instruction, [platformAuthority], platformAuthority.publicKey);
  }

  // Get reward pool data
  async getRewardPool(): Promise<RewardPool | null> {
    const [rewardPoolPDA] = this.getRewardPoolPDA();

    try {
      const accountInfo = await this.connection.getAccountInfo(rewardPoolPDA);
      if (!accountInfo) {
        return null;
      }

      const rewardPool = RewardPool.deserialize(accountInfo.data);
      return rewardPool;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get reward pool: ${errorMessage}`);
    }
  }

  // Get farmer account data
  async getFarmerAccount(farmerAddress: PublicKey): Promise<FarmerAccount | null> {
    const [farmerAccountPDA] = this.getFarmerAccountPDA(farmerAddress);

    try {
      const accountInfo = await this.connection.getAccountInfo(farmerAccountPDA);
      if (!accountInfo) {
        return null;
      }

      const farmerAccount = FarmerAccount.deserialize(accountInfo.data);
      return farmerAccount;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get farmer account: ${errorMessage}`);
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
    // Validate inputs
    validateStringLength(taskId, 'taskId');
    validateStringLength(poolId, 'poolId');
    validateRewardAmount(rewardAmount, 'rewardAmount');
    validatePublicKey(farmerAddress, 'farmerAddress');
    validatePublicKey(tokenMint, 'tokenMint');
    validatePublicKey(platformAuthority.publicKey, 'platformAuthority');
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
        { pubkey: rewardPoolPDA, isSigner: false, isWritable: true },
        { pubkey: farmerAccountPDA, isSigner: false, isWritable: true },
        { pubkey: taskRecordPDA, isSigner: false, isWritable: true },
        { pubkey: farmerAddress, isSigner: false, isWritable: false },
        { pubkey: tokenMint, isSigner: false, isWritable: false },
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

  // Withdraw rewards
  async withdrawRewards(
    taskIds: string[],
    expectedNonce: BN,
    farmer: Keypair,
    tokenMint: PublicKey,
    platformTreasury: PublicKey
  ): Promise<string> {
    // Validate inputs
    if (taskIds.length === 0) {
      throw new Error('taskIds array cannot be empty');
    }
    taskIds.forEach((taskId, index) => {
      validateStringLength(taskId, `taskIds[${index}]`);
    });
    validatePublicKey(farmer.publicKey, 'farmer');
    validatePublicKey(tokenMint, 'tokenMint');
    validatePublicKey(platformTreasury, 'platformTreasury');
    const [rewardPoolPDA] = this.getRewardPoolPDA();
    const [farmerAccountPDA] = this.getFarmerAccountPDA(farmer.publicKey);
    const [rewardVaultPDA] = this.getRewardVaultPDA(tokenMint);

    // Get or create farmer's token account
    const farmerTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      farmer,
      tokenMint,
      farmer.publicKey
    );

    // Serialize instruction data
    const data = Buffer.alloc(
      1 + // instruction
      4 + // task_ids array length
      taskIds.reduce((acc, taskId) => acc + 4 + Buffer.from(taskId, 'utf8').length, 0) + // task_ids strings
      8 // expected_nonce (u64)
    );

    let offset = 0;
    data.writeUint8(RewardPoolInstruction.WithdrawRewards, offset);
    offset += 1;
    
    data.writeUint32LE(taskIds.length, offset);
    offset += 4;
    
    for (const taskId of taskIds) {
      const taskIdBuffer = Buffer.from(taskId, 'utf8');
      data.writeUint32LE(taskIdBuffer.length, offset);
      offset += 4;
      taskIdBuffer.copy(data, offset);
      offset += taskIdBuffer.length;
    }
    
    data.writeBigUInt64LE(BigInt(expectedNonce.toString()), offset);

    // Build account keys array
    const accountKeys = [
      { pubkey: rewardPoolPDA, isSigner: false, isWritable: true },
      { pubkey: farmerAccountPDA, isSigner: false, isWritable: true },
      { pubkey: rewardVaultPDA, isSigner: false, isWritable: true },
      { pubkey: farmerTokenAccount.address, isSigner: false, isWritable: true },
      { pubkey: platformTreasury, isSigner: false, isWritable: true },
      { pubkey: farmer.publicKey, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    // Add task record accounts
    for (const taskId of taskIds) {
      const [taskRecordPDA] = this.getTaskRecordPDA(taskId);
      accountKeys.push({
        pubkey: taskRecordPDA,
        isSigner: false,
        isWritable: true,
      });
    }

    const instruction = new TransactionInstruction({
      keys: accountKeys,
      programId: this.programId,
      data,
    });

    const transaction = new Transaction().add(instruction);
    transaction.recentBlockhash = (
      await this.connection.getLatestBlockhash()
    ).blockhash;
    transaction.feePayer = farmer.publicKey;

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [farmer]
    );

    return signature;
  }

  // Get task completion record
  async getTaskCompletionRecord(taskId: string): Promise<TaskCompletionRecord | null> {
    const [taskRecordPDA] = this.getTaskRecordPDA(taskId);

    try {
      const accountInfo = await this.connection.getAccountInfo(taskRecordPDA);
      if (!accountInfo) {
        return null;
      }

      const taskRecord = TaskCompletionRecord.deserialize(accountInfo.data);
      return taskRecord;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get task completion record: ${errorMessage}`);
    }
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

  // Update platform fee
  async updatePlatformFee(
    newFeePercentage: number,
    platformAuthority: Keypair
  ): Promise<string> {
    // Validate inputs
    validateFeePercentage(newFeePercentage, 'newFeePercentage');
    validatePublicKey(platformAuthority.publicKey, 'platformAuthority');
    const [rewardPoolPDA] = this.getRewardPoolPDA();

    const data = Buffer.alloc(1 + 1);
    data.writeUint8(RewardPoolInstruction.UpdatePlatformFee, 0);
    data.writeUint8(newFeePercentage, 1);

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

  // Helper method to create reward vault
  async createRewardVault(
    tokenMint: PublicKey,
    platformAuthority: Keypair
  ): Promise<string> {
    const [rewardVaultPDA] = this.getRewardVaultPDA(tokenMint);

    const instruction = createAssociatedTokenAccountInstruction(
      platformAuthority.publicKey,
      rewardVaultPDA,
      rewardVaultPDA,
      tokenMint
    );

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

  // Helper method to get reward vault balance
  async getRewardVaultBalance(tokenMint: PublicKey): Promise<BN> {
    const [rewardVaultPDA] = this.getRewardVaultPDA(tokenMint);

    try {
      const accountInfo = await this.connection.getAccountInfo(rewardVaultPDA);
      if (!accountInfo) {
        return new BN(0);
      }

      const tokenAccount = await getAccount(this.connection, rewardVaultPDA);
      return new BN(tokenAccount.amount.toString());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get reward vault balance: ${errorMessage}`);
    }
  }
} 