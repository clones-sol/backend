import { ValidationSchema, ValidationRules } from '../../middleware/validator.ts';

/**
 * Schema for quest request
 */
export const questRequestSchema: ValidationSchema = {
  address: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.isSolanaAddress()]
  },
  prompt: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  installed_applications: {
    required: false,
    rules: [ValidationRules.isString()]
  }
};

/**
 * Schema for progress check request
 */
export const progressCheckSchema: ValidationSchema = {
  quest: {
    required: true,
    rules: [ValidationRules.isObject()]
  },
  screenshots: {
    required: true,
    rules: [ValidationRules.isArray(), ValidationRules.isNonEmptyArray()]
  }
};
