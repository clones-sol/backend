import { ValidationSchema, ValidationRules } from '../../middleware/validator.ts';

export const idValidationSchema: ValidationSchema = {
    id: {
        required: true,
        rules: [ValidationRules.pattern(/^[a-f\d]{24}$/i, 'must be a valid MongoDB ObjectId')]
    }
}; 