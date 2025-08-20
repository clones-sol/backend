import { ethers } from "ethers";

// --- Minimal ABIs ---
const ERC20_ABI = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function decimals() view returns (uint8)"
];

const UNISWAP_V2_FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) view returns (address)",
    "function createPair(address tokenA, address tokenB) returns (address)"
];

const UNISWAP_V2_ROUTER_ABI = [
    "function addLiquidity(address tokenA,address tokenB,uint amountADesired,uint amountBDesired,uint amountAMin,uint amountBMin,address to,uint deadline) returns (uint amountA,uint amountB,uint liquidity)",
    "function addLiquidityETH(address token,uint amountTokenDesired,uint amountTokenMin,uint amountETHMin,address to,uint deadline) payable returns (uint amountToken,uint amountETH,uint liquidity)",
    "function WETH() view returns (address)"
];

export type UnsignedTx = ethers.TransactionRequest;

export interface AmmContracts {
    factory: string; // UniswapV2Factory address
    router: string;  // UniswapV2Router address
}

/**
 * Ensures a pair exists on a Uniswap-v2-like AMM.
 * If missing, returns an unsigned tx to create it; otherwise null.
 */
export async function buildCreatePairIfMissingTx(
    provider: ethers.JsonRpcProvider,
    amm: AmmContracts,
    tokenA: string,
    tokenB: string,
    from: string
): Promise<{ pair: string | null; tx: UnsignedTx | null }> {
    const factory = new ethers.Contract(amm.factory, UNISWAP_V2_FACTORY_ABI, provider);

    // Canonical ordering to avoid duplicates
    const [t0, t1] = tokenA.toLowerCase() < tokenB.toLowerCase()
        ? [tokenA, tokenB]
        : [tokenB, tokenA];

    const existingPair: string = await factory.getPair(t0, t1);
    if (existingPair && existingPair !== ethers.ZeroAddress) {
        return { pair: existingPair, tx: null };
    }

    // Populate unsigned tx for createPair
    const data = factory.interface.encodeFunctionData("createPair", [t0, t1]);

    const nonce = await provider.getTransactionCount(from);
    const fee = await provider.getFeeData();

    const tx: UnsignedTx = {
        to: amm.factory,
        from,
        data,
        nonce
    };

    const est = await provider.estimateGas(tx).catch(() => null);
    if (est) tx.gasLimit = (est * 1200n) / 1000n;

    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
        tx.maxFeePerGas = fee.maxFeePerGas;
        tx.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
    } else if (fee.gasPrice) {
        tx.gasPrice = fee.gasPrice;
    }

    return { pair: null, tx };
}

/**
 * Builds unsigned approval tx if current allowance is insufficient.
 * Returns null if existing allowance already covers requiredAmount.
 */
export async function buildApproveIfNeededTx(
    provider: ethers.JsonRpcProvider,
    token: string,
    owner: string,
    spender: string,
    requiredAmount: bigint
): Promise<UnsignedTx | null> {
    const erc20 = new ethers.Contract(token, ERC20_ABI, provider);
    const current: bigint = await erc20.allowance(owner, spender);
    if (current >= requiredAmount) return null;

    const data = erc20.interface.encodeFunctionData("approve", [spender, requiredAmount]);

    const nonce = await provider.getTransactionCount(owner);
    const fee = await provider.getFeeData();

    const tx: UnsignedTx = { to: token, from: owner, data, nonce };

    const est = await provider.estimateGas(tx).catch(() => null);
    if (est) tx.gasLimit = (est * 1200n) / 1000n;

    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
        tx.maxFeePerGas = fee.maxFeePerGas;
        tx.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
    } else if (fee.gasPrice) {
        tx.gasPrice = fee.gasPrice;
    }

    return tx;
}

/**
 * Builds an unsigned addLiquidity tx for a Uniswap-v2-like Router.
 * amounts are in human units; slippageMin are human units (converted using decimals).
 */
export async function buildAddLiquidityTx(
    provider: ethers.JsonRpcProvider,
    amm: AmmContracts,
    tokenA: string,
    tokenB: string,
    amountADesired: number,
    amountBDesired: number,
    amountAMin: number,
    amountBMin: number,
    to: string,
    deadlineSecondsFromNow: number = 1200 // 20 minutes
): Promise<UnsignedTx> {
    const router = new ethers.Contract(amm.router, UNISWAP_V2_ROUTER_ABI, provider);

    const [decA, decB] = await Promise.all([
        new ethers.Contract(tokenA, ERC20_ABI, provider).decimals(),
        new ethers.Contract(tokenB, ERC20_ABI, provider).decimals()
    ]);

    const aDesired = ethers.parseUnits(amountADesired.toString(), decA);
    const bDesired = ethers.parseUnits(amountBDesired.toString(), decB);
    const aMin = ethers.parseUnits(amountAMin.toString(), decA);
    const bMin = ethers.parseUnits(amountBMin.toString(), decB);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSecondsFromNow);

    const data = router.interface.encodeFunctionData("addLiquidity", [
        tokenA,
        tokenB,
        aDesired,
        bDesired,
        aMin,
        bMin,
        to,
        deadline
    ]);

    const nonce = await provider.getTransactionCount(to);
    const fee = await provider.getFeeData();

    const tx: UnsignedTx = {
        to: amm.router,
        from: to,
        data,
        nonce
    };

    const est = await provider.estimateGas(tx).catch(() => null);
    if (est) tx.gasLimit = (est * 1200n) / 1000n;

    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
        tx.maxFeePerGas = fee.maxFeePerGas;
        tx.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
    } else if (fee.gasPrice) {
        tx.gasPrice = fee.gasPrice;
    }

    return tx;
}

/**
 * Adds liquidity where the quote asset is native ETH (WETH under the hood).
 * Sends ETH as `value` and uses `addLiquidityETH`.
 */
export async function buildAddLiquidityEthTx(
    provider: ethers.JsonRpcProvider,
    amm: AmmContracts,
    token: string,           // ERC-20 token
    tokenAmountDesired: number,
    tokenAmountMin: number,
    ethAmountDesired: number,
    ethAmountMin: number,
    to: string,
    deadlineSecondsFromNow: number = 1200
): Promise<UnsignedTx> {
    const router = new ethers.Contract(amm.router, UNISWAP_V2_ROUTER_ABI, provider);

    const dec = await new ethers.Contract(token, ERC20_ABI, provider).decimals();
    const tDesired = ethers.parseUnits(tokenAmountDesired.toString(), dec);
    const tMin = ethers.parseUnits(tokenAmountMin.toString(), dec);
    const eDesired = ethers.parseEther(ethAmountDesired.toString());
    const eMin = ethers.parseEther(ethAmountMin.toString());
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSecondsFromNow);

    const data = router.interface.encodeFunctionData("addLiquidityETH", [
        token,
        tDesired,
        tMin,
        eMin,
        to,
        deadline
    ]);

    const nonce = await provider.getTransactionCount(to);
    const fee = await provider.getFeeData();

    const tx: UnsignedTx = {
        to: amm.router,
        from: to,
        data,
        value: eDesired,
        nonce
    };

    const est = await provider.estimateGas(tx).catch(() => null);
    if (est) tx.gasLimit = (est * 1200n) / 1000n;

    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
        tx.maxFeePerGas = fee.maxFeePerGas;
        tx.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
    } else if (fee.gasPrice) {
        tx.gasPrice = fee.gasPrice;
    }

    return tx;
}
