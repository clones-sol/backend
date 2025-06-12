import {
  Connection,
  Transaction,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  ComputeBudgetProgram
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount
} from '@solana/spl-token';
import DatabaseService from '../db/index.ts';
import axios from 'axios';

class BlockchainService {
  connection: Connection;
  programId: string;
  constructor(solanaRpc: string, programId: string) {
    this.connection = new Connection(solanaRpc, 'confirmed');
    this.programId = programId;
  }

  static get MIN_SOL_BALANCE(): number {
    return 0.017;
  }

  static async getSolPriceInUSDT() {
    let defaultSolPrice = 230;

    try {
      const tokenPage = await DatabaseService.getPages({ name: 'viral-token' });
      if (tokenPage && tokenPage[0]?.content?.sol_price) {
        defaultSolPrice = tokenPage[0].content.sol_price;
      }

      try {
        const response = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
        );
        const data = await response.json();
        if (data?.solana?.usd) {
          return data.solana.usd;
        }
        return defaultSolPrice;
      } catch (err) {
        console.error('Error fetching Sol price from CoinGecko:', err);
        return defaultSolPrice;
      }
    } catch (err) {
      console.error('Error fetching token page:', err);
      return defaultSolPrice;
    }
  }

  async getSolBalance(walletAddress: string): Promise<number> {
    try {
      const walletPubkey = new PublicKey(walletAddress);
      const balance = await this.connection.getBalance(walletPubkey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Error getting SOL balance:', error);
      return 0;
    }
  }

  async getTokenBalance(tokenMint: string, walletAddress: string): Promise<number> {
    try {
      // Convert string addresses to PublicKeys
      const mintPubkey = new PublicKey(tokenMint);
      const walletPubkey = new PublicKey(walletAddress);

      // Get the associated token account address
      const tokenAccountAddress = getAssociatedTokenAddressSync(mintPubkey, walletPubkey);

      try {
        // Get the token account info
        const tokenAccountInfo = await this.connection.getTokenAccountBalance(tokenAccountAddress);
        return tokenAccountInfo.value.uiAmount || 0;
      } catch (error) {
        // If the token account doesn't exist, return 0
        // The error message can vary, but it's usually about not finding the account
        if (
          (error as any).message?.includes('could not find') ||
          (error as any).message?.includes('Invalid param') ||
          (error as any).code === -32602
        ) {
          return 0;
        }
        throw error; // Re-throw other errors
      }
    } catch (error) {
      console.error('Error getting token balance:', error);
      return 0;
    }
  }

  async getQuickNodePriorityFees(): Promise<number> {
    try {
      const config = {
        headers: {
          'Content-Type': 'application/json'
        }
      };

      const data = {
        jsonrpc: '2.0',
        id: 1,
        method: 'qn_estimatePriorityFees',
        params: { last_n_blocks: 100, api_version: 2 }
      };

      const response = await axios.post(process.env.RPC_URL!, data, config);

      console.log('QuickNode priority fees response:', response.data);

      // Use QuickNode's recommended fee or fallback to medium priority
      const result = response.data.result;
      // If recommended fee is available, use it, otherwise use medium priority
      return result.recommended || result.per_compute_unit.medium || 500000;
    } catch (error) {
      console.error('Failed to fetch QuickNode priority fees:', error);
      // Return a reasonable default if the API call fails
      return 1_000_000;
    }
  }

  async transferToken(
    tokenMint: string,
    amount: number,
    fromWallet: Keypair,
    toAddress: string,
    retryCount: number = 0
  ): Promise<{ signature: string; usedFeePercentage: number } | false> {
    try {
      const feePercentages = [0.01, 0.1, 0.5, 1.0];
      const currentFeePercentage = feePercentages[retryCount] || 1.0;

      console.log(
        `Attempt ${retryCount + 1} with ${currentFeePercentage * 100}% of base priority fee`
      );

      const sourceAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        fromWallet,
        new PublicKey(tokenMint),
        fromWallet.publicKey
      );

      const destinationAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        fromWallet,
        new PublicKey(tokenMint),
        new PublicKey(toAddress)
      );

      const tokenInfo = await this.connection.getParsedAccountInfo(new PublicKey(tokenMint));
      const decimals = (tokenInfo.value?.data as any).parsed.info.decimals;

      const basePriorityFee = await this.getQuickNodePriorityFees();
      const adjustedPriorityFee = Math.floor(basePriorityFee * currentFeePercentage);

      console.log(`Base priority fee: ${basePriorityFee}, Using: ${adjustedPriorityFee}`);

      const transaction = new Transaction();
      const transferAmount = amount * Math.pow(10, decimals);

      transaction.add(
        createTransferInstruction(
          sourceAccount.address,
          destinationAccount.address,
          fromWallet.publicKey,
          transferAmount
        )
      );

      transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }));
      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: adjustedPriorityFee })
      );

      const latestBlockHash = await this.connection.getLatestBlockhash('confirmed');
      transaction.recentBlockhash = latestBlockHash.blockhash;
      transaction.feePayer = fromWallet.publicKey;

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [fromWallet],
        {
          commitment: 'confirmed',
          maxRetries: 5
        }
      );

      console.log(
        '\x1b[32m',
        `Transaction Success!🎉 (${currentFeePercentage * 100}% fee)`,
        `\n    https://explorer.solana.com/tx/${signature}?cluster=mainnet`
      );

      return {
        signature,
        usedFeePercentage: currentFeePercentage * 100
      };
    } catch (error: any) {
      if (error.message.includes('with insufficient funds for rent')) {
        // account is out of SOL for gas
        throw new Error('Pool SOL balance insufficient for gas.');
      }
      console.error('\x1b[31m', 'Transfer failed:', {
        message: error.message,
        logs: error?.logs
      });

      // Retry with higher fee if possible
      if (retryCount < 3) {
        console.log(`Retrying with higher fee percentage...`);
        return this.transferToken(tokenMint, amount, fromWallet, toAddress, retryCount + 1);
      }

      return false;
    }
  }
}

export default BlockchainService;
