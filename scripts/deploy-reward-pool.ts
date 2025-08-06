import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { RewardPoolClient } from '../src/solana-client';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const CLUSTER = process.env.SOLANA_CLUSTER || 'devnet';
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

// Program ID (this will be generated when building)
const PROGRAM_ID = new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

// Platform authority keypair (load from file or generate new)
const PLATFORM_AUTHORITY_KEYPAIR_PATH = process.env.PLATFORM_AUTHORITY_KEYPAIR_PATH || './platform-authority.json';

async function loadOrCreateKeypair(): Promise<Keypair> {
  try {
    if (fs.existsSync(PLATFORM_AUTHORITY_KEYPAIR_PATH)) {
      const secretKey = JSON.parse(fs.readFileSync(PLATFORM_AUTHORITY_KEYPAIR_PATH, 'utf8'));
      return Keypair.fromSecretKey(new Uint8Array(secretKey));
    }
  } catch (error) {
    console.log('Could not load existing keypair, generating new one...');
  }

  // Generate new keypair
  const keypair = Keypair.generate();
  fs.writeFileSync(PLATFORM_AUTHORITY_KEYPAIR_PATH, JSON.stringify(Array.from(keypair.secretKey)));
  console.log(`Generated new platform authority keypair: ${keypair.publicKey.toString()}`);
  console.log(`Saved to: ${PLATFORM_AUTHORITY_KEYPAIR_PATH}`);
  
  return keypair;
}

async function deployRewardPool() {
  console.log(`Deploying reward pool to ${CLUSTER}...`);
  console.log(`RPC URL: ${RPC_URL}`);
  console.log(`Program ID: ${PROGRAM_ID.toString()}`);

  // Initialize connection
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Load or create platform authority keypair
  const platformAuthority = await loadOrCreateKeypair();
  console.log(`Platform Authority: ${platformAuthority.publicKey.toString()}`);

  // Check SOL balance
  const balance = await connection.getBalance(platformAuthority.publicKey);
  console.log(`Platform Authority Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 2 * LAMPORTS_PER_SOL) {
    console.error('Insufficient SOL balance. Need at least 2 SOL for deployment.');
    console.log('You can airdrop SOL on devnet using:');
    console.log(`solana airdrop 2 ${platformAuthority.publicKey.toString()} --url ${RPC_URL}`);
    process.exit(1);
  }

  // Initialize native Solana client
  const client = new RewardPoolClient(connection);

  try {
    // Check if reward pool already exists
    try {
      const existingPool = await client.getRewardPool();
      if (existingPool) {
        console.log('Reward pool already exists:');
        console.log(`  Platform Authority: ${existingPool.platformAuthority.toString()}`);
        console.log(`  Platform Fee: ${existingPool.platformFeePercentage}%`);
        console.log(`  Total Rewards Distributed: ${existingPool.totalRewardsDistributed.toString()}`);
        console.log(`  Total Platform Fees: ${existingPool.totalPlatformFeesCollected.toString()}`);
        console.log(`  Is Paused: ${existingPool.isPaused}`);
        
        console.log('\nReward pool is already deployed and initialized!');
        return;
      }
    } catch (error) {
      console.log('Reward pool does not exist, initializing...');
    }

    // Initialize reward pool with 10% platform fee
    console.log('Initializing reward pool...');
    const tx = await client.initializeRewardPool(platformAuthority, 10); // 10% platform fee

    console.log(`✅ Reward pool initialized successfully!`);
    console.log(`Transaction: ${tx}`);
    console.log(`Reward Pool Address: ${rewardPoolPDA.toString()}`);
    console.log(`Platform Authority: ${platformAuthority.publicKey.toString()}`);
    console.log(`Platform Fee: 10%`);

    // Verify initialization
    const rewardPool = await client.getRewardPool();
    if (rewardPool) {
      console.log('\nVerification:');
      console.log(`  Platform Authority: ${rewardPool.platformAuthority.toString()}`);
      console.log(`  Platform Fee: ${rewardPool.platformFeePercentage}%`);
      console.log(`  Is Paused: ${rewardPool.isPaused}`);
    }

    // Get reward pool PDA for deployment info
    const [rewardPoolPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('reward_pool')],
      PROGRAM_ID
    );

    // Save deployment info
    const deploymentInfo = {
      programId: PROGRAM_ID.toString(),
      rewardPoolAddress: rewardPoolPDA.toString(),
      platformAuthority: platformAuthority.publicKey.toString(),
      platformFeePercentage: 10,
      cluster: CLUSTER,
      deployedAt: new Date().toISOString(),
      transaction: tx
    };

    fs.writeFileSync(
      './deployment-info.json',
      JSON.stringify(deploymentInfo, null, 2)
    );

    console.log('\n📄 Deployment info saved to: deployment-info.json');
    console.log('\n🎉 Reward pool deployment completed successfully!');

  } catch (error) {
    console.error('❌ Failed to deploy reward pool:', error);
    process.exit(1);
  }
}

// Run deployment
if (require.main === module) {
  deployRewardPool().catch(console.error);
}

export { deployRewardPool }; 