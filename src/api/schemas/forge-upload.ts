import { ValidationSchema, ValidationRules } from '../../middleware/validator.ts';

/**
 * Schema for initializing a chunked upload
 */
export const initUploadSchema: ValidationSchema = {
  totalChunks: {
    required: true,
    rules: [
      ValidationRules.isNumber(),
      ValidationRules.min(1),
      ValidationRules.max(1000),
      ValidationRules.isInteger()
    ]
  },
  metadata: {
    required: true,
    rules: [ValidationRules.isObject()]
  }
};

/**
 * Schema for uploading a chunk
 * Note: The actual file is handled by multer middleware
 */
export const uploadChunkSchema: ValidationSchema = {
  chunkIndex: {
    required: true,
    rules: [ValidationRules.isNumber(), ValidationRules.min(0), ValidationRules.isInteger()]
  },
  checksum: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.pattern(/^[a-f0-9]{64}$/i, 'Must be a valid SHA-256 hash (64 hex characters)')
    ]
  }
};

/**
 * Schema for upload ID parameter
 * Used for status, cancel, and complete endpoints
 */
export const uploadIdParamSchema: ValidationSchema = {
  uploadId: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  }
};
