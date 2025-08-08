import rateLimit from 'express-rate-limit';

// Centralized rate limiter configuration
export const rateLimiterConfig = {
  // General API endpoints
  general: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
      error: 'Too many requests from this IP, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
  }),

  // Withdrawal operations (more restrictive)
  withdrawal: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 withdrawal requests per windowMs
    message: {
      error: 'Too many withdrawal requests from this IP, please try again later.',
      code: 'WITHDRAWAL_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
  }),

  // Task completion (moderate)
  taskCompletion: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // limit each IP to 50 task completion requests per windowMs
    message: {
      error: 'Too many task completion requests from this IP, please try again later.',
      code: 'TASK_COMPLETION_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
  }),

  // Sensitive operations (like referral generation)
  sensitive: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // limit each IP to 20 sensitive requests per windowMs
    message: {
      error: 'Too many sensitive requests from this IP, please try again later.',
      code: 'SENSITIVE_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
  }),

  // Monitoring endpoints (less restrictive)
  monitoring: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // limit each IP to 200 monitoring requests per windowMs
    message: {
      error: 'Too many monitoring requests from this IP, please try again later.',
      code: 'MONITORING_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
  }),

  // Admin operations (very restrictive)
  admin: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 admin requests per windowMs
    message: {
      error: 'Too many admin requests from this IP, please try again later.',
      code: 'ADMIN_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
  }),
};

// Helper function to create custom rate limiters
export const createCustomLimiter = (maxRequests: number, windowMs: number = 15 * 60 * 1000) => {
  return rateLimit({
    windowMs,
    max: maxRequests,
    message: {
      error: `Too many requests from this IP, please try again later.`,
      code: 'CUSTOM_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
};

// Export individual limiters for backward compatibility
export const generalLimiter = rateLimiterConfig.general;
export const withdrawalLimiter = rateLimiterConfig.withdrawal;
export const taskCompletionLimiter = rateLimiterConfig.taskCompletion;
export const sensitiveLimiter = rateLimiterConfig.sensitive;
export const monitoringLimiter = rateLimiterConfig.monitoring;
export const adminLimiter = rateLimiterConfig.admin;
