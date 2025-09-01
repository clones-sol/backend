import { ethers } from "ethers";
import { tokenCache } from '../../utils/tokenCache.js';

export type Erc20Artifact = {
    abi: any[];
    bytecode: string;
};

/**
 * Creates an unsigned transaction to deploy an ERC-20 token contract
 * and mint the total supply to the payer/owner from the constructor.
 *
 * The target ERC-20 contract should expose a constructor like:
 * constructor(
 *   string memory name,
 *   string memory symbol,
 *   uint8 decimals,
 *   address initialRecipient,
 *   uint256 initialSupply,
 *   address initialOwner
 * )
 *
 * If your contract constructor differs, adjust the args array accordingly.
 *
 * @param provider       An ethers provider for fee estimation.
 * @param payerAddress   The EVM address that will deploy the contract (sender).
 * @param tokenName      ERC-20 name.
 * @param tokenSymbol    ERC-20 symbol.
 * @param tokenSupply    Total supply in human units (not raw units).
 * @param tokenDecimals  Number of decimals (e.g., 18).
 * @param artifact       ABI + bytecode of your ERC-20 implementation.
 * @returns An object containing the unsigned tx request and the expected contract address.
 */
export async function createTokenDeploymentTransaction(
    provider: ethers.JsonRpcProvider,
    payerAddress: string,
    tokenName: string,
    tokenSymbol: string,
    tokenSupply: number,
    tokenDecimals: number,
    artifact: Erc20Artifact
): Promise<{
    unsignedTx: ethers.TransactionRequest;
    expectedContractAddress: string | null;
}> {
    // Prepare constructor args
    const initialRecipient = payerAddress;
    const initialOwner = payerAddress;
    const initialSupplyRaw = ethers.parseUnits(tokenSupply.toString(), tokenDecimals);

    // Build deploy transaction data
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
    const deployTx = await factory.getDeployTransaction(
        tokenName,
        tokenSymbol,
        tokenDecimals,
        initialRecipient,
        initialSupplyRaw,
        initialOwner
    );

    // Attach sender and estimate gas + fees
    const nonce = await provider.getTransactionCount(payerAddress);
    const fee = await provider.getFeeData();

    const unsignedTx: ethers.TransactionRequest = {
        ...deployTx,
        from: payerAddress,
        nonce
    };

    // Gas estimate with a small buffer
    const est = await provider.estimateGas(unsignedTx).catch((err) => {
        console.error("Gas estimation failed for ERC-20 deployment transaction:", err);
        // Fallback: use a reasonable default for contract deployment
        return 3000000n;
    });
    if (est) {
        unsignedTx.gasLimit = (est * 1200n) / 1000n; // +20%
    }

    // EIP-1559 fees with reasonable fallbacks
    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
        unsignedTx.maxFeePerGas = fee.maxFeePerGas;
        unsignedTx.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
    } else if (fee.gasPrice) {
        unsignedTx.gasPrice = fee.gasPrice;
    }

    // Predict contract address (CREATE)
    let expectedContractAddress: string | null = null;
    try {
        expectedContractAddress = ethers.getCreateAddress({
            from: payerAddress,
            nonce
        });
    } catch {
        expectedContractAddress = null;
    }

    return { unsignedTx, expectedContractAddress };
}

/**
 * Creates an unsigned transaction to mint additional ERC-20 tokens
 * to a recipient using the token’s `mint(address,uint256)` method.
 *
 * Your ERC-20 must expose a public `mint` function guarded by owner/roles.
 *
 * @param provider      An ethers provider for on-chain reads and fee estimation.
 * @param tokenAddress  ERC-20 contract address.
 * @param minterAddress Address that will sign/broadcast (must have permission to mint).
 * @param recipient     Recipient of the minted tokens.
 * @param amount        Amount in human units (not raw units).
 * @param artifactAbi   ABI of the ERC-20 (must include `decimals()` and `mint()`).
 * @returns An unsigned tx request ready to be signed and sent.
 */
export async function createMintTransaction(
    provider: ethers.JsonRpcProvider,
    tokenAddress: string,
    minterAddress: string,
    recipient: string,
    amount: number,
    artifactAbi: any[]
): Promise<ethers.TransactionRequest> {
    const erc20 = new ethers.Contract(tokenAddress, artifactAbi, provider);
    const metadata = await tokenCache.getTokenMetadata(tokenAddress, provider);
    const rawAmount = ethers.parseUnits(amount.toString(), metadata.decimals);

    // Populate calldata for mint(recipient, rawAmount)
    const data: string = await erc20.interface.encodeFunctionData("mint", [
        recipient,
        rawAmount
    ]);

    const fee = await provider.getFeeData();
    const nonce = await provider.getTransactionCount(minterAddress);

    const tx: ethers.TransactionRequest = {
        to: tokenAddress,
        from: minterAddress,
        data,
        nonce
    };

    // Estimate gas and add buffer
    const est = await provider.estimateGas(tx).catch(() => null);
    if (est) {
        tx.gasLimit = (est * 1200n) / 1000n; // +20%
    }

    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
        tx.maxFeePerGas = fee.maxFeePerGas;
        tx.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
    } else if (fee.gasPrice) {
        tx.gasPrice = fee.gasPrice;
    }

    return tx;
}
