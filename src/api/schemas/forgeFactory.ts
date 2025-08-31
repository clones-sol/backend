import { ValidationSchema, ValidationRules } from '../../middleware/validator.ts';
import { getSupportedTokenSymbols } from '../../services/blockchain/tokens.ts';

export const createPoolSchema: ValidationSchema = {
    token: {
        required: true,
        rules: [ValidationRules.isString(), ValidationRules.isIn(getSupportedTokenSymbols())]
    },
    creator: {
        required: true,
        rules: [ValidationRules.isEVMAddress()]
    }
};

export const predictPoolSchema: ValidationSchema = {
    creator: {
        required: true,
        rules: [ValidationRules.isEVMAddress()]
    },
    token: {
        required: true,
        rules: [ValidationRules.isString(), ValidationRules.isIn(getSupportedTokenSymbols())]
    }
};

export const fundPoolSchema: ValidationSchema = {
    poolAddress: {
        required: true,
        rules: [ValidationRules.isEVMAddress()]
    },
    amount: {
        required: true,
        rules: [ValidationRules.isNumber(), ValidationRules.min(0)]
    }
};

export const generateClaimSchema: ValidationSchema = {
    vaultAddress: {
        required: true,
        rules: [ValidationRules.isEVMAddress()]
    },
    account: {
        required: true,
        rules: [ValidationRules.isEVMAddress()]
    },
    cumulativeAmount: {
        required: true,
        rules: [ValidationRules.isNumber(), ValidationRules.min(0)]
    },
    deadline: {
        required: false,
        rules: [ValidationRules.isNumber()]
    }
};

export const batchClaimSchema: ValidationSchema = {
    claims: {
        required: true,
        rules: [ValidationRules.isArray()]
    }
};

export const poolAddressParamSchema: ValidationSchema = {
    poolAddress: {
        required: true,
        rules: [ValidationRules.isEVMAddress()]
    }
};

export const poolInfoQuerySchema: ValidationSchema = {
    account: {
        required: false,
        rules: [ValidationRules.isEVMAddress()]
    }
};

export const generateContentSchema: ValidationSchema = {
    prompt: {
        required: true,
        rules: [ValidationRules.isString(), ValidationRules.minLength(1), ValidationRules.maxLength(2000)]
    },
    factoryId: {
        required: false,
        rules: [ValidationRules.isString()]
    }
};

export const getTasksSchema: ValidationSchema = {
    pool_id: {
        required: false,
        rules: [ValidationRules.isString()]
    },
    min_reward: {
        required: false,
        rules: [ValidationRules.isNumber(), ValidationRules.min(0)]
    },
    max_reward: {
        required: false,
        rules: [ValidationRules.isNumber(), ValidationRules.min(0)]
    },
    categories: {
        required: false,
        rules: [ValidationRules.isString()]
    },
    query: {
        required: false,
        rules: [ValidationRules.isString(), ValidationRules.maxLength(500)]
    },
    hide_adult: {
        required: false,
        rules: [ValidationRules.isString(), ValidationRules.matches(/^(true|false)$/, 'must be "true" or "false"')]
    }
};
