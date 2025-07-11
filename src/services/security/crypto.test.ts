/// <reference types="jest" />

// We will import these dynamically inside beforeAll
let encrypt: (text: string) => string;
let decrypt: (hash: string) => string;
let LATEST_KEY_VERSION: string;

describe('Crypto Service', () => {
    beforeAll(async () => {
        // Dynamically import the crypto module to ensure env vars are set
        const cryptoModule = await import('./crypto.ts');
        encrypt = cryptoModule.encrypt;
        decrypt = cryptoModule.decrypt;
        LATEST_KEY_VERSION = cryptoModule.LATEST_KEY_VERSION;
    });

    const plaintext = 'my-very-secret-private-key';

    describe('encrypt', () => {
        it('should encrypt a string into a versioned format', () => {
            const encrypted = encrypt(plaintext);
            const parts = encrypted.split(':');

            expect(parts).toHaveLength(4);
            expect(parts[0]).toBe(LATEST_KEY_VERSION);
        });

        it('should not produce the same output for the same input due to random IV', () => {
            const encrypted1 = encrypt(plaintext);
            const encrypted2 = encrypt(plaintext);
            expect(encrypted1).not.toEqual(encrypted2);
        });
    });

    describe('decrypt', () => {
        it('should correctly decrypt a string that was encrypted by the service', () => {
            const encrypted = encrypt(plaintext);
            const decrypted = decrypt(encrypted);
            expect(decrypted).toEqual(plaintext);
        });

        it('should throw an error for an invalid hash format', () => {
            const invalidHash = 'v1:invalid-format';
            expect(() => decrypt(invalidHash)).toThrow(
                'Invalid or unsupported encrypted hash format. Expected "version:iv:tag:encrypted".'
            );
        });

        it('should throw an error for an unsupported key version', () => {
            // Manually craft a hash with a fake version
            const encrypted = encrypt(plaintext);
            const parts = encrypted.split(':');
            const unsupportedHash = `v0:${parts[1]}:${parts[2]}:${parts[3]}`;

            expect(() => decrypt(unsupportedHash)).toThrow('Unsupported key version: v0. Cannot decrypt.');
        });

        it('should throw an error if the auth tag is invalid (tampered data)', () => {
            const encrypted = encrypt(plaintext);
            const parts = encrypted.split(':');

            // "Tamper" with the encrypted text
            const tamperedEncryptedText = parts[3].slice(0, -4) + 'ffff';
            const tamperedHash = `${parts[0]}:${parts[1]}:${parts[2]}:${tamperedEncryptedText}`;

            expect(() => decrypt(tamperedHash)).toThrow('Unsupported state or unable to authenticate data');
        });
    });
}); 