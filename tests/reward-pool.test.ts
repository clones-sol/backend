import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo } from '@solana/spl-token';
import { RewardPoolClient } from '../src/solana-client';
import { describe, it, beforeAll, expect } from 'vitest';
import BN from 'bn.js';

describe('Reward Pool', () => {
  const connection = new Connection('http://localhost:8899', 'confirmed');
  const client = new RewardPoolClient(connection);

  // Test accounts
  let platformAuthority: Keypair;
  let farmer: Keypair;
  let rewardPoolPDA: PublicKey;
  let rewardPoolBump: number;
  let farmerAccountPDA: PublicKey;
  let farmerAccountBump: number;
  let taskRecordPDA: PublicKey;
  let taskRecordBump: number;
  let tokenMint: PublicKey;
  let rewardVault: PublicKey;
  let farmerTokenAccount: PublicKey;
  let platformTreasury: PublicKey;

  beforeAll(async () => {
    // Generate test keypairs
    platformAuthority = Keypair.generate();
    farmer = Keypair.generate();

    // Airdrop SOL to platform authority
    const signature = await connection.requestAirdrop(
      platformAuthority.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(signature);

    // Airdrop SOL to farmer
    const farmerSignature = await connection.requestAirdrop(
      farmer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(farmerSignature);

    // Find PDAs
    const PROGRAM_ID = new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');
    [rewardPoolPDA, rewardPoolBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('reward_pool')],
      PROGRAM_ID
    );

    [farmerAccountPDA, farmerAccountBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('farmer'), farmer.publicKey.toBuffer()],
      PROGRAM_ID
    );

    // Create test token mint
    tokenMint = await createMint(
      connection,
      platformAuthority,
      platformAuthority.publicKey,
      null,
      6
    );

    // Create reward vault
    rewardVault = await createAccount(
      connection,
      platformAuthority,
      tokenMint,
      rewardPoolPDA
    );

    // Create farmer token account
    farmerTokenAccount = await createAccount(
      connection,
      farmer,
      tokenMint,
      farmer.publicKey
    );

    // Create platform treasury
    platformTreasury = await createAccount(
      connection,
      platformAuthority,
      tokenMint,
      platformAuthority.publicKey
    );

    // Mint tokens to reward vault
    await mintTo(
      connection,
      platformAuthority,
      tokenMint,
      rewardVault,
      platformAuthority,
      1000000000 // 1000 tokens
    );
  });

  it('Should initialize reward pool', async () => {
    const platformFeePercentage = 10;

    await client.initializeRewardPool(platformAuthority, platformFeePercentage);

    const rewardPool = await client.getRewardPool();
    expect(rewardPool).to.not.be.null;
    expect(rewardPool!.platformAuthority.toString()).to.equal(platformAuthority.publicKey.toString());
    expect(rewardPool!.platformFeePercentage).to.equal(platformFeePercentage);
    expect(rewardPool!.totalRewardsDistributed.toNumber()).to.equal(0);
    expect(rewardPool!.totalPlatformFeesCollected.toNumber()).to.equal(0);
    expect(rewardPool!.isPaused).to.be.false;
  });

  it('Should record task completion', async () => {
    const taskId = 'test-task-1';
    const poolId = 'test-pool-1';
    const rewardAmount = new BN(1000000); // 1 token

    [taskRecordPDA, taskRecordBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('task'), Buffer.from(taskId)],
      PROGRAM_ID
    );

    await client.recordTaskCompletion(
      taskId,
      poolId,
      rewardAmount,
      farmer.publicKey,
      tokenMint,
      platformAuthority
    );

    // Note: Task record verification would require implementing getTaskCompletionRecord in the client
    // For now, we'll just verify the farmer account was updated
    const farmerAccount = await client.getFarmerAccount(farmer.publicKey);
    expect(farmerAccount).to.not.be.null;
    expect(farmerAccount!.farmerAddress.toString()).to.equal(farmer.publicKey.toString());
    expect(farmerAccount!.totalRewardsEarned.toNumber()).to.equal(rewardAmount.toNumber());
    expect(farmerAccount!.totalRewardsWithdrawn.toNumber()).to.equal(0);
    expect(farmerAccount!.withdrawalNonce.toNumber()).to.equal(0);
  });

  it('Should withdraw rewards', async () => {
    const taskIds = ['test-task-1'];
    const expectedNonce = 0;

    // Get initial balances
    const initialFarmerBalance = await provider.connection.getTokenAccountBalance(farmerTokenAccount);
    const initialTreasuryBalance = await provider.connection.getTokenAccountBalance(platformTreasury);

    await program.methods
      .withdrawRewards(taskIds, new anchor.BN(expectedNonce))
      .accounts({
        rewardPool: rewardPoolPDA,
        farmerAccount: farmerAccountPDA,
        rewardVault: rewardVault,
        farmerTokenAccount: farmerTokenAccount,
        platformTreasury: platformTreasury,
        farmer: farmer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([farmer])
      .rpc();

    // Verify task is marked as claimed
    const taskRecord = await program.account.taskCompletionRecord.fetch(taskRecordPDA);
    expect(taskRecord.isClaimed).to.be.true;

    // Verify farmer account updated
    const farmerAccount = await program.account.farmerAccount.fetch(farmerAccountPDA);
    expect(farmerAccount.withdrawalNonce.toNumber()).to.equal(1);
    expect(farmerAccount.totalRewardsWithdrawn.toNumber()).to.equal(900000); // 90% of 1 token

    // Verify reward pool stats updated
    const rewardPool = await program.account.rewardPool.fetch(rewardPoolPDA);
    expect(rewardPool.totalRewardsDistributed.toNumber()).to.equal(900000);
    expect(rewardPool.totalPlatformFeesCollected.toNumber()).to.equal(100000); // 10% of 1 token

    // Verify token transfers
    const finalFarmerBalance = await provider.connection.getTokenAccountBalance(farmerTokenAccount);
    const finalTreasuryBalance = await provider.connection.getTokenAccountBalance(platformTreasury);

    expect(finalFarmerBalance.value.amount).to.equal('900000'); // 0.9 tokens
    expect(finalTreasuryBalance.value.amount).to.equal('100000'); // 0.1 tokens
  });

  it('Should prevent double withdrawal', async () => {
    const taskIds = ['test-task-1'];
    const expectedNonce = 1;

    try {
      await program.methods
        .withdrawRewards(taskIds, new anchor.BN(expectedNonce))
        .accounts({
          rewardPool: rewardPoolPDA,
          farmerAccount: farmerAccountPDA,
          rewardVault: rewardVault,
          farmerTokenAccount: farmerTokenAccount,
          platformTreasury: platformTreasury,
          farmer: farmer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([farmer])
        .rpc();

      expect.fail('Should have thrown an error for already claimed task');
    } catch (error) {
      expect(error.message).to.include('TaskAlreadyClaimed');
    }
  });

  it('Should prevent withdrawal with invalid nonce', async () => {
    const taskIds = ['test-task-2'];
    const invalidNonce = 999;

    // First record a new task
    const taskId = 'test-task-2';
    const poolId = 'test-pool-2';
    const rewardAmount = new anchor.BN(500000); // 0.5 tokens

    [taskRecordPDA, taskRecordBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('task'), Buffer.from(taskId)],
      program.programId
    );

    await program.methods
      .recordTaskCompletion(taskId, poolId, rewardAmount)
      .accounts({
        rewardPool: rewardPoolPDA,
        farmerAccount: farmerAccountPDA,
        taskRecord: taskRecordPDA,
        farmer: farmer.publicKey,
        tokenMint: tokenMint,
        platformAuthority: platformAuthority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([platformAuthority])
      .rpc();

    // Try to withdraw with invalid nonce
    try {
      await program.methods
        .withdrawRewards(taskIds, new anchor.BN(invalidNonce))
        .accounts({
          rewardPool: rewardPoolPDA,
          farmerAccount: farmerAccountPDA,
          rewardVault: rewardVault,
          farmerTokenAccount: farmerTokenAccount,
          platformTreasury: platformTreasury,
          farmer: farmer.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([farmer])
        .rpc();

      expect.fail('Should have thrown an error for invalid nonce');
    } catch (error) {
      expect(error.message).to.include('InvalidNonce');
    }
  });

  it('Should pause and unpause reward pool', async () => {
    // Pause the pool
    await program.methods
      .setPaused(true)
      .accounts({
        rewardPool: rewardPoolPDA,
        platformAuthority: platformAuthority.publicKey,
      })
      .signers([platformAuthority])
      .rpc();

    let rewardPool = await program.account.rewardPool.fetch(rewardPoolPDA);
    expect(rewardPool.isPaused).to.be.true;

    // Try to record task completion while paused
    const taskId = 'test-task-paused';
    const poolId = 'test-pool-paused';
    const rewardAmount = new anchor.BN(100000);

    [taskRecordPDA, taskRecordBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('task'), Buffer.from(taskId)],
      program.programId
    );

    try {
      await program.methods
        .recordTaskCompletion(taskId, poolId, rewardAmount)
        .accounts({
          rewardPool: rewardPoolPDA,
          farmerAccount: farmerAccountPDA,
          taskRecord: taskRecordPDA,
          farmer: farmer.publicKey,
          tokenMint: tokenMint,
          platformAuthority: platformAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([platformAuthority])
        .rpc();

      expect.fail('Should have thrown an error for paused pool');
    } catch (error) {
      expect(error.message).to.include('PoolPaused');
    }

    // Unpause the pool
    await program.methods
      .setPaused(false)
      .accounts({
        rewardPool: rewardPoolPDA,
        platformAuthority: platformAuthority.publicKey,
      })
      .signers([platformAuthority])
      .rpc();

    rewardPool = await program.account.rewardPool.fetch(rewardPoolPDA);
    expect(rewardPool.isPaused).to.be.false;
  });

  it('Should prevent unauthorized platform operations', async () => {
    // Try to pause with wrong authority
    try {
      await program.methods
        .setPaused(true)
        .accounts({
          rewardPool: rewardPoolPDA,
          platformAuthority: farmer.publicKey, // Wrong authority
        })
        .signers([farmer])
        .rpc();

      expect.fail('Should have thrown an error for unauthorized platform');
    } catch (error) {
      expect(error.message).to.include('UnauthorizedPlatform');
    }
  });

  it('Should handle batch withdrawals', async () => {
    // Record multiple tasks
    const taskIds = ['batch-task-1', 'batch-task-2', 'batch-task-3'];
    const poolId = 'batch-pool';
    const rewardAmount = new anchor.BN(200000); // 0.2 tokens each

    for (let i = 0; i < taskIds.length; i++) {
      const taskId = taskIds[i];
      [taskRecordPDA, taskRecordBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('task'), Buffer.from(taskId)],
        program.programId
      );

      await program.methods
        .recordTaskCompletion(taskId, poolId, rewardAmount)
        .accounts({
          rewardPool: rewardPoolPDA,
          farmerAccount: farmerAccountPDA,
          taskRecord: taskRecordPDA,
          farmer: farmer.publicKey,
          tokenMint: tokenMint,
          platformAuthority: platformAuthority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([platformAuthority])
        .rpc();
    }

    // Get current nonce
    const farmerAccount = await program.account.farmerAccount.fetch(farmerAccountPDA);
    const currentNonce = farmerAccount.withdrawalNonce.toNumber();

    // Get initial balances
    const initialFarmerBalance = await provider.connection.getTokenAccountBalance(farmerTokenAccount);
    const initialTreasuryBalance = await provider.connection.getTokenAccountBalance(platformTreasury);

    // Withdraw all tasks in batch
    await program.methods
      .withdrawRewards(taskIds, new anchor.BN(currentNonce))
      .accounts({
        rewardPool: rewardPoolPDA,
        farmerAccount: farmerAccountPDA,
        rewardVault: rewardVault,
        farmerTokenAccount: farmerTokenAccount,
        platformTreasury: platformTreasury,
        farmer: farmer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([farmer])
      .rpc();

    // Verify all tasks are claimed
    for (const taskId of taskIds) {
      [taskRecordPDA, taskRecordBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('task'), Buffer.from(taskId)],
        program.programId
      );
      const taskRecord = await program.account.taskCompletionRecord.fetch(taskRecordPDA);
      expect(taskRecord.isClaimed).to.be.true;
    }

    // Verify farmer received 90% of total (3 * 0.2 * 0.9 = 0.54 tokens)
    const finalFarmerBalance = await provider.connection.getTokenAccountBalance(farmerTokenAccount);
    const finalTreasuryBalance = await provider.connection.getTokenAccountBalance(platformTreasury);

    expect(finalFarmerBalance.value.amount).to.equal('540000'); // 0.54 tokens
    expect(finalTreasuryBalance.value.amount).to.equal('160000'); // 0.16 tokens (0.1 + 0.06)
  });
}); 