# Backend Server

This is the backend server for Clones. It handles database operations and API endpoints through a Docker container.

## Development

The backend runs in a Docker container. Use docker-compose to manage the service:

```bash
# Start the services
docker-compose up -d

# View logs
docker-compose logs -f backend

# Execute commands in container
docker exec backend npm run <command>

# Stop services
docker-compose down

```

---

## Security

### Critical: Private Key Encryption

To protect user funds, all `depositPrivateKey` values for training pools are encrypted before being stored in the database. This is a critical security measure to prevent fund theft in the event of a database breach.

The encryption is handled by the `src/services/security/crypto.ts` module, which uses the **AES-256-GCM** algorithm.

### Environment Variable Setup

The entire security mechanism relies on two critical environment variables:
- `DEPOSIT_KEY_ENCRYPTION_SECRET`: The Master Encryption Key.
- `DEPOSIT_KEY_ENCRYPTION_SALT`: A cryptographic salt used to derive the encryption key from the master key.

**Never commit these values to version control.**

#### Local Development

For local development, add the secrets to your `.env` file. You can generate secure values using:
```bash
# For the secret key
openssl rand -base64 32

# For the salt
openssl rand -base64 16
```

#### Production (Fly.io)

For production environments, set both secrets using the Fly.io CLI:
```bash
fly secrets set DEPOSIT_KEY_ENCRYPTION_SECRET="your-generated-key-here" DEPOSIT_KEY_ENCRYPTION_SALT="your-generated-salt-here" --app <your-app-name>
```

### Automatic Key Migration (Lazy Migration)

The system is designed to handle key rotations and legacy unencrypted keys with zero downtime through a process called **lazy migration**.

When a transaction is processed, the system automatically checks the status of the `depositPrivateKey`:
1.  **Legacy Key Detected**: If an unencrypted legacy key is found, it is immediately encrypted with the latest security key version (`v1`) and saved back to the database before the transaction proceeds.
2.  **Outdated Key Version**: In the future, if a key is encrypted with an older key version (e.g., `v1` when `v2` is the latest), the system will decrypt it using the corresponding old key and re-encrypt it with the new (`v2`) key.

This ensures that all keys are progressively updated to the latest security standard without requiring manual intervention or a dedicated maintenance window.


**Step 1: Generate and Add New Key**

Generate a new secure key. Add it to your environment secrets with a version suffix. For example, if you are rotating to version 2:

```bash
fly secrets set DEPOSIT_KEY_ENCRYPTION_SECRET_V2="your-new-key-here" --app <your-app-name>
```

**Step 2: Update the Crypto Service**

Modify `src/services/security/crypto.ts`:
1.  Uncomment the `_V2` key-loading logic and add your new secret to the `ENCRYPTION_KEYS` map with the `'v2'` key.
2.  Update the `LATEST_KEY_VERSION` constant to the new version (e.g., `export const LATEST_KEY_VERSION = 'v2'`).

**Step 3: Deploy and Monitor**

Deploy the updated application. The system will now:
- Encrypt all **new** data with the `v2` key.
- Decrypt data encrypted with both `v1` and `v2` keys.
- Automatically upgrade `v1` keys to `v2` during payment processing.
- You should monitor logs for any decryption errors.