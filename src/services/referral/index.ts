import { ReferralModel, IReferral } from '../../models/Referral.ts';
import { ReferralCodeModel, IReferralCode } from '../../models/ReferralCode.ts';
import BlockchainService from '../blockchain/index.ts';
import crypto from 'crypto';

export class ReferralService {
  private blockchainService: BlockchainService;

  constructor() {
    this.blockchainService = new BlockchainService(
      process.env.RPC_URL || '',
      ''
    );
  }

  /**
   * Generate a unique referral code for a wallet address
   */
  async generateReferralCode(walletAddress: string): Promise<string> {
    // Check if user already has a referral code
    const existingCode = await ReferralCodeModel.findOne({ walletAddress });
    if (existingCode) {
      return existingCode.referralCode;
    }

    // Generate a unique 8-character referral code
    let referralCode: string;
    let isUnique = false;
    
    while (!isUnique) {
      referralCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      
      // Check if code already exists
      const existing = await ReferralCodeModel.findOne({ referralCode });
      if (!existing) {
        isUnique = true;
      }
    }

    // Create referral code record
    await ReferralCodeModel.create({
      walletAddress,
      referralCode: referralCode!,
      isActive: true,
      totalReferrals: 0,
      totalRewards: 0
    });

    return referralCode!;
  }

  /**
   * Get referral code for a wallet address
   */
  async getReferralCode(walletAddress: string): Promise<IReferralCode | null> {
    return await ReferralCodeModel.findOne({ walletAddress });
  }

  /**
   * Validate a referral code and get the referrer's wallet address
   */
  async validateReferralCode(referralCode: string): Promise<string | null> {
    const codeRecord = await ReferralCodeModel.findOne({ 
      referralCode: referralCode.toUpperCase(),
      isActive: true 
    });
    
    return codeRecord ? codeRecord.walletAddress : null;
  }

  /**
   * Create a referral relationship when a user performs their first action
   */
  async createReferral(
    referrerAddress: string,
    referreeAddress: string,
    referralCode: string,
    firstActionType: string,
    firstActionData?: any
  ): Promise<IReferral> {
    // Check if referree has already been referred
    const existingReferral = await ReferralModel.findOne({ referreeAddress });
    if (existingReferral) {
      throw new Error('User has already been referred');
    }

    // Validate referral code
    const validReferrer = await this.validateReferralCode(referralCode);
    if (!validReferrer || validReferrer !== referrerAddress) {
      throw new Error('Invalid referral code');
    }

    // Prevent self-referral
    if (referrerAddress === referreeAddress) {
      throw new Error('Cannot refer yourself');
    }

    // Create referral record
    const referral = await ReferralModel.create({
      referrerAddress,
      referreeAddress,
      referralCode: referralCode.toUpperCase(),
      referralLink: `${process.env.FRONTEND_URL || 'https://clones.sol'}/ref/${referralCode}`,
      firstActionType,
      firstActionData,
      status: 'pending'
    });

    // Update referrer's stats
    await ReferralCodeModel.findOneAndUpdate(
      { walletAddress: referrerAddress },
      { $inc: { totalReferrals: 1 } }
    );

    return referral;
  }

  /**
   * Store referral relationship on-chain
   */
  async storeReferralOnChain(referralId: string): Promise<{ txHash: string; slot: number }> {
    const referral = await ReferralModel.findById(referralId);
    if (!referral) {
      throw new Error('Referral not found');
    }

    // TODO: Implement on-chain storage using Solana program
    // This would involve creating a transaction to store the referral data
    // For now, we'll simulate the on-chain storage
    
    const mockTxHash = crypto.randomBytes(32).toString('hex');
    const mockSlot = Math.floor(Date.now() / 1000);

    // Update referral with on-chain data
    await ReferralModel.findByIdAndUpdate(referralId, {
      onChainTxHash: mockTxHash,
      onChainSlot: mockSlot,
      status: 'confirmed'
    });

    return { txHash: mockTxHash, slot: mockSlot };
  }

  /**
   * Get referral statistics for a wallet
   */
  async getReferralStats(walletAddress: string): Promise<{
    totalReferrals: number;
    totalRewards: number;
    referralCode: string;
    referrals: IReferral[];
  }> {
    const referralCode = await this.getReferralCode(walletAddress);
    const referrals = await ReferralModel.find({ 
      referrerAddress: walletAddress,
      status: 'confirmed'
    }).sort({ createdAt: -1 });

    return {
      totalReferrals: referralCode?.totalReferrals || 0,
      totalRewards: referralCode?.totalRewards || 0,
      referralCode: referralCode?.referralCode || '',
      referrals
    };
  }

  /**
   * Check if a wallet has been referred
   */
  async hasBeenReferred(walletAddress: string): Promise<boolean> {
    const referral = await ReferralModel.findOne({ referreeAddress: walletAddress });
    return !!referral;
  }

  /**
   * Get referrer for a wallet
   */
  async getReferrer(walletAddress: string): Promise<string | null> {
    const referral = await ReferralModel.findOne({ referreeAddress: walletAddress });
    return referral ? referral.referrerAddress : null;
  }
}

export const referralService = new ReferralService(); 