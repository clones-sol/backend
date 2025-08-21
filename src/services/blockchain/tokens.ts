export interface TokenInfo {
    name: string;
    decimals: number;
    contractAddress: {
        development: string;
        test: string;
        production: string;
    };
}

export interface TokenConfig {
    [symbol: string]: TokenInfo;
}

// Sentinel address for ETH
export const ethAddressSentinel = '0x0000000000000000000000000000000000000000';

export const supportedTokens: TokenConfig = {
    USDC: {
        name: 'USDC',
        decimals: 6,
        contractAddress: {
            development: '0xaf33add7918f685b2a82c1077bd8c07d220ffa04',
            test: '0xaf33add7918f685b2a82c1077bd8c07d220ffa04',
            production: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
        }
    },
    CLONES: {
        name: 'Clones',
        decimals: 18,
        contractAddress: {
            development: '0x917D31589198d61b6BE2Aa2ee03965cF5102380C',
            test: '0x917D31589198d61b6BE2Aa2ee03965cF5102380C',
            production: '0xToBeAdded'
        }
    },
    ETH: {
        name: 'ETH (Base)',
        decimals: 18,
        contractAddress: {
            development: ethAddressSentinel,
            test: ethAddressSentinel,
            production: ethAddressSentinel
        }
    }
};

/**
 * Retrieves the mint address for a given token symbol based on the current environment.
 * @param symbol The token symbol (e.g., 'USDC', 'CLONES').
 * @returns The mint address for the token in the current environment.
 * @throws If the token is not supported or not configured for the current environment.
 */
export function getTokenContractAddress(symbol: string): string {
    const env = process.env.NODE_ENV || 'development';
    const token = supportedTokens[symbol];

    if (!token) {
        throw new Error(`Token with symbol ${symbol} is not supported.`);
    }

    const address = token.contractAddress[env as keyof typeof token.contractAddress];

    if (!address) {
        throw new Error(`Contract address for token ${symbol} is not configured for environment ${env}.`);
    }

    return address;
}

/**
 * Retrieves the configuration for a given token symbol.
 * @param symbol The token symbol.
 * @returns The full configuration object for the token.
 * @throws If the token is not supported.
 */
export function getTokenInfo(symbol: string): TokenInfo {
    const token = supportedTokens[symbol];
    if (!token) {
        throw new Error(`Token with symbol ${symbol} is not supported.`);
    }
    return token;
}

/**
 * Returns an array of supported token symbols.
 * @returns An array of strings representing the supported token symbols.
 */
export function getSupportedTokenSymbols(): string[] {
    return Object.keys(supportedTokens);
} 