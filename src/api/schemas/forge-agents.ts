import { ValidationSchema, ValidationRules } from '../../middleware/validator.ts';

export const createAgentSchema: ValidationSchema = {
    pool_id: {
        required: true,
        rules: [ValidationRules.isString()]
    },
    name: {
        required: true,
        rules: [ValidationRules.isString(), ValidationRules.minLength(3), ValidationRules.maxLength(50)]
    },
    ticker: {
        required: true,
        rules: [
            ValidationRules.isString(),
            ValidationRules.minLength(3),
            ValidationRules.maxLength(10),
            ValidationRules.pattern(/^[A-Z0-9]+$/, 'must contain only uppercase letters and numbers.')
        ]
    },
    description: {
        required: true,
        rules: [ValidationRules.isString(), ValidationRules.minLength(10), ValidationRules.maxLength(1000)]
    },
    logoUrl: {
        required: false,
        rules: [ValidationRules.isString(), ValidationRules.pattern(/^https?:\/\/.+\.(jpg|jpeg|png|gif|svg)$/i, 'must be a valid image URL.')]
    },
    tokenomics: {
        required: true,
        rules: [ValidationRules.isObject()]
    },
    deployment: {
        required: false,
        rules: [ValidationRules.isObject()]
    }
};

export const updateAgentSchema: ValidationSchema = {
    name: {
        required: false,
        rules: [ValidationRules.isString(), ValidationRules.minLength(3), ValidationRules.maxLength(50)]
    },
    description: {
        required: false,
        rules: [ValidationRules.isString(), ValidationRules.minLength(10), ValidationRules.maxLength(1000)]
    },
    logoUrl: {
        required: false,
        rules: [ValidationRules.isString(), ValidationRules.pattern(/^https?:\/\/.+\.(jpg|jpeg|png|gif|svg)$/i, 'must be a valid image URL.')]
    },
    tokenomics: {
        required: false,
        rules: [ValidationRules.isObject()]
    },
    deployment: {
        required: false,
        rules: [ValidationRules.isObject()]
    }
}; 