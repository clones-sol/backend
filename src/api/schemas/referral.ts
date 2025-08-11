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
 * Schema for applying a referrer code
 */
export const applyReferrerCodeSchema: ValidationSchema = {
  referreeAddress: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.isSolanaAddress()]
  },
  referralCode: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1), ValidationRules.maxLength(20)]
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