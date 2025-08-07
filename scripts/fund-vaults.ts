#!/usr/bin/env ts-node

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { RewardPoolService } from '../src/services/blockchain/rewardPool';
import { 
  getOrCreateAssociatedTokenAccount, 
  mintTo, 
  createMint,
  getAccount,
  TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import * as fs from 'fs';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const PROGRAM_ID = process.env.REWARD_POOL_PROGRAM_ID || 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';
const PLATFORM_TREASURY_ADDRESS = process.env.PLATFORM_TREASURY_ADDRESS;

// Devnet token configuration
const DEVNET_TOKENS = {
  USDC: {
    symbol: 'USDC',
    // Devnet USDC mint (this is the official devnet USDC)
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    decimals: 6,
    amount: 1000000 // 1 USDC (6 decimals)
  },
  CLONES: {
    symbol: 'CLONES',
    // We'll create a new CLONES mint for testing
    mint: '', // Will be created
    decimals: 6,
    amount: 1000000 // 1 CLONES (6 decimals)
  }
};

async function fundVaults() {
  console.log('💰 Funding Reward Vaults for Testing...');
  console.log(`Network: ${RPC_URL}`);
  console.log(`Program ID: ${PROGRAM_ID}`);

  // Initialize connection
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Load platform authority keypair
  const platformAuthorityKeypair = loadPlatformAuthorityKeypair();
  
  console.log(`🔑 Platform Authority: ${platformAuthorityKeypair.publicKey.toString()}`);
  
  // Check SOL balance
  const solBalance = await connection.getBalance(platformAuthorityKeypair.publicKey);
  console.log(`💰 SOL Balance: ${solBalance / 1e9} SOL`);
  
  if (solBalance < 0.1 * 1e9) {
    console.log('⚠️  Low SOL balance. Please airdrop more SOL:');
    console.log(`   solana airdrop 2 --url devnet`);
    return;
  }

  // Initialize service
  const service = new RewardPoolService(
    connection,
    PROGRAM_ID,
    platformAuthorityKeypair,
    PLATFORM_TREASURY_ADDRESS
  );

  try {
    // Create CLONES mint if needed
    if (!DEVNET_TOKENS.CLONES.mint || DEVNET_TOKENS.CLONES.mint === '') {
      console.log('\n🏭 Creating CLONES token mint...');
      const clonesMint = await createMint(
        connection,
        platformAuthorityKeypair,
        platformAuthorityKeypair.publicKey,
        platformAuthorityKeypair.publicKey,
        DEVNET_TOKENS.CLONES.decimals,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
      DEVNET_TOKENS.CLONES.mint = clonesMint.toString();
      console.log(`✅ CLONES mint created: ${DEVNET_TOKENS.CLONES.mint}`);
    }

    // Check current balances
    console.log('\n📊 Current Vault Balances:');
    for (const [symbol, token] of Object.entries(DEVNET_TOKENS)) {
      try {
        const balance = await service.getRewardVaultBalance(token.mint);
        console.log(`${symbol} Vault Balance: ${balance} ${symbol}`);
      } catch (error) {
        console.log(`${symbol} Vault Balance: Vault not initialized yet`);
      }
    }

    // Fund each vault
    console.log('\n🏦 Funding Vaults...');
    for (const [symbol, token] of Object.entries(DEVNET_TOKENS)) {
      console.log(`\nFunding ${symbol} vault...`);
      
      try {
        // Get or create user token account
        const userTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          platformAuthorityKeypair,
          new PublicKey(token.mint),
          platformAuthorityKeypair.publicKey
        );

        console.log(`${symbol} user token account: ${userTokenAccount.address.toString()}`);

        // Mint tokens to user account
        const mintTx = await mintTo(
          connection,
          platformAuthorityKeypair,
          new PublicKey(token.mint),
          userTokenAccount.address,
          platformAuthorityKeypair,
          token.amount
        );

        console.log(`✅ Minted ${token.amount / Math.pow(10, token.decimals)} ${symbol} to user account`);
        console.log(`📝 Transaction: ${mintTx}`);

        // Get or create vault token account
        const vaultTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          platformAuthorityKeypair,
          new PublicKey(token.mint),
          platformAuthorityKeypair.publicKey,
          true
        );

        console.log(`${symbol} vault token account: ${vaultTokenAccount.address.toString()}`);

        // For now, we'll just create the vault and mint tokens
        // The actual transfer to vault will be done through the reward pool program
        console.log(`✅ ${symbol} vault prepared with ${token.amount / Math.pow(10, token.decimals)} ${symbol} for testing`);
        console.log(`📝 User account has ${token.amount / Math.pow(10, token.decimals)} ${symbol} ready for rewards`);
        
      } catch (error) {
        console.log(`⚠️  ${symbol} vault funding failed: ${error.message}`);
        console.log(`   Error details:`, error);
      }
    }

    // Check final balances
    console.log('\n📊 Final Vault Balances:');
    for (const [symbol, token] of Object.entries(DEVNET_TOKENS)) {
      try {
        const balance = await service.getRewardVaultBalance(token.mint);
        console.log(`${symbol} Vault Balance: ${balance} ${symbol}`);
      } catch (error) {
        console.log(`${symbol} Vault Balance: Error checking balance - ${error.message}`);
      }
    }

    console.log('\n🎉 Vault Funding Complete!');
    console.log('\n📝 Next Steps:');
    console.log('1. Test reward recording functionality');
    console.log('2. Test reward withdrawal functionality');
    console.log('3. Deploy to mainnet when ready');

  } catch (error) {
    console.error('❌ Vault funding failed:', error);
    process.exit(1);
  }
}

function loadPlatformAuthorityKeypair(): Keypair {
  // Try to load from environment variable first
  const privateKeyEnv = process.env.PLATFORM_AUTHORITY_PRIVATE_KEY;
  if (privateKeyEnv) {
    try {
      const privateKeyBytes = Buffer.from(privateKeyEnv, 'base64');
      return Keypair.fromSecretKey(privateKeyBytes);
    } catch (error) {
      console.error('Failed to load platform authority from environment variable:', error);
    }
  }

  // Try to load from keypair file
  const keypairPath = process.env.PLATFORM_AUTHORITY_KEYPAIR_PATH || 'C:\\Users\\1\\.config\\solana\\id.json';
  if (fs.existsSync(keypairPath)) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
      return Keypair.fromSecretKey(new Uint8Array(keypairData));
    } catch (error) {
      console.error('Failed to load platform authority from keypair file:', error);
    }
  }

  // Try to load from default Solana config location
  const defaultKeypairPath = 'C:\\Users\\1\\.config\\solana\\id.json';
  if (fs.existsSync(defaultKeypairPath)) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(defaultKeypairPath, 'utf8'));
      return Keypair.fromSecretKey(new Uint8Array(keypairData));
    } catch (error) {
      console.error('Failed to load platform authority from default keypair file:', error);
    }
  }

  // Generate new keypair for testing
  console.warn('⚠️  No platform authority keypair found. Generating new one for testing.');
  const newKeypair = Keypair.generate();
  
  // Save the keypair for future use
  const keypairData = Array.from(newKeypair.secretKey);
  fs.writeFileSync('./platform-authority.json', JSON.stringify(keypairData));
  
  console.log('📁 New keypair saved to ./platform-authority.json');
  console.log(`🔑 Public Key: ${newKeypair.publicKey.toString()}`);
  
  return newKeypair;
}

// Run the funding
fundVaults().catch(console.error); 