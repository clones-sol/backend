import { ReferralCodeModel, IReferralCode } from '../../models/ReferralCode.ts';
import { ReferralModel, IReferral } from '../../models/Referral.ts';
import crypto from 'crypto';

export class ReferralCleanupService {
  /**
   * Clean up expired referral codes
   */
  async cleanupExpiredCodes(): Promise<number> {
    const now = new Date();
    
    // Find and deactivate expired codes
    const result = await ReferralCodeModel.updateMany(
      {
        expiresAt: { $lt: now },
        isActive: true
      },
      {
        $set: { isActive: false }
      }
    );

    return result.modifiedCount;
  }

  /**
   * Get statistics about expired codes
   */
  async getExpiredCodeStats(): Promise<{
    totalExpired: number;
    totalActive: number;
    expiringSoon: number; // Codes expiring in next 7 days
  }> {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [totalExpired, totalActive, expiringSoon] = await Promise.all([
      ReferralCodeModel.countDocuments({
        expiresAt: { $lt: now }
      }),
      ReferralCodeModel.countDocuments({
        isActive: true,
        $or: [
          { expiresAt: { $gt: now } },
          { expiresAt: { $exists: false } }
        ]
      }),
      ReferralCodeModel.countDocuments({
        expiresAt: { $gte: now, $lte: sevenDaysFromNow },
        isActive: true
      })
    ]);

    return {
      totalExpired,
      totalActive,
      expiringSoon
    };
  }

  /**
   * Extend expiration for a referral code
   */
  async extendExpiration(
    walletAddress: string, 
    extensionDays: number = 30
  ): Promise<boolean> {
    const referralCode = await ReferralCodeModel.findOne({ walletAddress });
    
    if (!referralCode) {
      return false;
    }

    const newExpiration = new Date();
    newExpiration.setDate(newExpiration.getDate() + extensionDays);

    await ReferralCodeModel.findByIdAndUpdate(referralCode._id, {
      expiresAt: newExpiration,
      isActive: true
    });

    return true;
  }

  /**
   * Get referral codes expiring soon
   */
  async getExpiringSoonCodes(daysThreshold: number = 7): Promise<IReferralCode[]> {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + daysThreshold);

    return await ReferralCodeModel.find({
      expiresAt: { $lte: threshold },
      isActive: true
    }).sort({ expiresAt: 1 });
  }

  /**
   * Clean up old referral records (optional - for data management)
   */
  async cleanupOldReferrals(daysOld: number = 365): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await ReferralModel.deleteMany({
      createdAt: { $lt: cutoffDate },
      status: { $in: ['confirmed', 'failed'] }
    });

    return result.deletedCount || 0;
  }

  /**
   * Regenerate expired referral codes
   */
  async regenerateExpiredCode(walletAddress: string): Promise<string | null> {
    const referralCode = await ReferralCodeModel.findOne({ walletAddress });
    
    if (!referralCode || !referralCode.expiresAt || referralCode.expiresAt > new Date()) {
      return null; // Not expired or doesn't exist
    }

    // Generate new code using secure random generation
    // Excluding visually similar characters: O, 0, L, 1, I to avoid human transcription errors
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let newCode: string;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 100;
    
    while (!isUnique && attempts < maxAttempts) {
      newCode = '';
      const randomBytes = crypto.randomBytes(6);
      for (let i = 0; i < 6; i++) {
        newCode += chars.charAt(randomBytes[i] % chars.length);
      }
      
      const existing = await ReferralCodeModel.findOne({ referralCode: newCode });
      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return null;
    }

    // Update with new code and expiration
    const newExpiration = new Date();
    newExpiration.setDate(newExpiration.getDate() + 30);

    await ReferralCodeModel.findByIdAndUpdate(referralCode._id, {
      referralCode: newCode!,
      expiresAt: newExpiration,
      isActive: true
    });

    return newCode!;
  }
} 