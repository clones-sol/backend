import { ValidationRules, type ValidationSchema } from '../../middleware/validator.ts'

export const chatRequestSchema: ValidationSchema = {
  messages: {
    required: true,
    rules: [ValidationRules.isArray()]
  },
  task_prompt: {
    required: true,
    rules: [ValidationRules.isString()]
  },
  apps_used: {
    required: true,
    rules: [ValidationRules.isArray(), ValidationRules.arrayMinLength(1)]
  },
  // Backward compatibility - keep app for single-app workflows
  app: {
    required: false,
    rules: [ValidationRules.isObject()]
  }
}
