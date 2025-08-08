import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// Validation constants
export const MAX_STRING_LENGTH = 32;
export const MIN_REWARD_AMOUNT = 1;
export const MAX_PLATFORM_FEE_PERCENTAGE = 100;

// Validation helper functions
export function validateStringLength(value: string, fieldName: string): void {
  if (value.length > MAX_STRING_LENGTH) {
    throw new Error(`${fieldName} too long: max ${MAX_STRING_LENGTH} characters`);
  }
  if (value.length === 0) {
    throw new Error(`${fieldName} cannot be empty`);
  }
}

export function validateRewardAmount(amount: BN, fieldName: string): void {
  if (amount.lte(new BN(0))) {
    throw new Error(`${fieldName} must be greater than 0`);
  }
}

export function validateFeePercentage(percentage: number, fieldName: string): void {
  if (percentage < 0 || percentage > MAX_PLATFORM_FEE_PERCENTAGE) {
    throw new Error(`${fieldName} must be between 0 and ${MAX_PLATFORM_FEE_PERCENTAGE}`);
  }
}

export function validatePublicKey(pubkey: PublicKey, fieldName: string): void {
  if (!PublicKey.isOnCurve(pubkey.toBuffer())) {
    throw new Error(`${fieldName} is not a valid public key`);
  }
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

/**
 * Serialization and deserialization for RewardPool account
 */
export namespace RewardPool {
  export function deserialize(data: Buffer): RewardPool {
    // Layout:
    // 0: isInitialized (u8)
    // 1-32: platformAuthority (Pubkey)
    // 33: platformFeePercentage (u8)
    // 34-41: totalRewardsDistributed (u64, LE)
    // 42-49: totalPlatformFeesCollected (u64, LE)
    // 50: isPaused (u8)
    return {
      isInitialized: data[0] === 1,
      platformAuthority: new PublicKey(data.slice(1, 33)),
      platformFeePercentage: data[33],
      totalRewardsDistributed: new BN(data.slice(34, 42), 'le'),
      totalPlatformFeesCollected: new BN(data.slice(42, 50), 'le'),
      isPaused: data[50] === 1,
    };
  }

  export function serialize(account: RewardPool): Buffer {
    const buffer = Buffer.alloc(51); // Total size of the account
    
    let offset = 0;
    
    // isInitialized
    buffer.writeUint8(account.isInitialized ? 1 : 0, offset);
    offset += 1;
    
    // platformAuthority
    account.platformAuthority.toBuffer().copy(buffer, offset);
    offset += 32;
    
    // platformFeePercentage
    buffer.writeUint8(account.platformFeePercentage, offset);
    offset += 1;
    
    // totalRewardsDistributed
    account.totalRewardsDistributed.toArray('le', 8).copy(buffer, offset);
    offset += 8;
    
    // totalPlatformFeesCollected
    account.totalPlatformFeesCollected.toArray('le', 8).copy(buffer, offset);
    offset += 8;
    
    // isPaused
    buffer.writeUint8(account.isPaused ? 1 : 0, offset);
    
    return buffer;
  }
}

/**
 * Serialization and deserialization for FarmerAccount
 */
export namespace FarmerAccount {
  export function deserialize(data: Buffer): FarmerAccount {
    // Layout:
    // 0: isInitialized (u8)
    // 1-33: farmerAddress (Pubkey)
    // 34-41: withdrawalNonce (u64, LE)
    // 42-49: totalRewardsEarned (u64, LE)
    // 50-57: totalRewardsWithdrawn (u64, LE)
    // 58-65: lastWithdrawalSlot (u64, LE)
    return {
      isInitialized: data[0] === 1,
      farmerAddress: new PublicKey(data.slice(1, 33)),
      withdrawalNonce: new BN(data.slice(33, 41), 'le'),
      totalRewardsEarned: new BN(data.slice(41, 49), 'le'),
      totalRewardsWithdrawn: new BN(data.slice(49, 57), 'le'),
      lastWithdrawalSlot: new BN(data.slice(57, 65), 'le'),
    };
  }

  export function serialize(account: FarmerAccount): Buffer {
    const buffer = Buffer.alloc(66); // Total size of the account
    
    let offset = 0;
    
    // isInitialized
    buffer.writeUint8(account.isInitialized ? 1 : 0, offset);
    offset += 1;
    
    // farmerAddress
    account.farmerAddress.toBuffer().copy(buffer, offset);
    offset += 32;
    
    // withdrawalNonce
    account.withdrawalNonce.toArray('le', 8).copy(buffer, offset);
    offset += 8;
    
    // totalRewardsEarned
    account.totalRewardsEarned.toArray('le', 8).copy(buffer, offset);
    offset += 8;
    
    // totalRewardsWithdrawn
    account.totalRewardsWithdrawn.toArray('le', 8).copy(buffer, offset);
    offset += 8;
    
    // lastWithdrawalSlot
    account.lastWithdrawalSlot.toArray('le', 8).copy(buffer, offset);
    
    return buffer;
  }
}

/**
 * Serialization and deserialization for TaskCompletionRecord
 */
export namespace TaskCompletionRecord {
  export function deserialize(data: Buffer): TaskCompletionRecord {
    // Layout:
    // 0: isInitialized (u8)
    // 1: taskId length (u8)
    // 2-33: taskId (string, max 32 bytes)
    // 34-65: farmerAddress (Pubkey)
    // 66: poolId length (u8)
    // 67-98: poolId (string, max 32 bytes)
    // 99-106: rewardAmount (u64, LE)
    // 107-139: tokenMint (Pubkey)
    // 140: isClaimed (u8)
    // 141-148: completionSlot (u64, LE)
    
    let offset = 0;
    
    // Parse isInitialized
    const isInitialized = data[offset] === 1;
    offset += 1;
    
    // Parse taskId
    const taskIdLength = data[offset];
    offset += 1;
    const taskId = data.slice(offset, offset + taskIdLength).toString('utf8');
    offset += 32; // Skip to next field (32 bytes reserved for taskId)
    
    // Parse farmerAddress
    const farmerAddress = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    
    // Parse poolId
    const poolIdLength = data[offset];
    offset += 1;
    const poolId = data.slice(offset, offset + poolIdLength).toString('utf8');
    offset += 32; // Skip to next field (32 bytes reserved for poolId)
    
    // Parse rewardAmount
    const rewardAmount = new BN(data.slice(offset, offset + 8), 'le');
    offset += 8;
    
    // Parse tokenMint
    const tokenMint = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    
    // Parse isClaimed
    const isClaimed = data[offset] === 1;
    offset += 1;
    
    // Parse completionSlot
    const completionSlot = new BN(data.slice(offset, offset + 8), 'le');
    
    return {
      isInitialized,
      taskId,
      farmerAddress,
      poolId,
      rewardAmount,
      tokenMint,
      isClaimed,
      completionSlot,
    };
  }

  export function serialize(record: TaskCompletionRecord): Buffer {
    const buffer = Buffer.alloc(149); // Total size of the record
    
    let offset = 0;
    
    // isInitialized
    buffer.writeUint8(record.isInitialized ? 1 : 0, offset);
    offset += 1;
    
    // taskId length and string
    const taskIdBuffer = Buffer.from(record.taskId, 'utf8');
    buffer.writeUint8(taskIdBuffer.length, offset);
    offset += 1;
    taskIdBuffer.copy(buffer, offset);
    offset += 32; // Reserve 32 bytes for taskId
    
    // farmerAddress
    record.farmerAddress.toBuffer().copy(buffer, offset);
    offset += 32;
    
    // poolId length and string
    const poolIdBuffer = Buffer.from(record.poolId, 'utf8');
    buffer.writeUint8(poolIdBuffer.length, offset);
    offset += 1;
    poolIdBuffer.copy(buffer, offset);
    offset += 32; // Reserve 32 bytes for poolId
    
    // rewardAmount
    record.rewardAmount.toArray('le', 8).copy(buffer, offset);
    offset += 8;
    
    // tokenMint
    record.tokenMint.toBuffer().copy(buffer, offset);
    offset += 32;
    
    // isClaimed
    buffer.writeUint8(record.isClaimed ? 1 : 0, offset);
    offset += 1;
    
    // completionSlot
    record.completionSlot.toArray('le', 8).copy(buffer, offset);
    
    return buffer;
  }
}
