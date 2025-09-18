export interface TokenInfo {
  name: string
  decimals: number
  contractAddress: {
    development: string
    test: string
    production: string
  }
}

export interface TokenConfig {
  [symbol: string]: TokenInfo
}

export const supportedTokens: TokenConfig = {
  USDC: {
    name: 'USDC',
    decimals: 6,
    contractAddress: {
      development: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      test: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      production: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    }
  },
  CLONES: {
    name: 'CLONES',
    decimals: 18,
    contractAddress: {
      development: '0x15eB86c7E54B350bf936d916Df33AEF697202E29',
      test: '0x15eB86c7E54B350bf936d916Df33AEF697202E29',
      production: '0xaadd98ad4660008c917c6fe7286bc54b2eef894d'
    }
  },
  WETH: {
    name: 'WETH (Base)',
    decimals: 18,
    contractAddress: {
      development: '0x4200000000000000000000000000000000000006',
      test: '0x4200000000000000000000000000000000000006',
      production: '0x4200000000000000000000000000000000000006'
    }
  }
}

/**
 * Retrieves the mint address for a given token symbol based on the current environment.
 * @param symbol The token symbol (e.g., 'USDC', 'CLONES').
 * @returns The mint address for the token in the current environment.
 * @throws If the token is not supported or not configured for the current environment.
 */
export function getTokenContractAddress(symbol: string): string {
  const env = process.env.NODE_ENV || 'development'
  const token = supportedTokens[symbol]

  if (!token) {
    throw new Error(`Token with symbol ${symbol} is not supported.`)
  }

  const address = token.contractAddress[env as keyof typeof token.contractAddress]

  if (!address) {
    throw new Error(
      `Contract address for token ${symbol} is not configured for environment ${env}.`
    )
  }

  return address
}

/**
 * Retrieves the configuration for a given token symbol.
 * @param symbol The token symbol.
 * @returns The full configuration object for the token.
 * @throws If the token is not supported.
 */
export function getTokenInfo(symbol: string): TokenInfo {
  const token = supportedTokens[symbol]
  if (!token) {
    throw new Error(`Token with symbol ${symbol} is not supported.`)
  }
  return token
}

/**
 * Returns an array of supported token symbols.
 * @returns An array of strings representing the supported token symbols.
 */
export function getSupportedTokenSymbols(): string[] {
  return Object.keys(supportedTokens)
}
