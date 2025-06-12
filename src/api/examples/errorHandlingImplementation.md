# Error Handling and Validation Implementation

This document outlines the implementation of error handling and validation middleware across the API routes in the Viralmind backend.

## Overview

The implementation follows a standardized approach to error handling and request validation, ensuring consistent API responses and robust input validation. The key components include:

1. **Validation Schemas**: Defined for each endpoint to validate request parameters, query strings, and request bodies.
2. **Validation Middleware**: Applied to routes to enforce schema validation before request processing.
3. **Error Handling**: Centralized error handling to provide consistent error responses.
4. **Async Error Handling**: Wrapper for async route handlers to catch and process errors properly.

## Implementation Details

### 1. Validation Schemas

Validation schemas are defined for each API route in dedicated files under `backend/src/api/schemas/`:

- `settings.ts`: Schemas for settings-related endpoints
- `gym.ts`: Schemas for gym-related endpoints

Each schema defines the expected fields, whether they are required, and validation rules for each field.

Example schema from `gym.ts`:

```typescript
export const questRequestSchema: ValidationSchema = {
  address: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.pattern(
        /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
        'Must be a valid Solana wallet address'
      )
    ]
  },
  prompt: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.minLength(1)]
  },
  installed_applications: {
    required: false,
    rules: [ValidationRules.isString()]
  }
};
```

### 2. Validation Middleware

The validation middleware is applied to routes using the following functions from `validator.ts`:

- `validateBody`: Validates the request body against a schema
- `validateQuery`: Validates query parameters against a schema
- `validateParams`: Validates route parameters against a schema

Example usage in `gym.ts`:

```typescript
router.post(
  '/quest',
  validateBody(questRequestSchema),
  errorHandlerAsync(async (req: Request, res: Response) => {
    // Route handler code
  })
);
```

### 3. Error Handling

The error handling middleware (`errorHandler.ts`) processes errors and converts them to standardized API responses. It handles:

- API-specific errors (instances of `ApiError`)
- Mongoose validation errors
- MongoDB duplicate key errors
- Mongoose cast errors
- Generic errors

The middleware ensures all errors are returned in a consistent format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {
      // Optional additional error details
    }
  }
}
```

### 4. Async Error Handling

The `errorHandlerAsync` function wraps async route handlers to catch and process errors properly:

```typescript
errorHandlerAsync(async (req: Request, res: Response) => {
  // Async route handler code that might throw errors
})
```

This eliminates the need for try/catch blocks in every route handler.

## Routes Implemented

Error handling and validation have been implemented for the following routes:


1. **Settings API** (`/api/v1/settings`)
   - GET `/`: Get application settings

2. **Gym API** (`/api/v1/gym`)
   - POST `/quest`: Request a quest/hint
   - POST `/progress`: Check quest progress

## Success Response Format

All successful responses now follow a standardized format:

```json
{
  "success": true,
  "data": {
    // Response data specific to the endpoint
  }
}
```

## Best Practices

1. **Always use validation middleware** for all routes to ensure proper input validation.
2. **Use `errorHandlerAsync`** for all async route handlers to properly catch and process errors.
3. **Throw `ApiError` instances** for domain-specific errors with appropriate status codes and error codes.
4. **Keep validation schemas in separate files** organized by resource type.
5. **Return standardized responses** using the `successResponse` function.

## Implementation Challenges

1. **Streaming Responses**: Special handling was required for streaming endpoints (like `/challenge-chat`) where the standard error handling and response format doesn't apply directly.

2. **External API Integration**: Care was taken to properly handle errors from external APIs (like OpenAI) and convert them to standardized API errors.

3. **Blockchain Interactions**: Validation for blockchain-related operations required special attention due to the asynchronous nature and potential for various failure modes.

4. **Type Safety**: Ensuring proper TypeScript typing throughout the validation and error handling process required careful attention to detail.
