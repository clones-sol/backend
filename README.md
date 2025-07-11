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

The entire security mechanism relies on a Master Encryption Key, which **must** be configured as an environment variable named `DEPOSIT_KEY_ENCRYPTION_SECRET`.

**Never commit this key to version control.**

#### Local Development

For local development, add the secret to your `.env` file. You can generate a secure key using:
```bash
openssl rand -base64 32
```

#### Production (Fly.io)

For production environments, set the secret using the Fly.io CLI:
```bash
fly secrets set DEPOSIT_KEY_ENCRYPTION_SECRET="your-generated-key-here" --app <your-app-name>
```

### Master Key Rotation Procedure

To maintain a high level of security, the Master Encryption Key should be rotated periodically (e.g., every 6-12 months). The system is designed to support this with zero downtime.

**Step 1: Generate and Add New Key**

Generate a new secure key. Add it to your environment secrets with a version suffix. For example, if you are rotating to version 2:

```bash
fly secrets set DEPOSIT_KEY_ENCRYPTION_SECRET_V2="your-new-key-here" --app <your-app-name>
```

**Step 2: Update the Crypto Service**

Modify `src/services/security/crypto.ts`:
1.  Update the `KEY_VERSION` constant to the new version (e.g., `const KEY_VERSION = 'v2'`).
2.  Update the logic to read both the old and new master keys from the environment variables.
3.  Modify the `decrypt` function to use the key corresponding to the version prefix found in the encrypted string (e.g., if it sees `v1:`, it uses the old key; if `v2:`, it uses the new one).

**Step 3: Deploy and Monitor**

Deploy the updated application. The system will now:
- Encrypt all **new** data with the `v2` key.
- Be able to decrypt data encrypted with both `v1` and `v2` keys.
- You should monitor logs for any decryption errors or attempts with obsolete keys.