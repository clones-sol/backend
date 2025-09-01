import { ValidationSchema, ValidationRules } from '../../middleware/validator.ts';

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
