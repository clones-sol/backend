import { ethers } from "ethers";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

class BlockchainService {
  provider: ethers.JsonRpcProvider;

  constructor(rpcUrl: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
  }

  /** Minimum recommended ETH balance to cover gas */
  static get MIN_ETH_BALANCE(): number {
    return 0.01;
  }

  /** Fetch ETH price in USD from CoinGecko */
  static async getEthPriceInUSD(): Promise<number> {
    const fallback = 3000;
    try {
      const r = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
      );
      const data = await r.json();
      return data?.ethereum?.usd ?? fallback;
    } catch (e) {
      console.error("Error fetching ETH price:", e);
      return fallback;
    }
  }

  /** Get ETH balance for an address (in ETH units) */
  async getEthBalance(walletAddress: string): Promise<number> {
    try {
      const balWei = await this.provider.getBalance(walletAddress);
      return parseFloat(ethers.formatEther(balWei));
    } catch (e) {
      console.error("Error getting ETH balance:", e);
      return 0;
    }
  }

  /** Get ERC-20 balance for an address (adjusted for decimals) */
  async getTokenBalance(tokenAddress: string, walletAddress: string): Promise<number> {
    try {
      const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const [raw, decimals] = await Promise.all([
        erc20.balanceOf(walletAddress),
        erc20.decimals()
      ]);
      return Number(ethers.formatUnits(raw, decimals));
    } catch (e) {
      console.error("Error getting token balance:", e);
      return 0;
    }
  }

  /** Get EIP-1559 fee data (with safe fallbacks) */
  async getFeeData(): Promise<{
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  }> {
    try {
      const fee = await this.provider.getFeeData();
      if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
        return {
          maxFeePerGas: fee.maxFeePerGas,
          maxPriorityFeePerGas: fee.maxPriorityFeePerGas
        };
      }
      if (fee.gasPrice) {
        return {
          maxFeePerGas: fee.gasPrice,
          maxPriorityFeePerGas: fee.gasPrice / 10n
        };
      }
    } catch (e) {
      console.error("Failed to fetch fee data:", e);
    }
    return {
      maxFeePerGas: ethers.parseUnits("0.5", "gwei"),
      maxPriorityFeePerGas: ethers.parseUnits("0.1", "gwei")
    };
  }

  /** Send ETH with retry and fee bumping */
  async transferEth(
    amount: number,
    fromPk: string,
    to: string,
    retryCount: number = 0
  ): Promise<string | false> {
    try {
      const multipliers = [1.0, 1.1, 1.25, 1.5];
      const m = multipliers[retryCount] ?? multipliers[multipliers.length - 1];

      const wallet = new ethers.Wallet(fromPk, this.provider);
      const fee = await this.getFeeData();

      const txReq: ethers.TransactionRequest = {
        to,
        value: ethers.parseEther(amount.toString())
      };

      if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
        txReq.maxPriorityFeePerGas = BigInt(Math.floor(Number(fee.maxPriorityFeePerGas) * m));
        txReq.maxFeePerGas = BigInt(Math.floor(Number(fee.maxFeePerGas) * m));
      }

      const estimated = await this.provider.estimateGas({ ...txReq, from: wallet.address });
      txReq.gasLimit = (estimated * 1200n) / 1000n; // +20% buffer

      const tx = await wallet.sendTransaction(txReq);
      const receipt = await tx.wait();
      console.log("ETH Transfer Success:", receipt?.hash);
      return receipt?.hash ?? tx.hash;
    } catch (error: any) {
      console.error("ETH transfer failed:", { message: error?.message });
      if (retryCount < 3) {
        console.log("Retrying ETH transfer with higher fees...");
        return this.transferEth(amount, fromPk, to, retryCount + 1);
      }
      return false;
    }
  }

  /** Send ERC-20 tokens with retry and fee bumping */
  async transferToken(
    tokenAddress: string,
    amount: number,
    fromPk: string,
    to: string,
    retryCount: number = 0
  ): Promise<{ txHash: string; usedFeeMultiplier: number } | false> {
    try {
      const multipliers = [1.0, 1.1, 1.25, 1.5];
      const m = multipliers[retryCount] ?? multipliers[multipliers.length - 1];

      const wallet = new ethers.Wallet(fromPk, this.provider);
      const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
      const decimals: number = await erc20.decimals();
      const amountBN = ethers.parseUnits(amount.toString(), decimals);

      const fee = await this.getFeeData();
      const overrides: ethers.TransactionRequest = {};

      if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
        overrides.maxPriorityFeePerGas = BigInt(Math.floor(Number(fee.maxPriorityFeePerGas) * m));
        overrides.maxFeePerGas = BigInt(Math.floor(Number(fee.maxFeePerGas) * m));
      }

      const gasEstimate = await erc20.transfer.estimateGas(to, amountBN, overrides);
      overrides.gasLimit = (gasEstimate * 1200n) / 1000n;

      const tx = await erc20.transfer(to, amountBN, overrides);
      const receipt = await tx.wait();

      console.log("ERC-20 Transfer Success:", receipt?.hash);

      return { txHash: receipt?.hash ?? tx.hash, usedFeeMultiplier: m * 100 };
    } catch (error: any) {
      if (typeof error?.message === "string" && /insufficient funds/i.test(error.message)) {
        throw new Error("Insufficient ETH balance for gas.");
      }
      console.error("ERC-20 transfer failed:", { message: error?.message });
      if (retryCount < 3) {
        console.log("Retrying ERC-20 transfer with higher fees...");
        return this.transferToken(tokenAddress, amount, fromPk, to, retryCount + 1);
      }
      return false;
    }
  }
}

export default BlockchainService;