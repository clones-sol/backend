import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT = process.env.DEPOSIT_KEY_ENCRYPTION_SALT;
const MASTER_KEY = process.env.DEPOSIT_KEY_ENCRYPTION_SECRET;

// --- Key Management & Rotation ---

// Define the latest version for encryption. To be updated when a new key is added.
export const LATEST_KEY_VERSION = 'v1';

// A map to hold the derived encryption keys for each version.
const ENCRYPTION_KEYS = new Map<string, Buffer>();

// Load the primary (v1) key.
if (process.env.NODE_ENV === 'production') {
    if (!MASTER_KEY) {
        throw new Error('DEPOSIT_KEY_ENCRYPTION_SECRET (v1) is not set in environment variables');
    }
    if (!SALT) {
        throw new Error('DEPOSIT_KEY_ENCRYPTION_SALT is not set in environment variables');
    }
}

if (MASTER_KEY && SALT) {
    const v1Key = scryptSync(MASTER_KEY, SALT, 32);
    ENCRYPTION_KEYS.set('v1', v1Key);
}

// Example for a future key rotation (v2).
/*
if (process.env.DEPOSIT_KEY_ENCRYPTION_SECRET_V2) {
  const v2Key = scryptSync(process.env.DEPOSIT_KEY_ENCRYPTION_SECRET_V2, SALT, 32);
  ENCRYPTION_KEYS.set('v2', v2Key);
}
*/

/**
 * Encrypts a plaintext string and prefixes it with a version identifier.
 * @param text The plaintext to encrypt.
 * @returns The versioned, encrypted string in format "version:iv:authtag:encrypted_text".
 */
export function encrypt(text: string): string {
    const key = ENCRYPTION_KEYS.get(LATEST_KEY_VERSION);
    if (!key) {
        throw new Error(
            `Encryption failed: Key for the latest version '${LATEST_KEY_VERSION}' is not loaded.`
        );
    }

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${LATEST_KEY_VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a versioned, encrypted string.
 * @param hash The encrypted string from the encrypt function.
 * @returns The decrypted plaintext string.
 */
export function decrypt(hash: string): string {
    const parts = hash.split(':');

    if (parts.length !== 4) {
        throw new Error(
            'Invalid or unsupported encrypted hash format. Expected "version:iv:tag:encrypted".'
        );
    }

    const version = parts[0];
    const key = ENCRYPTION_KEYS.get(version);

    if (!key) {
        console.warn(
            `[SECURITY_AUDIT] Decryption failed. Key for version '${version}' is not loaded or supported.`
        );
        throw new Error(`Unsupported key version: ${version}. Cannot decrypt.`);
    }

    const iv = Buffer.from(parts[1], 'hex');
    const authTag = Buffer.from(parts[2], 'hex');
    const encryptedText = Buffer.from(parts[3], 'hex');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);

    return decrypted.toString('utf8');
} 