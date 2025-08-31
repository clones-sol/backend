import { ValidationSchema, ValidationRules } from '../../middleware/validator.ts';

export const estimateGasSchema: ValidationSchema = {
    claims: {
        required: true,
        rules: [ValidationRules.isArray()]
    },
    fromAddress: {
        required: true,
        rules: [ValidationRules.isEVMAddress()]
    }
};

export const analyzeGasSchema: ValidationSchema = {
    claims: {
        required: true,
        rules: [ValidationRules.isArray()]
    },
    fromAddress: {
        required: true,
        rules: [ValidationRules.isEVMAddress()]
    },
    tokenPriceUsd: {
        required: false,
        rules: [ValidationRules.isNumber(), ValidationRules.min(0)]
    }
};

export const optimizeBatchSchema: ValidationSchema = {
    claims: {
        required: true,
        rules: [ValidationRules.isArray()]
    },
    fromAddress: {
        required: true,
        rules: [ValidationRules.isEVMAddress()]
    },
    maxGasCostUsd: {
        required: false,
        rules: [ValidationRules.isNumber(), ValidationRules.min(0)]
    }
};

export const gasAdviceSchema: ValidationSchema = {
    network: {
        required: false,
        rules: [ValidationRules.isString(), ValidationRules.isIn(['baseSepolia', 'baseMainnet'])]
    }
};
