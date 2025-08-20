import { ValidationSchema, ValidationRules } from '../../middleware/validator.ts';
import { ContentFilterService } from '../../services/validation/contentFilter.ts';

/**
 * Schema for generating referral code
 */
export const generateCodeSchema: ValidationSchema = {
  walletAddress: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.isEVMAddress()
    ]
  }
};

/**
 * Schema for validating referral code
 */
export const validateCodeSchema: ValidationSchema = {
  referralCode: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.isReferralCode(),
      ValidationRules.customValidator(
        async (value: string) => await ContentFilterService.isReferralCodeAcceptable(value),
        'Referral code contains inappropriate content'
      )
    ]
  }
};

/**
 * Schema for applying a referrer code
 */
export const applyReferrerCodeSchema: ValidationSchema = {
  referreeAddress: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.isEVMAddress()
    ]
  },
  referralCode: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.customValidator(
        async (value: string) => await ContentFilterService.isReferralCodeAcceptable(value),
        'Referral code contains inappropriate content'
      )
    ]
  }
};

/**
 * Schema for extending expiration
 */
export const extendExpirationSchema: ValidationSchema = {
  walletAddress: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.isEVMAddress()
    ]
  },
  extensionDays: {
    required: false,
    rules: [
      ValidationRules.isNumber(),
      ValidationRules.min(1),
      ValidationRules.max(365),
      ValidationRules.isInteger()
    ]
  }
};

/**
 * Schema for regenerating code
 */
export const regenerateCodeSchema: ValidationSchema = {
  walletAddress: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.isEVMAddress()
    ]
  }
};

/**
 * Schema for wallet address URL parameter
 */
export const walletAddressParamSchema: ValidationSchema = {
  walletAddress: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.isEVMAddress()
    ]
  }
}; 