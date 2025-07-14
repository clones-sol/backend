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
        rules: [ValidationRules.isImageUrl()]
    },
    tokenomics: {
        required: true,
        rules: [ValidationRules.isObject()]
    },
    'tokenomics.supply': {
        required: true,
        rules: [ValidationRules.isNumber(), ValidationRules.min(1000), ValidationRules.max(1_000_000_000_000)]
    },
    'tokenomics.minLiquiditySol': {
        required: true,
        rules: [ValidationRules.isNumber(), ValidationRules.min(0)]
    },
    'tokenomics.gatedPercentage': {
        required: false,
        rules: [ValidationRules.isNumber(), ValidationRules.min(0), ValidationRules.max(50)]
    },
    'tokenomics.decimals': {
        required: false, // Default is set in the model
        rules: [ValidationRules.isNumber(), ValidationRules.min(0), ValidationRules.max(12)]
    },
    deployment: {
        required: false,
        rules: [ValidationRules.isObject()]
    },
    'deployment.customUrl': {
        required: false,
        rules: [ValidationRules.isString(), ValidationRules.pattern(/^https?:\/\//i, 'must be a valid URL.')]
    },
    'deployment.huggingFaceApiKey': {
        required: false,
        rules: [ValidationRules.isString()]
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
        rules: [ValidationRules.isImageUrl()]
    },
    tokenomics: {
        required: false,
        rules: [ValidationRules.isObject()]
    },
    'tokenomics.supply': {
        required: false,
        rules: [ValidationRules.isNumber(), ValidationRules.min(1000), ValidationRules.max(1_000_000_000_000)]
    },
    'tokenomics.minLiquiditySol': {
        required: false,
        rules: [ValidationRules.isNumber(), ValidationRules.min(0)]
    },
    'tokenomics.gatedPercentage': {
        required: false,
        rules: [ValidationRules.isNumber(), ValidationRules.min(0), ValidationRules.max(50)]
    },
    'tokenomics.decimals': {
        required: false,
        rules: [ValidationRules.isNumber(), ValidationRules.min(0), ValidationRules.max(12)]
    },
    deployment: {
        required: false,
        rules: [ValidationRules.isObject()]
    },
    'deployment.customUrl': {
        required: false,
        rules: [ValidationRules.isString(), ValidationRules.pattern(/^https?:\/\//i, 'must be a valid URL.')]
    },
    'deployment.huggingFaceApiKey': {
        required: false,
        rules: [ValidationRules.isString()]
    }
};

export const updateAgentStatusSchema: ValidationSchema = {
    status: {
        required: true,
        rules: [
            ValidationRules.isString(),
            ValidationRules.isIn(['DEACTIVATED']),
        ]
    }
};

export const submitTxSchema: ValidationSchema = {
    type: {
        required: true,
        rules: [ValidationRules.isString(), ValidationRules.isIn(['TOKEN_CREATION', 'POOL_CREATION'])],
    },
    signedTransaction: {
        required: true,
        rules: [ValidationRules.isString()],
    },
    idempotencyKey: {
        required: true,
        rules: [ValidationRules.isString()],
    },
};

export const agentVersionSchema: ValidationSchema = {
    versionTag: {
        required: true,
        rules: [ValidationRules.isString(), ValidationRules.minLength(1), ValidationRules.maxLength(20)]
    },
    customUrl: {
        required: false,
        rules: [ValidationRules.isString(), ValidationRules.pattern(/^https?:\/\//i, 'must be a valid URL.')]
    },
    huggingFaceApiKey: {
        required: false,
        rules: [ValidationRules.isString()]
    }
};

export const setActiveVersionSchema: ValidationSchema = {
    versionTag: {
        required: true,
        rules: [ValidationRules.isString()]
    }
};

export const metricsQuerySchema: ValidationSchema = {
    timeframe: {
        required: false,
        rules: [ValidationRules.isString(), ValidationRules.isIn(['24h', '7d', '30d'])]
    },
    versionTag: {
        required: false,
        rules: [ValidationRules.isString()]
    }
};

export const searchAgentsSchema: ValidationSchema = {
    q: {
        required: false,
        rules: [ValidationRules.isString()]
    },
    sortBy: {
        required: false,
        rules: [ValidationRules.isString(), ValidationRules.isIn(['newest', 'name'])]
    },
    limit: {
        required: false,
        rules: [ValidationRules.isNumber(), ValidationRules.min(1), ValidationRules.max(100)]
    },
    offset: {
        required: false,
        rules: [ValidationRules.isNumber(), ValidationRules.min(0)]
    }
}; 