import { describe, expect, it, vi } from 'vitest'
import { ValidationRules, validateObject } from './validator.ts'

describe('Enhanced ValidationRules', () => {
  describe('matches', () => {
    it('should validate regex patterns', async () => {
      const rule = ValidationRules.matches(/^[A-Z]{3}$/)

      expect(await rule.validate('ABC')).toBe(true)
      expect(await rule.validate('abc')).toBe(false)
      expect(await rule.validate('ABCD')).toBe(false)
      expect(await rule.validate('AB')).toBe(false)
      expect(await rule.validate(123)).toBe(false)
    })
  })

  describe('notIn', () => {
    it('should reject values in the forbidden list', async () => {
      const rule = ValidationRules.notIn(['admin', 'root', 'system'])

      expect(await rule.validate('user')).toBe(true)
      expect(await rule.validate('admin')).toBe(false)
      expect(await rule.validate('root')).toBe(false)
      expect(await rule.validate('system')).toBe(false)
    })
  })

  describe('customValidator', () => {
    it('should accept custom validation functions', async () => {
      const rule = ValidationRules.customValidator((value) => value === 'valid', 'Must be valid')

      expect(await rule.validate('valid')).toBe(true)
      expect(await rule.validate('invalid')).toBe(false)
      expect(rule.message).toBe('Must be valid')
    })

    it('should handle async custom validators', async () => {
      const rule = ValidationRules.customValidator(async (value) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return value === 'async-valid'
      }, 'Must be async valid')

      expect(await rule.validate('async-valid')).toBe(true)
      expect(await rule.validate('invalid')).toBe(false)
    })
  })

  describe('sanitizeString', () => {
    it('should sanitize strings', async () => {
      const rule = ValidationRules.sanitizeString()

      const testCases = [
        {
          input: '<script>alert("xss")</script>',
          expected: 'scriptalert(xss)/script'
        },
        { input: 'Hello & World', expected: 'Hello  World' },
        { input: '   spaces   ', expected: 'spaces' },
        { input: 'Normal text', expected: 'Normal text' }
      ]

      for (const testCase of testCases) {
        expect(await rule.validate(testCase.input)).toBe(true)
        if (rule.transform) {
          expect(rule.transform(testCase.input)).toBe(testCase.expected)
        }
      }
    })

    it('should handle non-string inputs', async () => {
      const rule = ValidationRules.sanitizeString()

      expect(await rule.validate(123)).toBe(true)
      if (rule.transform) {
        expect(rule.transform(123)).toBe(123)
      }
    })
  })

  describe('isReferralCode', () => {
    it('should validate referral code format', async () => {
      const rule = ValidationRules.isReferralCode()

      // Valid codes
      expect(await rule.validate('ABCDEF')).toBe(true)
      expect(await rule.validate('XYZ789')).toBe(true)
      expect(await rule.validate('HJKMNP')).toBe(true)

      // Invalid codes
      expect(await rule.validate('abc123')).toBe(false) // lowercase
      expect(await rule.validate('ABC12')).toBe(false) // too short
      expect(await rule.validate('ABC1234')).toBe(false) // too long
      expect(await rule.validate('ABCD2O')).toBe(false) // contains O
      expect(await rule.validate('ABCD2I')).toBe(false) // contains I
      expect(await rule.validate('ABCD2L')).toBe(false) // contains L
      expect(await rule.validate('ABCD20')).toBe(false) // contains 0
      expect(await rule.validate('')).toBe(false) // empty
      expect(await rule.validate(123)).toBe(false) // not string
    })
  })

  describe('enhanced isEVMAddress', () => {
    it('should perform basic format validation first', async () => {
      const rule = ValidationRules.isEVMAddress()

      // Invalid format should fail quickly
      expect(await rule.validate('invalid')).toBe(false)
      expect(await rule.validate('123')).toBe(false)
      expect(await rule.validate('')).toBe(false)
      expect(await rule.validate(null)).toBe(false)
      expect(await rule.validate(123)).toBe(false)
    })

    it('should validate proper EVM address format', async () => {
      const rule = ValidationRules.isEVMAddress()

      // These should pass basic format check (actual validation depends on PublicKey.isOnCurve)
      const validFormatAddresses = [
        '0x66e016f974493F5c1438943FC6A7f3aA896AE77b',
        '0x8a812Ac4CED3e8c82e2Bd64a46E1C4bFF0aD21d9'
      ]

      for (const address of validFormatAddresses) {
        // At minimum, should pass format validation
        expect(await rule.validate(address)).toBe(true)
      }
    })
  })
})

describe('Enhanced validateObject', () => {
  it('should apply transformations correctly', async () => {
    const schema = {
      name: {
        required: true,
        rules: [ValidationRules.isString(), ValidationRules.sanitizeString()]
      },
      code: {
        required: true,
        rules: [ValidationRules.isString(), ValidationRules.isReferralCode()]
      }
    }

    const input = {
      name: '  <script>Test Name</script>  ',
      code: 'ABCDEF'
    }

    const result = await validateObject(input, schema)

    expect(result.valid).toBe(true)
    expect(input.name).toBe('scriptTest Name/script') // Transformed
    expect(input.code).toBe('ABCDEF') // Unchanged
  })

  it('should validate with custom async validators', async () => {
    const schema = {
      username: {
        required: true,
        rules: [
          ValidationRules.isString(),
          ValidationRules.customValidator(async (value) => {
            // Simulate async check (e.g., database lookup)
            await new Promise((resolve) => setTimeout(resolve, 1))
            return !['admin', 'root'].includes(value)
          }, 'Username is reserved')
        ]
      }
    }

    // Valid username
    let result = await validateObject({ username: 'user123' }, schema)
    expect(result.valid).toBe(true)

    // Reserved username
    result = await validateObject({ username: 'admin' }, schema)
    expect(result.valid).toBe(false)
    expect(result.errors.username).toBe('Username is reserved (received: "admin")')
  })

  it('should handle multiple validation rules', async () => {
    const schema = {
      referralCode: {
        required: true,
        rules: [
          ValidationRules.isString(),
          ValidationRules.sanitizeString(),
          ValidationRules.isReferralCode(),
          ValidationRules.notIn(['BANNED', 'ADMIN1']),
          ValidationRules.customValidator((value) => value !== 'CUSTOM', 'Custom validation failed')
        ]
      }
    }

    // Valid code
    let result = await validateObject({ referralCode: 'VAJDV2' }, schema)
    expect(result.valid).toBe(true)

    // Invalid format
    result = await validateObject({ referralCode: 'invalid' }, schema)
    expect(result.valid).toBe(false)

    // Banned code
    result = await validateObject({ referralCode: 'BANNED' }, schema)
    expect(result.valid).toBe(false)

    // Custom validation failure
    result = await validateObject({ referralCode: 'CUSTOM' }, schema)
    expect(result.valid).toBe(false)
    expect(result.errors.referralCode).toBe(
      'Must be a valid 6-character referral code (cannot contain O, 0, I, L) (received: "CUSTOM")'
    )
  })

  it('should stop at first validation error', async () => {
    const mockValidator = vi.fn().mockResolvedValue(false)

    const schema = {
      test: {
        required: true,
        rules: [
          ValidationRules.isString(),
          ValidationRules.customValidator(mockValidator, 'Should not be called')
        ]
      }
    }

    const result = await validateObject({ test: 123 }, schema)

    expect(result.valid).toBe(false)
    expect(result.errors.test).toBe('Must be a string (received: 123)')
    expect(mockValidator).not.toHaveBeenCalled()
  })
})
