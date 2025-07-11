export interface TokenInfo {
    name: string;
    decimals: number;
    mintAddress: {
        development: string;
        test: string;
        production: string;
    };
}

export interface TokenConfig {
    [symbol: string]: TokenInfo;
}

export const supportedTokens: TokenConfig = {
    VIRAL: {
        name: 'Viral',
        decimals: 6,
        mintAddress: {
            development: 'FndpD76kqsCU7RqPRgu2bdcPCNNAzfFW3x8zFBuejuEG',
            test: 'FndpD76kqsCU7RqPRgu2bdcPCNNAzfFW3x8zFBuejuEG',
            production: 'HW7D5MyYG4Dz2C98axfjVBeLWpsEnofrqy6ZUwqwpump'
        }
    },
    USDC: {
        name: 'USDC',
        decimals: 6,
        mintAddress: {
            development: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            test: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            production: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        }
    },
    CLONES: {
        name: 'Clones',
        decimals: 6,
        mintAddress: {
            development: 'dev-clns-mint-address', // Placeholder
            test: 'test-clns-mint-address', // Placeholder
            production: 'prod-clns-mint-address' // Placeholder
        }
    }
};

/**
 * Retrieves the mint address for a given token symbol based on the current environment.
 * @param symbol The token symbol (e.g., 'USDC', 'CLONES').
 * @returns The mint address for the token in the current environment.
 * @throws If the token is not supported or not configured for the current environment.
 */
export function getTokenAddress(symbol: string): string {
    const env = process.env.NODE_ENV || 'development';
    const token = supportedTokens[symbol];

    if (!token) {
        throw new Error(`Token with symbol ${symbol} is not supported.`);
    }

    const address = token.mintAddress[env as keyof typeof token.mintAddress];

    if (!address) {
        throw new Error(`Mint address for token ${symbol} is not configured for environment ${env}.`);
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