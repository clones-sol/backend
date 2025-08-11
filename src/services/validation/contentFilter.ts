/**
 * Content filtering service to prevent offensive or inappropriate referral codes.
 */

import { REFERRAL_CODE_CHARS, REFERRAL_CODE_LENGTH } from '../../constants/referral.ts';

// A list of forbidden codes. This should be expanded based on your needs.
// Note: All codes must be possible with the character set: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const BLACKLISTED_CODES = new Set([
  // Common offensive words (examples using allowed chars)
  'FVCK23', 'SHGT23', 'DAMN23', 'HECK23',
  'NAZG23', 'HATE23', 'KYLL23', 'DEAD23',

  // Words that could be confused with brands
  'GGOGLE', 'APPJLE', 'MYCRSF', 'AMZNWS',

  // Reserved system-related codes
  'ADMYN2', 'SYSTEM', 'RROOT2', 'NUJJ23',
  'TEST23', 'DEBUG2', 'ERRR23', 'HACK23',

  // Potentially misleading codes
  'FREE23', 'WYN234', 'BNUS23', 'GYFT23',
  'MNEY23', 'CASH23', 'PRZE23', 'LUCKY2'
]);

// Suspicious patterns (regex)
const SUSPICIOUS_PATTERNS = [
  /^[2-9]{6}$/, // Digits only (can be confused with PIN codes)
  /^(.)\1{5}$/, // Same character repeated 6 times (e.g., AAAAAA)
  /^(..)\1{2}$/, // Pattern repeated 3 times (e.g., ABABAB)
  /^234567|765432$/, // Obvious sequences
  /^[A-Z]{2}[2-9]{4}$/, // Format resembling official codes (e.g., AB1234)
];

// Substrings to avoid
const AVOID_SUBSTRINGS = [
  'SEX', 'XXX', 'ASS', 'DYE', 'WAR', 'GVN',
  'BAD', 'MAD', 'SAD', 'CRY', 'JYE', 'SYN'
];

export class ContentFilterService {
  /**
   * Checks if a referral code is acceptable.
   * @param code The referral code to check.
   * @returns True if the code is acceptable, false otherwise.
   */
  static async isReferralCodeAcceptable(code: string): Promise<boolean> {
    if (!code || typeof code !== 'string') {
      return false;
    }

    const upperCode = code.toUpperCase();

    // Direct blacklist check
    if (BLACKLISTED_CODES.has(upperCode)) {
      return false;
    }

    // Check for suspicious patterns
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(upperCode)) {
        return false;
      }
    }

    // Check for substrings to avoid
    for (const substring of AVOID_SUBSTRINGS) {
      if (upperCode.includes(substring)) {
        return false;
      }
    }

    // Check for phonetic similarity to offensive words
    if (this.containsPhoneticOffense(upperCode)) {
      return false;
    }

    return true;
  }

  /**
   * Detects offensive words with character substitution.
   * @param code The code to check.
   * @returns True if a phonetic offense is found.
   */
  private static containsPhoneticOffense(code: string): boolean {
    // Common replacements: 3->E, 5->S, 7->T, 4->A, 8->B
    const phoneticCode = code
      .replace(/3/g, 'E')
      .replace(/5/g, 'S')
      .replace(/7/g, 'T')
      .replace(/4/g, 'A')
      .replace(/8/g, 'B');

    // List of phonetic offensive words
    const phoneticOffenses = [
      'FECK', 'SHTE', 'HEYL', 'KYLL', 'DETH'
    ];

    return phoneticOffenses.some(offense => phoneticCode.includes(offense));
  }

  /**
   * Generates alternative code suggestions if the original is unacceptable.
   * @param originalCode The original (unacceptable) code.
   * @param count The number of alternatives to generate.
   * @returns An array of acceptable alternative codes.
   */
  static async generateAlternativeCodes(originalCode: string, count: number = 3): Promise<string[]> {
    const alternatives: string[] = [];

    for (let i = 0; i < count; i++) {
      let newCode = '';
      for (let j = 0; j < REFERRAL_CODE_LENGTH; j++) {
        newCode += REFERRAL_CODE_CHARS.charAt(Math.floor(Math.random() * REFERRAL_CODE_CHARS.length));
      }

      if (await this.isReferralCodeAcceptable(newCode)) {
        alternatives.push(newCode);
      } else {
        i--; // Retry if generated code is not acceptable
      }
    }

    return alternatives;
  }

  /**
   * Validates and sanitizes a string input.
   * @param input The string to sanitize.
   * @returns The sanitized string.
   */
  static sanitizeInput(input: string): string {
    if (typeof input !== 'string') {
      return '';
    }

    return input
      // Remove control characters
      .replace(/[\x00-\x1F\x7F]/g, '')
      // Remove dangerous HTML/XML characters
      .replace(/[<>\"'&]/g, '')
      // Remove suspicious Unicode characters (e.g., zero-width spaces)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      // Limit length to prevent payload attacks
      .substring(0, 1000)
      // Trim whitespace
      .trim();
  }

  /**
   * Validates a username or identifier.
   * @param identifier The identifier to validate.
   * @returns True if the identifier is valid.
   */
  static isValidIdentifier(identifier: string): boolean {
    if (!identifier || typeof identifier !== 'string') {
      return false;
    }

    // Check for acceptable length
    if (identifier.length < 2 || identifier.length > 50) {
      return false;
    }

    // Check for acceptable format (letters, numbers, underscore, hyphen)
    if (!/^[a-zA-Z0-9_-]+$/.test(identifier)) {
      return false;
    }

    // Must not start with a number or special character
    if (!/^[a-zA-Z]/.test(identifier)) {
      return false;
    }

    return true;
  }

  /**
   * Adds a code to the blacklist (for admin use).
   * @param code The code to add.
   */
  static addToBlacklist(code: string): void {
    if (code && typeof code === 'string') {
      BLACKLISTED_CODES.add(code.toUpperCase());
    }
  }

  /**
   * Removes a code from the blacklist (for admin use).
   * @param code The code to remove.
   */
  static removeFromBlacklist(code: string): void {
    if (code && typeof code === 'string') {
      BLACKLISTED_CODES.delete(code.toUpperCase());
    }
  }

  /**
   * Gets the current size of the blacklist.
   * @returns The number of items in the blacklist.
   */
  static getBlacklistSize(): number {
    return BLACKLISTED_CODES.size;
  }
}
