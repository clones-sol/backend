import { describe, it, expect } from 'vitest';
import { ContentFilterService } from './contentFilter.ts';

describe('ContentFilterService', () => {
  describe('isReferralCodeAcceptable', () => {
    it('should accept valid referral codes', async () => {
      const validCodes = [
        'ABCDEF',
        'XYZ789',
        'HEJJO2',
        'WORJD9',
        'GAME42',
        'SUPER7'
      ];

      for (const code of validCodes) {
        const result = await ContentFilterService.isReferralCodeAcceptable(code);
        expect(result, `Code "${code}" should be acceptable`).toBe(true);
      }
    });

    it('should reject blacklisted codes', async () => {
      const blacklistedCodes = [
        'FVCK23',
        'SHGT23',
        'NAZG23',
        'ADMYN2',
        'SYSTEM',
        'TEST23'
      ];

      for (const code of blacklistedCodes) {
        const result = await ContentFilterService.isReferralCodeAcceptable(code);
        expect(result, `Code "${code}" should be rejected`).toBe(false);
      }
    });

    it('should reject codes with suspicious patterns', async () => {
      const suspiciousCodes = [
        '234567', // All digits
        'AAAAAA', // Same character repeated (invalid char 'A', but pattern is generic)
        'ABABAB', // Pattern repeated (invalid char 'A', 'B', but pattern is generic)
        '765432', // Sequential
        'AB3456'  // Official-looking format (invalid chars)
      ];

      for (const code of suspiciousCodes) {
        const result = await ContentFilterService.isReferralCodeAcceptable(code);
        expect(result, `Code "${code}" should be rejected as suspicious`).toBe(false);
      }
    });

    it('should reject codes with offensive substrings', async () => {
      const offensiveCodes = [
        'BADBOY', // Contains 'BAD'
        'SADBOY'  // Contains 'SAD'
      ];

      for (const code of offensiveCodes) {
        const result = await ContentFilterService.isReferralCodeAcceptable(code);
        expect(result, `Code "${code}" should be rejected for offensive content`).toBe(false);
      }
    });

    it('should reject codes with phonetic offenses', async () => {
      const phoneticCodes = [
        'F3CK23', // FECK
        'SH7E23', // SHTE
        'D37H23'  // DETH
      ];

      for (const code of phoneticCodes) {
        const result = await ContentFilterService.isReferralCodeAcceptable(code);
        expect(result, `Code "${code}" should be rejected for phonetic offense`).toBe(false);
      }
    });

    it('should handle invalid inputs gracefully', async () => {
      const invalidInputs = [
        null,
        undefined,
        '',
        123,
        {},
        []
      ];

      for (const input of invalidInputs) {
        const result = await ContentFilterService.isReferralCodeAcceptable(input as any);
        expect(result, `Invalid input "${input}" should be rejected`).toBe(false);
      }
    });
  });

  describe('generateAlternativeCodes', () => {
    it('should generate acceptable alternative codes', async () => {
      const alternatives = await ContentFilterService.generateAlternativeCodes('BADCDE', 3);

      expect(alternatives).toHaveLength(3);

      for (const code of alternatives) {
        expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
        const isAcceptable = await ContentFilterService.isReferralCodeAcceptable(code);
        expect(isAcceptable, `Generated code "${code}" should be acceptable`).toBe(true);
      }
    });

    it('should generate unique codes', async () => {
      const alternatives = await ContentFilterService.generateAlternativeCodes('BADCDE', 5);
      const uniqueCodes = new Set(alternatives);

      expect(uniqueCodes.size).toBe(alternatives.length);
    });
  });

  describe('sanitizeInput', () => {
    it('should remove dangerous HTML/XML characters', () => {
      const testCases = [
        { input: '<script>alert("xss")</script>', expected: 'scriptalert(xss)/script' },
        { input: 'Hello & World', expected: 'Hello  World' },
        { input: 'Test"quote\'test', expected: 'Testquotetest' },
        { input: 'Normal text', expected: 'Normal text' },
        { input: '   spaces   ', expected: 'spaces' }
      ];

      for (const testCase of testCases) {
        const result = ContentFilterService.sanitizeInput(testCase.input);
        expect(result).toBe(testCase.expected);
      }
    });

    it('should remove control characters', () => {
      const inputWithControlChars = 'Hello\x00\x1F\x7FWorld';
      const result = ContentFilterService.sanitizeInput(inputWithControlChars);
      expect(result).toBe('HelloWorld');
    });

    it('should limit the length of the string', () => {
      const longString = 'a'.repeat(2000);
      const result = ContentFilterService.sanitizeInput(longString);
      expect(result.length).toBe(1000);
    });

    it('should handle non-string inputs', () => {
      const nonStringInputs = [null, undefined, 123, {}, []];

      for (const input of nonStringInputs) {
        const result = ContentFilterService.sanitizeInput(input as any);
        expect(result).toBe('');
      }
    });
  });

  describe('isValidIdentifier', () => {
    it('should accept valid identifiers', () => {
      const validIdentifiers = [
        'user123',
        'my_account',
        'player-one',
        'testUser',
        'a1',
        'validName123'
      ];

      for (const identifier of validIdentifiers) {
        const result = ContentFilterService.isValidIdentifier(identifier);
        expect(result, `Identifier "${identifier}" should be valid`).toBe(true);
      }
    });

    it('should reject invalid identifiers', () => {
      const invalidIdentifiers = [
        'a', // Too short
        '1user', // Starts with number
        '_user', // Starts with underscore
        '-user', // Starts with hyphen
        'user@domain', // Invalid character
        'user.name', // Invalid character
        'user space', // Contains space
        'a'.repeat(100), // Too long
        '', // Empty
        'special!char' // Special character
      ];

      for (const identifier of invalidIdentifiers) {
        const result = ContentFilterService.isValidIdentifier(identifier);
        expect(result, `Identifier "${identifier}" should be invalid`).toBe(false);
      }
    });

    it('should handle non-string inputs for identifiers', () => {
      const nonStringInputs = [null, undefined, 123, {}, []];

      for (const input of nonStringInputs) {
        const result = ContentFilterService.isValidIdentifier(input as any);
        expect(result).toBe(false);
      }
    });
  });

  describe('blacklist management', () => {
    it('should add and remove codes from the blacklist', async () => {
      const testCode = 'TESTBD';

      // Initially should be acceptable
      expect(await ContentFilterService.isReferralCodeAcceptable(testCode)).toBe(true);

      // Add to blacklist
      ContentFilterService.addToBlacklist(testCode);
      expect(await ContentFilterService.isReferralCodeAcceptable(testCode)).toBe(false);

      // Remove from blacklist
      ContentFilterService.removeFromBlacklist(testCode);
      expect(await ContentFilterService.isReferralCodeAcceptable(testCode)).toBe(true);
    });

    it('should handle case-insensitive blacklist operations', async () => {
      const testCode = 'testjw';

      ContentFilterService.addToBlacklist(testCode.toLowerCase());
      expect(await ContentFilterService.isReferralCodeAcceptable(testCode.toUpperCase())).toBe(false);

      ContentFilterService.removeFromBlacklist(testCode.toUpperCase());
      expect(await ContentFilterService.isReferralCodeAcceptable(testCode.toLowerCase())).toBe(true);
    });

    it('should correctly track the blacklist size', () => {
      const initialSize = ContentFilterService.getBlacklistSize();

      ContentFilterService.addToBlacklist('NEWBDS');
      expect(ContentFilterService.getBlacklistSize()).toBe(initialSize + 1);

      ContentFilterService.removeFromBlacklist('NEWBDS');
      expect(ContentFilterService.getBlacklistSize()).toBe(initialSize);
    });
  });
});
