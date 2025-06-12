# Server Integration Guide

This guide shows how to integrate the standardized API utilities into your Express server.

## 1. Update server.ts

Add the error handling middleware to your server.ts file after all route registrations:

```typescript
// Import the error handler middleware
import { errorHandler } from './api/middleware/errorHandler.ts';

// ... existing imports and app setup ...

// Register routes
app.use('/api/challenges', challengesRoute);
app.use('/api/conversation', conversationRoute);
// ... other routes ...

// Add error handling middleware AFTER all route registrations
app.use(errorHandler);

// ... server startup code ...
```

## 2. Example Route Implementation

Here's how to implement a route using the standardized API utilities:

```typescript
import express from 'express';
import { asyncHandler } from '../middleware/errorHandler.ts';
import { validateBody } from '../middleware/validator.ts';
import { createChallengeSchema } from '../schemas/challenge.ts';
import { ApiError, successResponse } from '../types/errors.ts';
import DatabaseService from '../../services/db/index.ts';

const router = express.Router();

// Create a new challenge
router.post(
  '/',
  validateBody(createChallengeSchema), // Validate request body
  errorHandlerAsync(async (req, res) => {    // Handle async errors
    const { name } = req.body;
    
    // Check if challenge already exists
    const existingChallenge = await DatabaseService.getChallengeByName(name);
    if (existingChallenge) {
      // Use standardized error
      throw ApiError.conflict(`Challenge with name "${name}" already exists`);
    }
    
    // Create challenge
    const challenge = await DatabaseService.createChat(req.body);
    
    // Return standardized success response
    res.status(201).json(successResponse({ challenge }));
  })
);

export { router as challengesRoute };
```

## 3. Response Format

### Success Response

All successful responses will follow this format:

```json
{
  "success": true,
  "data": {
    // Response data specific to the endpoint
  }
}
```

### Error Response

All error responses will follow this format:

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

## 4. Error Handling Best Practices

1. Use the `asyncHandler` wrapper for all async route handlers to avoid try/catch blocks
2. Use the `ApiError` class to throw standardized errors
3. Use validation middleware to validate request data
4. Let the error handling middleware handle the errors

Example:

```typescript
// Good - Using asyncHandler and ApiError
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const item = await DatabaseService.getItemById(id);
    
    if (!item) {
      throw ApiError.notFound(`Item with ID "${id}" not found`);
    }
    
    res.json(successResponse({ item }));
  })
);

// Bad - Using try/catch and manual error responses
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = await DatabaseService.getItemById(id);
    
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }
    
    res.json({ item });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});
```

## 5. Validation Best Practices

1. Create reusable validation schemas for common request types
2. Use the appropriate validation middleware for the request part you want to validate:
   - `validateBody` for request body
   - `validateQuery` for query parameters
   - `validateParams` for route parameters
3. Keep validation schemas in separate files organized by resource type

Example:

```typescript
// schemas/user.ts
export const createUserSchema = {
  email: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.isEmail()
    ]
  },
  password: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.minLength(8),
      ValidationRules.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Must contain at least one lowercase letter, one uppercase letter, and one number')
    ]
  }
};

// routes/user.ts
router.post(
  '/',
  validateBody(createUserSchema),
  asyncHandler(async (req, res) => {
    // Request body is already validated
    const user = await createUser(req.body);
    res.status(201).json(successResponse({ user }));
  })
);
