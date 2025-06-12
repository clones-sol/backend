import { ValidationSchema } from '../../middleware/validator.ts';

/**
 * Schema for settings query parameters
 * Currently, the settings endpoint doesn't require any parameters,
 * but this schema can be extended if needed in the future.
 */
export const settingsQuerySchema: ValidationSchema = {
  // No required parameters for now
};
