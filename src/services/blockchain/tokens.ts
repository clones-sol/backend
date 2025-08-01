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
    USDC: {
        name: 'USDC',
        decimals: 6,
        mintAddress: {
            development: 'FvL95gvU2RzrRyQESNzib3VhZtMQVn89BZmV3VpmoxPF',
            test: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            production: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        }
    },
    CLONES: {
        name: 'Clones',
        decimals: 6,
        mintAddress: {
            development: '4fmd25KposhGSi3hFSJP4tWWex2wGWjEQdu14YWTddFV',
            test: '4fmd25KposhGSi3hFSJP4tWWex2wGWjEQdu14YWTddFV',
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