import { struct, u8, u64, publicKey, str, bool } from '@solana/buffer-layout';
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// Custom layout for BN (Big Number)
const bn = (property = 'bn') => {
  return {
    encode: (value: BN, buffer: Buffer, offset: number) => {
      const bytes = value.toArray('le', 8);
      buffer.set(bytes, offset);
      return offset + 8;
    },
    decode: (buffer: Buffer, offset: number) => {
      const bytes = buffer.slice(offset, offset + 8);
      return new BN(bytes, 'le');
    },
    span: 8,
    property,
  };
};

// Custom layout for string with length prefix
const stringWithLength = (maxLength: number, property = 'string') => {
  return {
    encode: (value: string, buffer: Buffer, offset: number) => {
      const stringBuffer = Buffer.from(value, 'utf8');
      if (stringBuffer.length > maxLength) {
        throw new Error(`String too long: max ${maxLength} bytes`);
      }
      buffer.writeUint8(stringBuffer.length, offset);
      stringBuffer.copy(buffer, offset + 1);
      return offset + 1 + maxLength; // Return offset after reserved space
    },
    decode: (buffer: Buffer, offset: number) => {
      const length = buffer.readUint8(offset);
      const stringBytes = buffer.slice(offset + 1, offset + 1 + length);
      return stringBytes.toString('utf8');
    },
    span: 1 + maxLength, // 1 byte for length + maxLength bytes for string
    property,
  };
};

// Layout for RewardPool account
export const REWARD_POOL_LAYOUT = struct([
  bool('isInitialized'),
  publicKey('platformAuthority'),
  u8('platformFeePercentage'),
  bn('totalRewardsDistributed'),
  bn('totalPlatformFeesCollected'),
  bool('isPaused'),
]);

// Layout for FarmerAccount
export const FARMER_ACCOUNT_LAYOUT = struct([
  bool('isInitialized'),
  publicKey('farmerAddress'),
  bn('withdrawalNonce'),
  bn('totalRewardsEarned'),
  bn('totalRewardsWithdrawn'),
  bn('lastWithdrawalSlot'),
]);

// Layout for TaskCompletionRecord
export const TASK_COMPLETION_RECORD_LAYOUT = struct([
  bool('isInitialized'),
  stringWithLength(32, 'taskId'),
  publicKey('farmerAddress'),
  stringWithLength(32, 'poolId'),
  bn('rewardAmount'),
  publicKey('tokenMint'),
  bool('isClaimed'),
  bn('completionSlot'),
]);

// Helper functions for serialization/deserialization
export function serializeRewardPool(account: any): Buffer {
  const buffer = Buffer.alloc(REWARD_POOL_LAYOUT.span);
  REWARD_POOL_LAYOUT.encode(account, buffer, 0);
  return buffer;
}

export function deserializeRewardPool(buffer: Buffer): any {
  return REWARD_POOL_LAYOUT.decode(buffer, 0);
}

export function serializeFarmerAccount(account: any): Buffer {
  const buffer = Buffer.alloc(FARMER_ACCOUNT_LAYOUT.span);
  FARMER_ACCOUNT_LAYOUT.encode(account, buffer, 0);
  return buffer;
}

export function deserializeFarmerAccount(buffer: Buffer): any {
  return FARMER_ACCOUNT_LAYOUT.decode(buffer, 0);
}

export function serializeTaskCompletionRecord(record: any): Buffer {
  const buffer = Buffer.alloc(TASK_COMPLETION_RECORD_LAYOUT.span);
  TASK_COMPLETION_RECORD_LAYOUT.encode(record, buffer, 0);
  return buffer;
}

export function deserializeTaskCompletionRecord(buffer: Buffer): any {
  return TASK_COMPLETION_RECORD_LAYOUT.decode(buffer, 0);
}

// Layout constants for validation
export const LAYOUT_CONSTANTS = {
  REWARD_POOL_SIZE: REWARD_POOL_LAYOUT.span,
  FARMER_ACCOUNT_SIZE: FARMER_ACCOUNT_LAYOUT.span,
  TASK_COMPLETION_RECORD_SIZE: TASK_COMPLETION_RECORD_LAYOUT.span,
  MAX_STRING_LENGTH: 32,
} as const;
