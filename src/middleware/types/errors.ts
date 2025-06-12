/**
 * Standard error codes for API responses
 */
export enum ErrorCode {
  // Client errors (4xx)
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_WALLET_SIGNATURE = 'INVALID_WALLET_SIGNATURE',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  CONFLICT = 'CONFLICT',
  PAYMENT_REQUIRED = 'PAYMENT_REQUIRED',
  GONE = 'GONE',

  // Server errors (5xx)
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',

  // Domain-specific errors
  INSUFFICIENT_FUNDS = 'INSUFFICIENT_FUNDS',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  CHALLENGE_EXPIRED = 'CHALLENGE_EXPIRED',
  UPLOAD_INCOMPLETE = 'UPLOAD_INCOMPLETE'
}

/**
 * Standard API error class with consistent structure
 */
export class ApiError extends Error {
  statusCode: number;
  code: ErrorCode;
  details?: Record<string, any>;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: Record<string, any>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = 'ApiError';
  }

  /**
   * Create a 400 Bad Request error
   */
  static badRequest(message: string, details?: Record<string, any>) {
    return new ApiError(400, ErrorCode.BAD_REQUEST, message, details);
  }

  /**
   * Create a 401 Unauthorized error
   */
  static unauthorized(message: string = 'Authentication required') {
    return new ApiError(401, ErrorCode.UNAUTHORIZED, message);
  }

  /**
   * Create a 402 Payment Required error
   */
  static paymentRequired(message: string = 'Payment required') {
    return new ApiError(402, ErrorCode.PAYMENT_REQUIRED, message);
  }

  /**
   * Create a 403 Forbidden error
   */
  static forbidden(message: string = 'Access denied') {
    return new ApiError(403, ErrorCode.FORBIDDEN, message);
  }

  /**
   * Create a 404 Not Found error
   */
  static notFound(message: string = 'Resource not found') {
    return new ApiError(404, ErrorCode.NOT_FOUND, message);
  }

  /**
   * Create a 409 Conflict error
   */
  static conflict(message: string = 'Resource conflict', details?: Record<string, any>) {
    return new ApiError(409, ErrorCode.CONFLICT, message, details);
  }

  /**
   * Create a 429 Too Many Requests error
   */
  static rateLimit(message: string = 'Rate limit exceeded') {
    return new ApiError(429, ErrorCode.RATE_LIMIT_EXCEEDED, message);
  }

  /**
   * Create a 500 Internal Server Error
   */
  static internalError(message: string = 'Internal server error') {
    return new ApiError(500, ErrorCode.INTERNAL_SERVER_ERROR, message);
  }

  /**
   * Create a 503 Service Unavailable error
   */
  static serviceUnavailable(message: string = 'Service temporarily unavailable') {
    return new ApiError(503, ErrorCode.SERVICE_UNAVAILABLE, message);
  }

  /**
   * Create a domain-specific insufficient funds error
   */
  static insufficientFunds(message: string = 'Insufficient funds', details?: Record<string, any>) {
    return new ApiError(400, ErrorCode.INSUFFICIENT_FUNDS, message, details);
  }

  /**
   * Create a domain-specific transaction failed error
   */
  static transactionFailed(message: string = 'Transaction failed', details?: Record<string, any>) {
    return new ApiError(400, ErrorCode.TRANSACTION_FAILED, message, details);
  }

  /**
   * Create a domain-specific invalid signature error
   */
  static invalidSignature(
    message: string = 'Invalid wallet signature',
    details?: Record<string, any>
  ) {
    return new ApiError(400, ErrorCode.INVALID_WALLET_SIGNATURE, message, details);
  }

  /**
   * Create a domain-specific challenge expired error
   */
  static challengeExpired(message: string = 'Challenge has expired') {
    return new ApiError(400, ErrorCode.CHALLENGE_EXPIRED, message);
  }

  /**
   * Create a domain-specific upload incomplete error
   */
  static uploadIncomplete(message: string = 'Upload is incomplete', details?: Record<string, any>) {
    return new ApiError(400, ErrorCode.UPLOAD_INCOMPLETE, message, details);
  }

  /**
   * Create a validation error with field-specific details
   */
  static validationError(
    message: string = 'Request validation failed',
    details?: Record<string, any>
  ) {
    return new ApiError(400, ErrorCode.VALIDATION_ERROR, message, details);
  }
}

/**
 * Standard success response format
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: ErrorCode;
    message: string;
    details?: Record<string, any>;
  };
}

/**
 * Create a standardized success response
 */
export function successResponse<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data
  };
}

/**
 * Create a standardized error response
 */
export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: Record<string, any>
): ApiResponse<never> {
  return {
    success: false,
    error: {
      code,
      message,
      details
    }
  };
}
