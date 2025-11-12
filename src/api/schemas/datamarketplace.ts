import { ValidationRules, type ValidationSchema } from '../../middleware/validator.ts'
import { DatasetPhase, DatasetTransactionType } from '../../types/datamarketplace.ts'

/**
 * Schema for getting datasets list
 */
export const getDatasetsSchema: ValidationSchema = {
  page: {
    required: false,
    rules: [
      ValidationRules.isNumber(),
      ValidationRules.min(1),
      ValidationRules.max(1000),
    ]
  },
  limit: {
    required: false,
    rules: [
      ValidationRules.isNumber(),
      ValidationRules.min(1),
      ValidationRules.max(100),
    ]
  },
  filter: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.isIn(['all', 'trending', 'graduated', 'new', 'high-quality'])
    ]
  },
  category: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.maxLength(50)
    ]
  },
  search: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.maxLength(100)
    ]
  }
}

/**
 * Schema for dataset ID parameter
 */
export const datasetIdParamSchema: ValidationSchema = {
  datasetId: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^[a-zA-Z0-9_-]+$/, 'Invalid dataset ID format')
    ]
  }
}

/**
 * Schema for getting dataset transactions query parameters
 */
export const getDatasetTransactionsQuerySchema: ValidationSchema = {
  page: {
    required: false,
    rules: [
      ValidationRules.isNumber(),
      ValidationRules.min(1),
      ValidationRules.max(1000),
    ]
  },
  limit: {
    required: false,
    rules: [
      ValidationRules.isNumber(),
      ValidationRules.min(1),
      ValidationRules.max(100),
    ]
  },
  type: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.isIn(Object.values(DatasetTransactionType))
    ]
  },
  address: {
    required: false,
    rules: [ValidationRules.isEVMAddress()]
  }
}

/**
 * Schema for getting dataset transactions (full schema for backward compatibility)
 */
export const getDatasetTransactionsSchema: ValidationSchema = {
  datasetId: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^[a-zA-Z0-9_-]+$/, 'Invalid dataset ID format')
    ]
  },
  ...getDatasetTransactionsQuerySchema
}

/**
 * Schema for getting dataset holders query parameters
 */
export const getDatasetHoldersQuerySchema: ValidationSchema = {
  limit: {
    required: false,
    rules: [
      ValidationRules.isNumber(),
      ValidationRules.min(1),
      ValidationRules.max(100),
    ]
  }
}

/**
 * Schema for getting dataset holders (full schema for backward compatibility)
 */
export const getDatasetHoldersSchema: ValidationSchema = {
  datasetId: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^[a-zA-Z0-9_-]+$/, 'Invalid dataset ID format')
    ]
  },
  ...getDatasetHoldersQuerySchema
}

/**
 * Schema for getting price history query parameters
 */
export const getPriceHistoryQuerySchema: ValidationSchema = {
  period: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.isIn(['1h', '24h', '7d', '30d'])
    ]
  }
}

/**
 * Schema for getting price history (full schema for backward compatibility)
 */
export const getPriceHistorySchema: ValidationSchema = {
  datasetId: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^[a-zA-Z0-9_-]+$/, 'Invalid dataset ID format')
    ]
  },
  ...getPriceHistoryQuerySchema
}

/**
 * Schema for burn download request
 */
export const burnDownloadSchema: ValidationSchema = {
  datasetId: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^[a-zA-Z0-9_-]+$/, 'Invalid dataset ID format')
    ]
  },
  txHash: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash format')
    ]
  },
  address: {
    required: true,
    rules: [ValidationRules.isEVMAddress()]
  }
}

/**
 * Schema for getting dataset demonstrations query parameters
 */
export const getDatasetDemonstrationsQuerySchema: ValidationSchema = {
  page: {
    required: false,
    rules: [
      ValidationRules.isNumber(),
      ValidationRules.min(1),
      ValidationRules.max(1000)
    ]
  },
  limit: {
    required: false,
    rules: [
      ValidationRules.isNumber(),
      ValidationRules.min(1),
      ValidationRules.max(100)
    ]
  },
  addedBy: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.isIn(['automatic', 'manual'])
    ]
  }
}

/**
 * Schema for getting dataset demonstrations (full schema for backward compatibility)
 */
export const getDatasetDemonstrationsSchema: ValidationSchema = {
  datasetId: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^[a-zA-Z0-9_-]+$/, 'Invalid dataset ID format')
    ]
  },
  ...getDatasetDemonstrationsQuerySchema
}

