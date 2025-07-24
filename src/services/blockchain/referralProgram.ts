import { Connection, PublicKey, Transaction, SystemProgram, Keypair } from '@solana/web3.js';
import { Program, AnchorProvider, web3, BN } from '@project-serum/anchor';
import { IDL } from './referral-program-idl';

export interface ReferralData {
  referrerAddress: string;
  referreeAddress: string;
  referralCode: string;
  timestamp: number;
  rewardAmount?: number;
}

export class ReferralProgramService {
  private connection: Connection;
  private program: Program;
  private programId: PublicKey;

  constructor(rpcUrl: string, programId: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.programId = new PublicKey(programId);
    
    // Initialize provider (you'll need to set up proper wallet/keypair)
    const provider = new AnchorProvider(
      this.connection,
      {
        publicKey: Keypair.generate().publicKey,
        signTransaction: async (tx) => tx,
        signAllTransactions: async (txs) => txs,
      },
      { commitment: 'confirmed' }
    );

    this.program = new Program(IDL, this.programId, provider);
  }

  /**
   * Store referral data on-chain
   */
  async storeReferral(referralData: ReferralData): Promise<{ txHash: string; slot: number }> {
    try {
      const referrerPubkey = new PublicKey(referralData.referrerAddress);
      const referreePubkey = new PublicKey(referralData.referreeAddress);
      
      // Generate PDA for referral account
      const [referralAccount] = await PublicKey.findProgramAddress(
        [
          Buffer.from('referral'),
          referrerPubkey.toBuffer(),
          referreePubkey.toBuffer(),
        ],
        this.programId
      );

      // Create transaction
      const tx = new Transaction();
      
      // Add instruction to store referral data
      tx.add(
        await this.program.methods
          .storeReferral(
            referralData.referralCode,
            new BN(referralData.timestamp),
            referralData.rewardAmount ? new BN(referralData.rewardAmount) : new BN(0)
          )
          .accounts({
            referrer: referrerPubkey,
            referree: referreePubkey,
            referralAccount: referralAccount,
            systemProgram: SystemProgram.programId,
          })
          .instruction()
      );

      // For now, we'll simulate the transaction
      // In production, you'd need proper wallet signing
      const latestBlockhash = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = latestBlockhash.blockhash;
      tx.feePayer = referrerPubkey;

      // Simulate transaction
      const simulation = await this.connection.simulateTransaction(tx);
      
      if (simulation.value.err) {
        throw new Error(`Transaction simulation failed: ${simulation.value.err}`);
      }

      // In production, you would sign and send the transaction here
      // const signature = await this.connection.sendTransaction(tx, [wallet]);
      // await this.connection.confirmTransaction(signature);

      // For now, return mock data
      const mockTxHash = Buffer.from(Math.random().toString()).toString('hex');
      const mockSlot = latestBlockhash.lastValidBlockHeight || 0;

      return {
        txHash: mockTxHash,
        slot: mockSlot
      };

    } catch (error) {
      console.error('Failed to store referral on-chain:', error);
      throw error;
    }
  }

  /**
   * Get referral data from on-chain storage
   */
  async getReferral(referrerAddress: string, referreeAddress: string): Promise<ReferralData | null> {
    try {
      const referrerPubkey = new PublicKey(referrerAddress);
      const referreePubkey = new PublicKey(referreeAddress);
      
      const [referralAccount] = await PublicKey.findProgramAddress(
        [
          Buffer.from('referral'),
          referrerPubkey.toBuffer(),
          referreePubkey.toBuffer(),
        ],
        this.programId
      );

      // Fetch account data
      const accountInfo = await this.connection.getAccountInfo(referralAccount);
      
      if (!accountInfo) {
        return null;
      }

      // Decode account data (this would depend on your program's account structure)
      // For now, return mock data
      return {
        referrerAddress,
        referreeAddress,
        referralCode: 'MOCK123',
        timestamp: Date.now(),
        rewardAmount: 0
      };

    } catch (error) {
      console.error('Failed to get referral from on-chain:', error);
      return null;
    }
  }

  /**
   * Distribute rewards to referrer
   */
  async distributeReward(
    referrerAddress: string, 
    rewardAmount: number,
    rewardTokenMint?: string
  ): Promise<{ txHash: string; slot: number }> {
    try {
      const referrerPubkey = new PublicKey(referrerAddress);
      
      // Create transaction for reward distribution
      const tx = new Transaction();
      
      // Add reward distribution instruction
      // This would depend on your specific reward mechanism
      
      const latestBlockhash = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = latestBlockhash.blockhash;
      tx.feePayer = referrerPubkey;

      // Simulate transaction
      const simulation = await this.connection.simulateTransaction(tx);
      
      if (simulation.value.err) {
        throw new Error(`Reward distribution failed: ${simulation.value.err}`);
      }

      // Mock response for now
      const mockTxHash = Buffer.from(Math.random().toString()).toString('hex');
      const mockSlot = latestBlockhash.lastValidBlockHeight || 0;

      return {
        txHash: mockTxHash,
        slot: mockSlot
      };

    } catch (error) {
      console.error('Failed to distribute reward:', error);
      throw error;
    }
  }
} 