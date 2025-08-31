import { ethers } from 'ethers';

/**
 * Centralized amount validation utility
 * Prevents floating-point precision errors and validates decimal constraints
 */
export class AmountValidator {
  /**
   * Validates and converts an amount string to Wei using proper token decimals
   * @param amount - Amount as string (e.g., "10.5")
   * @param decimals - Token decimals (e.g., 6 for USDC, 18 for ETH)
   * @param tokenSymbol - Token symbol for error messages
   * @returns BigInt amount in Wei
   */
  static validateAndParseAmount(amount: string, decimals: number, tokenSymbol: string): bigint {
    // Validate input is string
    if (typeof amount !== 'string' || amount.trim() === '') {
      throw new Error('Amount must be a non-empty string');
    }

    const amountStr = amount.trim();
    
    // Check for scientific notation
    if (amountStr.includes('e') || amountStr.includes('E')) {
      throw new Error(`Scientific notation not supported: ${amount}. Please use decimal format.`);
    }

    // Parse as number for validation
    const numAmount = Number(amountStr);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error(`Invalid amount: ${amount}. Must be a positive number.`);
    }

    // Check decimal places don't exceed token precision
    const decimalPlaces = (amountStr.split('.')[1] || '').length;
    if (decimalPlaces > decimals) {
      throw new Error(`Too many decimal places. Maximum ${decimals} decimals allowed for ${tokenSymbol}.`);
    }

    // Validate minimum amount based on token decimals
    const minAmount = 1 / Math.pow(10, decimals);
    if (numAmount < minAmount) {
      throw new Error(`Amount too small. Minimum amount is ${minAmount} ${tokenSymbol}`);
    }

    // Use ethers.parseUnits with exact string to avoid precision issues
    try {
      return ethers.parseUnits(amountStr, decimals);
    } catch (error) {
      throw new Error(`Failed to parse amount: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Simple validation for basic amount checks (before token context is available)
   * @param amount - Amount as string
   * @returns Parsed number if valid
   */
  static validateBasicAmount(amount: string): number {
    if (typeof amount !== 'string' || amount.trim() === '') {
      throw new Error('Amount must be a non-empty string');
    }

    const amountStr = amount.trim();
    
    // Check for scientific notation
    if (amountStr.includes('e') || amountStr.includes('E')) {
      throw new Error(`Scientific notation not supported: ${amount}. Please use decimal format.`);
    }

    const numAmount = Number(amountStr);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error(`Invalid amount: ${amount}. Must be a positive number.`);
    }

    return numAmount;
  }
}