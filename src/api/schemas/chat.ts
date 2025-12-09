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
    required: false,
    rules: [ValidationRules.isArray(), ValidationRules.arrayMinLength(1)]
  },
  app: {
    required: false,
    rules: [ValidationRules.isObject()]
  },
  factory_id: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  task_id: {
    required: false,
    rules: [ValidationRules.isString()]
  }
}
