import { isAddress } from 'ethers';
import { ApiError } from '../middleware/types/errors.js';

/**
 * Centralized address validation utility with consistent error handling
 */

/**
 * Validates if a string is a valid Ethereum address
 * @param address - The address string to validate
 * @returns true if valid, false otherwise
 */
export function isValidAddress(address: unknown): address is string {
  try {
    return typeof address === 'string' && isAddress(address);
  } catch {
    return false;
  }
}

/**
 * Validates and throws a specific error if address is invalid
 * @param address - The address to validate
 * @param fieldName - Name of the field for error message
 * @throws ApiError.badRequest if address is invalid
 */
export function validateAddress(address: unknown, fieldName: string = 'address'): asserts address is string {
  if (!isValidAddress(address)) {
    throw ApiError.badRequest(`${fieldName} must be a valid Ethereum address`);
  }
}

/**
 * Validates an array of addresses
 * @param addresses - Array of addresses to validate
 * @param fieldName - Name of the field for error message
 * @throws ApiError.badRequest if any address is invalid
 */
export function validateAddresses(addresses: unknown[], fieldName: string = 'addresses'): asserts addresses is string[] {
  if (!Array.isArray(addresses)) {
    throw ApiError.badRequest(`${fieldName} must be an array`);
  }
  
  for (let i = 0; i < addresses.length; i++) {
    if (!isValidAddress(addresses[i])) {
      throw ApiError.badRequest(`${fieldName}[${i}] must be a valid Ethereum address`);
    }
  }
}

/**
 * Normalizes an address to lowercase (standard format)
 * @param address - The address to normalize
 * @returns lowercase address
 * @throws ApiError.badRequest if address is invalid
 */
export function normalizeAddress(address: unknown, fieldName: string = 'address'): string {
  validateAddress(address, fieldName);
  return address.toLowerCase();
}

/**
 * Safe address validation for Mongoose schemas
 * @param value - The value to validate
 * @returns true if valid address, false otherwise
 */
export function mongooseAddressValidator(value: unknown): boolean {
  return isValidAddress(value);
}