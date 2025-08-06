import rateLimit from 'express-rate-limit';

// Rate limit for general API endpoints
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit for withdrawal operations (more restrictive)
export const withdrawalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 withdrawal requests per windowMs
  message: {
    error: 'Too many withdrawal requests from this IP, please try again later.',
    code: 'WITHDRAWAL_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit for task completion (moderate)
export const taskCompletionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 task completion requests per windowMs
  message: {
    error: 'Too many task completion requests from this IP, please try again later.',
    code: 'TASK_COMPLETION_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit for monitoring endpoints (less restrictive)
export const monitoringLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 monitoring requests per windowMs
  message: {
    error: 'Too many monitoring requests from this IP, please try again later.',
    code: 'MONITORING_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit for admin operations (very restrictive)
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 admin requests per windowMs
  message: {
    error: 'Too many admin requests from this IP, please try again later.',
    code: 'ADMIN_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Custom rate limiter for specific endpoints
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