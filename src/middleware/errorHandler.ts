import { Request, Response, NextFunction } from 'express';
import { ApiError, ErrorCode, errorResponse } from './types/errors.ts';

/**
 * Global error handling middleware for Express
 * Converts various error types to standardized API responses
 */
export const errorHandler = (
  err: Error | ApiError,
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(`API Error occurred: ${err.message}`, err);

  // Default error values
  let statusCode = 500;
  let errorCode = ErrorCode.INTERNAL_SERVER_ERROR;
  let message = 'An unexpected error occurred while processing the request';
  let details = {};

  // Handle known error types
  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    errorCode = err.code;
    message = err.message;
    details = err.details || {};
  } else if (err.name === 'ValidationError') {
    // Handle Mongoose validation errors
    statusCode = 400;
    errorCode = ErrorCode.VALIDATION_ERROR;
    message = err.message;

    // Try to extract validation details from Mongoose error
    try {
      const mongooseErr = err as any;
      if (mongooseErr.errors) {
        details = Object.keys(mongooseErr.errors).reduce((acc, field) => {
          acc[field] = mongooseErr.errors[field].message;
          return acc;
        }, {} as Record<string, string>);
      }
    } catch (e) {
      // If extraction fails, just use the error message
      console.error('Failed to extract validation details:', e);
    }
  } else if (err.name === 'MongoServerError' && (err as any).code === 11000) {
    // Handle MongoDB duplicate key errors
    statusCode = 409;
    errorCode = ErrorCode.CONFLICT;
    message = 'A resource with that identifier already exists';

    // Try to extract the duplicate key field
    try {
      const mongoErr = err as any;
      if (mongoErr.keyPattern) {
        details = {
          duplicateKey: Object.keys(mongoErr.keyPattern)[0]
        };
      }
    } catch (e) {
      console.error('Failed to extract duplicate key details:', e);
    }
  } else if (err.name === 'CastError') {
    // Handle Mongoose cast errors (e.g., invalid ObjectId)
    statusCode = 400;
    errorCode = ErrorCode.BAD_REQUEST;
    message = 'Invalid parameter format';

    // Try to extract the field name
    try {
      const castErr = err as any;
      if (castErr.path) {
        details = {
          field: castErr.path,
          value: castErr.value
        };
      }
    } catch (e) {
      console.error('Failed to extract cast error details:', e);
    }
  }

  // Return standardized error response
  res.status(statusCode).json(errorResponse(errorCode, message, details));
};

/**
 * Async handler wrapper to catch errors in async route handlers
 * This eliminates the need for try/catch blocks in every route
 */
export const errorHandlerAsync = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res, next))
      .catch(next);
  };
};
