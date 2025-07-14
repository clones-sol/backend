import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
} from '@solana/web3.js';
import {
    createAssociatedTokenAccountInstruction,
    createInitializeMintInstruction,
    createMintToInstruction,
    getAssociatedTokenAddressSync,
    getMinimumBalanceForRentExemptMint,
    MINT_SIZE,
    TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

/**
 * Creates an unsigned transaction to create a new SPL token, create the
 * associated token account for the payer, and mint the total supply to it.
 *
 * @param connection - The Solana connection instance.
 * @param payer - The public key of the account that will pay for fees and own the tokens.
 * @param tokenSupply - The total raw supply of the new token (ignoring decimals).
 * @param tokenDecimals - The number of decimal places for the token.
 * @returns An object containing the unsigned transaction and the keypair for the new mint account.
 */
export const createTokenCreationTransaction = async (
    connection: Connection,
    payer: PublicKey,
    tokenSupply: number,
    tokenDecimals: number
): Promise<{ transaction: Transaction; mintKeypair: Keypair }> => {
    // 1. Generate a new keypair for the mint account
    const mintKeypair = Keypair.generate();

    // 2. Calculate the rent-exempt minimum balance for the mint account
    const lamportsForMint = await getMinimumBalanceForRentExemptMint(connection);

    // 3. Get the payer's associated token account address.
    const associatedTokenAddress = getAssociatedTokenAddressSync(
        mintKeypair.publicKey,
        payer
    );

    // 4. Create the transaction with all necessary instructions
    const transaction = new Transaction().add(
        // Instruction to create a new account for the mint
        SystemProgram.createAccount({
            fromPubkey: payer,
            newAccountPubkey: mintKeypair.publicKey,
            space: MINT_SIZE,
            lamports: lamportsForMint,
            programId: TOKEN_PROGRAM_ID,
        }),
        // Instruction to initialize the mint
        createInitializeMintInstruction(
            mintKeypair.publicKey,
            tokenDecimals,
            payer,
            payer // Freeze authority
        ),
        // Instruction to create the Associated Token Account (ATA) for the payer
        createAssociatedTokenAccountInstruction(
            payer,
            associatedTokenAddress,
            payer,
            mintKeypair.publicKey
        ),
        // Instruction to mint the total supply to the payer's ATA
        createMintToInstruction(
            mintKeypair.publicKey,
            associatedTokenAddress,
            payer, // Mint authority
            BigInt(tokenSupply * Math.pow(10, tokenDecimals)) // Amount, converted to BigInt
        )
    );

    return { transaction, mintKeypair };
}; 