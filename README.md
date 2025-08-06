# Clones Backend - Native Solana Implementation

This project contains a reward pool smart contract built with **native Solana programming** (without Anchor framework). The program handles task completion rewards, platform fees, and secure token distributions.

## 🚀 Key Benefits of Native Solana Programming

- **No Anchor dependency** - Direct control over program logic
- **Smaller program size** - More efficient deployment
- **Better performance** - No framework overhead
- **Full control** - Complete customization of serialization and validation
- **Easier debugging** - Direct access to Solana primitives

## 📁 Project Structure

```
├── programs/reward-pool/          # Smart contract source
│   ├── src/lib.rs                 # Main program logic
│   └── Cargo.toml                 # Rust dependencies
├── src/solana-client.ts           # Native TypeScript client library
├── src/services/blockchain/       # Backend services
│   └── rewardPool.ts              # Reward pool service
├── scripts/                       # Deployment scripts
│   ├── deploy-native.sh           # Native deployment script
│   └── deploy-reward-pool.ts      # TypeScript deployment
├── tests/                         # Test files
│   └── reward-pool.test.ts        # Native Solana tests
├── cargo-build-sbf                # Build script
└── README.md                      # This file
```

## 🛠️ Prerequisites

1. **Solana CLI** (latest version)
   ```bash
   sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
   ```

2. **Rust** (latest stable)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. **Node.js** (v16 or later)
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   nvm install node
   ```

## 🔧 Building and Deploying

### 1. Build the Smart Contract

```bash
# Make build script executable
chmod +x cargo-build-sbf

# Build the program
./cargo-build-sbf
```

The compiled program will be available at: `target/deploy/reward_pool.so`

### 2. Deploy to Solana

```bash
# Deploy to devnet (recommended for testing)
npm run deploy:program devnet

# Deploy to localnet
npm run deploy:program localnet

# Deploy to mainnet (be careful!)
npm run deploy:program mainnet
```

### 3. Initialize the Reward Pool

```bash
# Initialize with TypeScript deployment script
npm run deploy:reward-pool
```

## 📋 Program Instructions

The reward pool program supports the following instructions:

### 1. Initialize Reward Pool
```rust
InitializeRewardPool { platform_fee_percentage: u8 }
```
- Creates the main reward pool account
- Sets platform authority and fee percentage
- Can only be called once

### 2. Record Task Completion
```rust
RecordTaskCompletion { 
    task_id: String, 
    pool_id: String, 
    reward_amount: u64 
}
```
- Records a completed task and its reward
- Creates farmer account if it doesn't exist
- Creates task completion record
- Only platform authority can call

### 3. Withdraw Rewards
```rust
WithdrawRewards { 
    task_ids: Vec<String>, 
    expected_nonce: u64 
}
```
- Allows farmers to withdraw earned rewards
- Automatically calculates and deducts platform fees
- Prevents replay attacks with nonce
- Transfers tokens to farmer and platform treasury

### 4. Set Paused
```rust
SetPaused { is_paused: bool }
```
- Pauses/unpauses the reward pool
- Only platform authority can call
- Prevents new task recordings when paused

### 5. Update Platform Fee
```rust
UpdatePlatformFee { new_fee_percentage: u8 }
```
- Updates the platform fee percentage
- Only platform authority can call
- Must be <= 100%

## 🏗️ Account Structure

### RewardPool Account
```rust
pub struct RewardPool {
    pub is_initialized: bool,           // 1 byte
    pub platform_authority: Pubkey,     // 32 bytes
    pub platform_fee_percentage: u8,    // 1 byte
    pub total_rewards_distributed: u64, // 8 bytes
    pub total_platform_fees_collected: u64, // 8 bytes
    pub is_paused: bool,                // 1 byte
}
```

### FarmerAccount
```rust
pub struct FarmerAccount {
    pub is_initialized: bool,           // 1 byte
    pub farmer_address: Pubkey,         // 32 bytes
    pub withdrawal_nonce: u64,          // 8 bytes
    pub total_rewards_earned: u64,      // 8 bytes
    pub total_rewards_withdrawn: u64,   // 8 bytes
    pub last_withdrawal_slot: u64,      // 8 bytes
}
```

### TaskCompletionRecord
```rust
pub struct TaskCompletionRecord {
    pub is_initialized: bool,           // 1 byte
    pub task_id: String,                // 64 bytes (max)
    pub farmer_address: Pubkey,         // 32 bytes
    pub pool_id: String,                // 64 bytes (max)
    pub reward_amount: u64,             // 8 bytes
    pub token_mint: Pubkey,             // 32 bytes
    pub is_claimed: bool,               // 1 byte
    pub completion_slot: u64,           // 8 bytes
}
```

## 💻 TypeScript Client Usage

```typescript
import { RewardPoolClient } from './src/solana-client';
import { Connection, Keypair } from '@solana/web3.js';

