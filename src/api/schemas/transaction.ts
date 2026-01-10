import { ValidationRules, type ValidationSchema } from '../../middleware/validator.ts'

export const validateTransactionSchema: ValidationSchema = {
  type: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.isIn(['createFactory', 'fundPool', 'claimRewards', 'createAndFundPool', 'withdrawPool', 'createDataset'])
    ]
  },
  sessionToken: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  userAddress: {
    required: false,
    rules: [ValidationRules.isString(), ValidationRules.isEVMAddress()]
  },
  creator: {
    required: false,
    rules: [ValidationRules.isString(), ValidationRules.isEVMAddress()]
  },
  token: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  amount: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  poolAddress: {
    required: false,
    rules: [ValidationRules.isString(), ValidationRules.isEVMAddress()]
  },
  timestamp: {
    required: true,
    rules: [ValidationRules.isNumber()]
  },
  submissionId: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  farmerReferrer: {
    required: false,
    rules: [ValidationRules.isString(), ValidationRules.isEVMAddress()]
  },
  factoryReferrer: {
    required: false,
    rules: [ValidationRules.isString(), ValidationRules.isEVMAddress()]
  }
}

export const estimateGasSchema: ValidationSchema = {
  type: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.isIn(['createFactory', 'fundPool', 'claimRewards', 'createAndFundPool', 'withdrawPool', 'createDataset'])
    ]
  },
  creator: {
    required: false,
    rules: [ValidationRules.isString(), ValidationRules.isEVMAddress()]
  },
  token: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  amount: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  poolAddress: {
    required: false,
    rules: [ValidationRules.isString(), ValidationRules.isEVMAddress()]
  }
}

export const prepareTransactionSchema: ValidationSchema = {
  type: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.isIn(['createFactory', 'fundPool', 'claimRewards', 'createAndFundPool', 'withdrawPool', 'createDataset'])
    ]
  },
  sessionToken: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  creator: {
    required: false,
    rules: [ValidationRules.isString(), ValidationRules.isEVMAddress()]
  },
  token: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  amount: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  poolAddress: {
    required: false,
    rules: [ValidationRules.isString(), ValidationRules.isEVMAddress()]
  },
  submissionId: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  datasetId: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  name: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  symbol: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  burnThresholdPercentage: {
    required: false,
    rules: [ValidationRules.isNumber()]
  }
}

export const transactionStatusSchema: ValidationSchema = {
  sessionId: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  }
}

export const completeTransactionSchema: ValidationSchema = {
  sessionId: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  status: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.isIn(['completed', 'failed', 'cancelled'])]
  },
  txHash: {
    required: false,
    rules: [ValidationRules.isString()]
  },
  error: {
    required: false,
    rules: [ValidationRules.isString()]
  }
}
