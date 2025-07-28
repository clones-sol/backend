import { ValidationSchema, ValidationRules } from '../../middleware/validator.ts';

/**
 * Schema for generating referral code
 */
export const generateCodeSchema: ValidationSchema = {
  walletAddress: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.isSolanaAddress()]
  }
};

/**
 * Schema for validating referral code
 */
export const validateCodeSchema: ValidationSchema = {
  referralCode: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1), ValidationRules.maxLength(20)]
  }
};

/**
 * Schema for creating referral relationship
 */
export const createReferralSchema: ValidationSchema = {
  referrerAddress: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.isSolanaAddress()]
  },
  referreeAddress: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.isSolanaAddress()]
  },
  referralCode: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1), ValidationRules.maxLength(20)]
  },
  firstActionType: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  firstActionData: {
    required: false,
    rules: [ValidationRules.isObject()]
  },
  actionValue: {
    required: false,
    rules: [ValidationRules.isNumber(), ValidationRules.min(0)]
  }
};

/**
 * Schema for processing rewards
 */
export const processRewardSchema: ValidationSchema = {
  referrerAddress: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.isSolanaAddress()]
  },
  referreeAddress: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.isSolanaAddress()]
  },
  actionType: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  actionValue: {
    required: false,
    rules: [ValidationRules.isNumber(), ValidationRules.min(0)]
  }
};

/**
 * Schema for extending expiration
 */
export const extendExpirationSchema: ValidationSchema = {
  walletAddress: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.isSolanaAddress()]
  },
  extensionDays: {
    required: false,
    rules: [ValidationRules.isNumber(), ValidationRules.min(1), ValidationRules.max(365)]
  }
};

/**
 * Schema for regenerating code
 */
export const regenerateCodeSchema: ValidationSchema = {
  walletAddress: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.isSolanaAddress()]
  }
};

/**
 * Schema for wallet address URL parameter
 */
export const walletAddressParamSchema: ValidationSchema = {
  walletAddress: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.isSolanaAddress()]
  }
}; 