// Initialize client
const connection = new Connection('https://api.devnet.solana.com');
const client = new RewardPoolClient(connection);

// Initialize reward pool
const platformAuthority = Keypair.fromSecretKey(/* your key */);
const tx = await client.initializeRewardPool(platformAuthority, 5); // 5% platform fee
console.log('Initialized:', tx);

// Record task completion
const farmer = new PublicKey('...');
const tokenMint = new PublicKey('...');
const tx2 = await client.recordTaskCompletion(
  'task-123',
  'pool-456',
  new BN(1000000), // 1 token (assuming 6 decimals)
  farmer,
  tokenMint,
  platformAuthority
);
console.log('Task recorded:', tx2);

// Get reward pool data
const rewardPool = await client.getRewardPool();
console.log('Reward pool:', rewardPool);

// Get farmer account
const farmerAccount = await client.getFarmerAccount(farmer);
console.log('Farmer account:', farmerAccount);
```

## 🧪 Testing

### Build and Test Locally

```bash
# Start local validator
solana-test-validator

# In another terminal, deploy to localnet
npm run deploy:program localnet

# Run your tests
npm test
```

### Test on Devnet

```bash
# Get devnet SOL
solana airdrop 2 --url devnet

# Deploy to devnet
npm run deploy:program devnet

# Test your program
npm test
```

## 🔍 Program Addresses

- **Program ID**: `Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS`
- **Reward Pool PDA**: `[b"reward_pool"]`
- **Farmer Account PDA**: `[b"farmer", farmer_pubkey]`
- **Task Record PDA**: `[b"task", task_id_bytes]`

## 🔐 Security Features

1. **Program Derived Addresses (PDAs)** - All accounts use deterministic addresses
2. **Nonce Protection** - Prevents replay attacks on withdrawals
3. **Authority Checks** - Only authorized users can perform actions
4. **Arithmetic Safety** - All calculations use checked operations
5. **Input Validation** - String lengths and fee percentages are validated
6. **Pause Mechanism** - Emergency stop functionality

## 🚨 Important Notes

1. **Program ID**: The program ID is hardcoded. For production, generate a new one:
   ```bash
   solana-keygen new -o program-keypair.json
   ```

2. **Serialization**: The implementation uses manual serialization for instruction data and account structures.

3. **Token Accounts**: Ensure all token accounts exist before calling instructions that use them.

4. **Rent**: All accounts must be funded with enough SOL for rent exemption.

5. **Error Handling**: The program includes comprehensive error handling for all edge cases.

## 🔄 Migration from Anchor

This project has been successfully migrated from Anchor framework to native Solana programming:

1. ✅ **Removed Anchor dependencies** from `package.json`
2. ✅ **Replaced Anchor macros** with native Solana code
3. ✅ **Updated serialization** to use manual serialization
4. ✅ **Modified client code** to use native Solana web3.js
5. ✅ **Updated deployment scripts** to use Solana CLI directly
6. ✅ **Updated tests** to use native Solana client

## 📚 Resources

- [Solana Program Documentation](https://docs.solana.com/developing/programming-model/overview)
- [Solana Web3.js](https://solana-labs.github.io/solana-web3.js/)
- [SPL Token Program](https://spl.solana.com/token)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.