/**
 * Schema for adding demonstration to dataset body
 */
export const addDemonstrationToDatasetBodySchema: ValidationSchema = {
  demoHash: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^[a-zA-Z0-9_-]+$/, 'Invalid demo hash format')
    ]
  },
  addedBy: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.isIn(['automatic', 'manual'])
    ]
  },
  qualityScore: {
    required: false,
    rules: [
      ValidationRules.isNumber(),
      ValidationRules.min(0),
      ValidationRules.max(100)
    ]
  },
  notes: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.maxLength(500)
    ]
  }
}

/**
 * Schema for adding demonstration to dataset (full schema for backward compatibility)
 */
export const addDemonstrationToDatasetSchema: ValidationSchema = {
  datasetId: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^[a-zA-Z0-9_-]+$/, 'Invalid dataset ID format')
    ]
  },
  ...addDemonstrationToDatasetBodySchema
}

/**
 * Schema for removing demonstration from dataset parameters
 */
export const removeDemonstrationFromDatasetParamsSchema: ValidationSchema = {
  datasetId: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^[a-zA-Z0-9_-]+$/, 'Invalid dataset ID format')
    ]
  },
  demoHash: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^[a-zA-Z0-9_-]+$/, 'Invalid demo hash format')
    ]
  }
}

/**
 * Schema for removing demonstration from dataset (for backward compatibility)
 */
export const removeDemonstrationFromDatasetSchema: ValidationSchema = {
  ...removeDemonstrationFromDatasetParamsSchema
}

/**
 * Schema for creating a new dataset
 */
export const createDatasetSchema: ValidationSchema = {
  name: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.maxLength(100),
      ValidationRules.minLength(1)
    ]
  },
  symbol: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.maxLength(10),
      ValidationRules.minLength(1),
      ValidationRules.matches(/^[A-Z0-9]+$/, 'Symbol must be uppercase alphanumeric')
    ]
  },
  description: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.maxLength(1000)
    ]
  },
  category: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.maxLength(50)
    ]
  },
  demoHashes: {
    required: false,
    rules: [
      ValidationRules.isArray(),
      ValidationRules.customValidator(
        (value) => Array.isArray(value) && value.every(item => typeof item === 'string'),
        'All demo hashes must be strings'
      ),
      ValidationRules.customValidator(
        (value) => Array.isArray(value) && value.every(item => /^[a-zA-Z0-9_-]+$/.test(item)),
        'Invalid demo hash format'
      )
    ]
  },
  burnThresholdPercentage: {
    required: false,
    rules: [
      ValidationRules.isNumber(),
      ValidationRules.min(1),
      ValidationRules.max(10)
    ]
  }
}

/**
 * Schema for updating dataset metadata
 */
export const updateDatasetSchema: ValidationSchema = {
  name: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.maxLength(100),
      ValidationRules.minLength(1)
    ]
  },
  symbol: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.maxLength(10),
      ValidationRules.minLength(1),
      ValidationRules.matches(/^[A-Z0-9]+$/, 'Symbol must be uppercase alphanumeric')
    ]
  },
  description: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.maxLength(1000)
    ]
  },
  category: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.maxLength(50)
    ]
  },
  burnThresholdPercentage: {
    required: false,
    rules: [
      ValidationRules.isNumber(),
      ValidationRules.min(1),
      ValidationRules.max(10)
    ]
  }
}

/**
 * Schema for updating dataset demonstrations
 */
export const updateDatasetDemosSchema: ValidationSchema = {
  demoHashesToAdd: {
    required: false,
    rules: [
      ValidationRules.isArray(),
      ValidationRules.customValidator(
        (value) => Array.isArray(value) && value.every(item => typeof item === 'string'),
        'All demo hashes must be strings'
      ),
      ValidationRules.customValidator(
        (value) => Array.isArray(value) && value.every(item => /^[a-zA-Z0-9_-]+$/.test(item)),
        'Invalid demo hash format'
      )
    ]
  },
  demoHashesToRemove: {
    required: false,
    rules: [
      ValidationRules.isArray(),
      ValidationRules.customValidator(
        (value) => Array.isArray(value) && value.every(item => typeof item === 'string'),
        'All demo hashes must be strings'
      ),
      ValidationRules.customValidator(
        (value) => Array.isArray(value) && value.every(item => /^[a-zA-Z0-9_-]+$/.test(item)),
        'Invalid demo hash format'
      )
    ]
  }
}