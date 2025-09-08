import { ValidationRules, type ValidationSchema } from '../../middleware/validator.ts'
import { getSupportedTokenSymbols } from '../../services/blockchain/tokens.ts'
import { ContentFilterService } from '../../services/validation/contentFilter.ts'

/**
 * Schema for wallet connection request
 */
export const connectWalletSchema: ValidationSchema = {
  token: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.minLength(8),
      ValidationRules.maxLength(256),
      ValidationRules.matches(
        /^[a-zA-Z0-9_-]+$/,
        'Token must contain only alphanumeric characters, underscores and hyphens'
      )
    ]
  },
  address: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.isEVMAddress()]
  },
  signature: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^[A-Za-z0-9+/=]+$/, 'Invalid base64 signature format')
    ]
  },
  timestamp: {
    required: false,
    rules: [
      ValidationRules.isNumber(),
      ValidationRules.min(0),
      ValidationRules.customValidator((value: number) => {
        const now = Date.now()
        const fiveMinutesAgo = now - 5 * 60 * 1000
        const oneHourFromNow = now + 60 * 60 * 1000
        return value >= fiveMinutesAgo && value <= oneHourFromNow
      }, 'Timestamp must be within valid time range')
    ]
  },
  referralCode: {
    required: false,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.isReferralCode(),
      ValidationRules.customValidator(
        async (value: string) => await ContentFilterService.isReferralCodeAcceptable(value),
        'Referral code contains inappropriate content'
      )
    ]
  }
}

/**
 * Schema for checking wallet connection
 */
export const checkConnectionSchema: ValidationSchema = {
  token: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.minLength(8),
      ValidationRules.maxLength(256)
    ]
  }
}

export const getBalanceSchema: ValidationSchema = {
  symbol: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^[A-Z]{2,10}$/, 'Symbol must be 2-10 uppercase letters'),
      ValidationRules.isIn(getSupportedTokenSymbols(), 'Unsupported token symbol')
    ]
  }
}

export const addressParamSchema: ValidationSchema = {
  address: {
    required: true,
    rules: [ValidationRules.isEVMAddress()]
  }
}

export const getNicknameSchema: ValidationSchema = {
  address: {
    required: true,
    rules: [ValidationRules.isEVMAddress()]
  }
}

export const setNicknameSchema: ValidationSchema = {
  address: {
    required: true,
    rules: [ValidationRules.isEVMAddress()]
  },
  nickname: {
    required: true,
    rules: [ValidationRules.isString(), ValidationRules.maxLength(25)]
  }
}

export const getTokenPriceSchema: ValidationSchema = {
  symbol: {
    required: true,
    rules: [
      ValidationRules.isString(),
      ValidationRules.sanitizeString(),
      ValidationRules.matches(/^[A-Z0-9]{2,10}$/i, 'Symbol must be 2-10 alphanumeric characters')
    ]
  }
}
