import { ValidationSchema, ValidationRules } from '../../middleware/validator.ts';

/**
 * Schema for creating a new training pool
 */
export const createPoolSchema: ValidationSchema = {
  name: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  skills: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  token: {
    required: true,
    rules: [ValidationRules.isObject()]
  },
  pricePerDemo: {
    required: false,
    rules: [ValidationRules.isNumber(), ValidationRules.min(1)]
  },
  apps: {
    required: false,
    rules: [ValidationRules.isArray()]
  }
};

/**
 * Schema for getting a pool by ID
 */
export const getPoolByIdSchema: ValidationSchema = {
  id: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  }
};

/**
 * Schema for refreshing a pool
 */
export const refreshPoolSchema: ValidationSchema = {
  id: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  }
};

/**
 * Schema for updating a pool
 */
export const updatePoolSchema: ValidationSchema = {
  id: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  name: {
    required: false,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  status: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.isIn(['live', 'paused'], 'Status must be either "live" or "paused"')
    ]
  },
  skills: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  pricePerDemo: {
    required: false,
    rules: [ValidationRules.isNumber(), ValidationRules.min(1)]
  },
  apps: {
    required: false,
    rules: [ValidationRules.isArray()]
  },
  uploadLimit: {
    required: false,
    rules: [ValidationRules.isObject()]
  }
};

/**
 * Schema for reward query
 */
export const rewardQuerySchema: ValidationSchema = {
  poolId: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  }
};

/**
 * Schema for withdrawing SPL tokens
 */
export const withdrawSplSchema: ValidationSchema = {
  poolId: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  amount: {
    required: true,
    rules: [ValidationRules.isNumber(), ValidationRules.min(0.000001)] // must be > 0
  }
};

/**
 * Schema for withdrawing SOL
 */
export const withdrawSolSchema: ValidationSchema = {
  poolId: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  amount: {
    required: true,
    rules: [ValidationRules.isNumber(), ValidationRules.min(0.000001)] // must be > 0
  }
};
