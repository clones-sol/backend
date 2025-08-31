import { ValidationSchema, ValidationRules } from '../../middleware/validator.ts';

export const chatRequestSchema: ValidationSchema = {
    messages: {
        required: true,
        rules: [ValidationRules.isArray()]
    },
    task_prompt: {
        required: true,
        rules: [ValidationRules.isString()]
    },
    app: {
        required: true,
        rules: [ValidationRules.isObject()]
    }
};