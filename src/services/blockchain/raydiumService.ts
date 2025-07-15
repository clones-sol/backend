import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    VersionedTransaction,
} from '@solana/web3.js';
import {
    CreateCpmmPoolAddress,
    Raydium,
    Token,
    TxVersion,
    UI_DEVNET_PROGRAM_ID,
    getCpmmPdaAmmConfigId,
    type ApiCpmmConfigInfo,
    type Cluster,
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

/**
 * Creates an unsigned transaction for setting up a new Raydium CPMM liquidity pool.
 *
 * @param connection - The Solana connection instance.
 * @param owner - The public key of the user creating the pool. This user will sign and pay for the transaction.
 * @param baseToken - The Token object for the base token (e.g., the newly created agent token).
 * @param quoteToken - The Token object for the quote token (usually WSOL).
 * @param baseTokenAmount - The amount of the base token to add to the liquidity pool.
 * @param quoteTokenAmount - The amount of the quote token (SOL) to add to the liquidity pool.
 * @param cluster - The Solana cluster to use for Raydium.
 * @returns An object containing the unsigned transaction and the keys for the newly created pool.
 */
export const createPoolCreationTransaction = async (
    connection: Connection,
    owner: PublicKey,
    baseToken: Token,
    quoteToken: Token,
    baseTokenAmount: number,
    quoteTokenAmount: number,
    cluster: Cluster = 'devnet'
): Promise<{ transaction: VersionedTransaction; poolKeys: CreateCpmmPoolAddress }> => {

    // Use a constant dummy keypair for Raydium SDK initialization.
    // This is a placeholder to satisfy the SDK's requirement for a Signer,
    // as we are only creating an unsigned transaction for the client to sign.
    const DUMMY_OWNER = Keypair.generate();

    const raydium = await Raydium.load({
        connection,
        owner: DUMMY_OWNER,
        cluster,
    });

    const apiFeeConfigs = await raydium.api.getCpmmConfigs();
    const feeConfigs = apiFeeConfigs.map((config: ApiCpmmConfigInfo) => ({
        ...config,
        id: getCpmmPdaAmmConfigId(UI_DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM, config.index).publicKey.toBase58(),
    }));

    if (feeConfigs.length === 0) {
        throw new Error('Failed to fetch any Raydium CPMM fee configurations. Cannot proceed with pool creation.');
    }

    const feeConfig = feeConfigs[0];

    const baseAmount = new BN(baseTokenAmount).mul(new BN(10).pow(new BN(baseToken.decimals)));
    const quoteAmount = new BN(quoteTokenAmount).mul(new BN(10).pow(new BN(quoteToken.decimals)));

    const { transaction, extInfo } = await raydium.cpmm.createPool({
        programId: UI_DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
        poolFeeAccount: UI_DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC,
        // Hardcode the standard TOKEN_PROGRAM_ID for SPL mints.
        mintA: { address: baseToken.mint.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(), decimals: baseToken.decimals },
        mintB: { address: quoteToken.mint.toBase58(), programId: TOKEN_PROGRAM_ID.toBase58(), decimals: quoteToken.decimals },
        mintAAmount: baseAmount,
        mintBAmount: quoteAmount,
        startTime: new BN(0),
        feeConfig: feeConfig,
        associatedOnly: false,
        ownerInfo: {
            feePayer: owner,
            useSOLBalance: true,
        },
        txVersion: TxVersion.V0,
    });

    return {
        transaction,
        poolKeys: extInfo.address,
    };
}; 