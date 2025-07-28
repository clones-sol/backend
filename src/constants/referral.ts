// MongoDB error codes
export const MONGODB_TRANSACTION_ERROR_CODE = 20;

// Referral code generation constants
export const MAX_REFERRAL_CODE_ATTEMPTS = 100;
export const REFERRAL_CODE_LENGTH = 6;
export const REFERRAL_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // Excluding visually similar characters: O, 0, L, 1, I

// Default configuration values
export const DEFAULT_REFERRAL_CODE_EXPIRY_DAYS = 30;
export const DEFAULT_EXTENSION_DAYS = 30;
export const DEFAULT_CLEANUP_DAYS_THRESHOLD = 7;
export const DEFAULT_OLD_REFERRALS_DAYS = 365;

// Frontend URL fallback
export const DEFAULT_FRONTEND_URL = 'https://clones-ai.com'; 