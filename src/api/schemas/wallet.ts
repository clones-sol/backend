import { ValidationRules, ValidationSchema } from '../../middleware/validator.ts';
import { ConnectBody } from '../../types/index.ts';

/**
 * Schema for wallet connection request
 */
export const connectWalletSchema: ValidationSchema = {
  token: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  address: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.isSolanaAddress()]
  },
  signature: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  timestamp: {
    required: false,
    rules: [ValidationRules.isNumber(), ValidationRules.min(0)]
  },
  referralCode: {
    required: false,
    rules: [ValidationRules.isString(), ValidationRules.maxLength(20)]
  }
};

/**
 * Schema for checking wallet connection
 */
export const checkConnectionSchema: ValidationSchema = {
  token: {
    required: true,
    rules: [ValidationRules.isString()]
  }
};

export const getBalanceSchema = {
  symbol: { required: true, rules: [ValidationRules.isString()] }
};
