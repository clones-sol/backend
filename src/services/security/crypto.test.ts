import { describe, it, expect, beforeAll, vi } from 'vitest';

// We will import these dynamically inside beforeAll
let encrypt: (text: string) => string;
let decrypt: (hash: string) => string;
let LATEST_KEY_VERSION: string;

describe('Crypto Service', () => {
    beforeAll(async () => {
        // Set environment variables before importing the module
        process.env.DEPOSIT_KEY_ENCRYPTION_SALT = 'test-salt';
        process.env.DEPOSIT_KEY_ENCRYPTION_SECRET = 'test-secret-key-that-is-long-enough';

        // Dynamically import the module to ensure it gets the new env vars
        const cryptoModule = await import('./crypto.js');
        encrypt = cryptoModule.encrypt;
        decrypt = cryptoModule.decrypt;
        LATEST_KEY_VERSION = cryptoModule.LATEST_KEY_VERSION;
    });

    describe('encrypt', () => {
        it('should encrypt a string into a versioned format', () => {
            const plaintext = 'my secret data';
            const encrypted = encrypt(plaintext);
            expect(encrypted).toContain(`${LATEST_KEY_VERSION}:`);
        });

        it('should not produce the same output for the same input due to random IV', () => {
            const plaintext = 'my secret data';
            const encrypted1 = encrypt(plaintext);
            const encrypted2 = encrypt(plaintext);
            expect(encrypted1).not.toEqual(encrypted2);
        });
    });

    describe('decrypt', () => {
        it('should correctly decrypt a string that was encrypted by the service', () => {
            const plaintext = 'my secret data';
            const encrypted = encrypt(plaintext);
            const decrypted = decrypt(encrypted);
            expect(decrypted).toEqual(plaintext);
        });

        it('should throw an error for an invalid hash format', () => {
            const invalidHash = 'v1:iv:tag'; // Missing encrypted part
            expect(() => decrypt(invalidHash)).toThrow(
                'Invalid or unsupported encrypted hash format. Expected "version:iv:tag:encrypted".'
            );
        });

        it('should throw an error for an unsupported key version', () => {
            const text = 'some data';
            const encrypted = encrypt(text);
            const parts = encrypted.split(':');
            const tamperedHash = `v0:${parts[1]}:${parts[2]}:${parts[3]}`; // v0 is not supported
            expect(() => decrypt(tamperedHash)).toThrow('Unsupported key version: v0. Cannot decrypt.');
        });

        it('should throw an error if the auth tag is invalid (tampered data)', () => {
            // Suppress console.error for this specific test
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            const text = 'some data';
            const encrypted = encrypt(text);
            const parts = encrypted.split(':');
            // Tamper with the auth tag by replacing it with a string of zeros
            parts[2] = '0'.repeat(parts[2].length);
            const tamperedHash = parts.join(':');

            expect(() => decrypt(tamperedHash)).toThrow(
                'Decryption failed: data integrity check failed.'
            );

            // Restore console.error
            consoleErrorSpy.mockRestore();
        });
    });
}); 