use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
    program_pack::{Pack, IsInitialized},
};
use spl_token::state::Account as TokenAccount;

// Program ID - same as before
solana_program::declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// Entry point
entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = RewardPoolInstruction::try_from_slice(instruction_data)?;

    match instruction {
        RewardPoolInstruction::InitializeRewardPool { platform_fee_percentage } => {
            process_initialize_reward_pool(program_id, accounts, platform_fee_percentage)
        }
        RewardPoolInstruction::RecordTaskCompletion { task_id, pool_id, reward_amount } => {
            process_record_task_completion(program_id, accounts, task_id, pool_id, reward_amount)
        }
        RewardPoolInstruction::WithdrawRewards { task_ids, expected_nonce } => {
            process_withdraw_rewards(program_id, accounts, task_ids, expected_nonce)
        }
        RewardPoolInstruction::SetPaused { is_paused } => {
            process_set_paused(program_id, accounts, is_paused)
        }
        RewardPoolInstruction::UpdatePlatformFee { new_fee_percentage } => {
            process_update_platform_fee(program_id, accounts, new_fee_percentage)
        }
    }
}

// Instruction enum (complete)
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum RewardPoolInstruction {
    InitializeRewardPool { platform_fee_percentage: u8 },
    RecordTaskCompletion { task_id: String, pool_id: String, reward_amount: u64 },
    WithdrawRewards { task_ids: Vec<String>, expected_nonce: u64 },
    SetPaused { is_paused: bool },
    UpdatePlatformFee { new_fee_percentage: u8 },
}

// Account structures (complete)
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct RewardPool {
    pub is_initialized: bool,
    pub platform_authority: Pubkey,
    pub platform_fee_percentage: u8,
    pub total_rewards_distributed: u64,
    pub total_platform_fees_collected: u64,
    pub is_paused: bool,
}

impl RewardPool {
    pub const LEN: usize = 1 + 32 + 1 + 8 + 8 + 1;
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct FarmerAccount {
    pub is_initialized: bool,
    pub farmer_address: Pubkey,
    pub withdrawal_nonce: u64,
    pub total_rewards_earned: u64,
    pub total_rewards_withdrawn: u64,
    pub last_withdrawal_slot: u64,
}

impl FarmerAccount {
    pub const LEN: usize = 1 + 32 + 8 + 8 + 8 + 8;
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct TaskCompletionRecord {
    pub is_initialized: bool,
    pub task_id: String,
    pub farmer_address: Pubkey,
    pub pool_id: String,
    pub reward_amount: u64,
    pub token_mint: Pubkey,
    pub is_claimed: bool,
    pub completion_slot: u64,
}

impl TaskCompletionRecord {
    pub const LEN: usize = 1 + 64 + 32 + 64 + 8 + 32 + 1 + 8; // Max string lengths
}

// Error enum (complete)
#[derive(Debug, thiserror::Error)]
pub enum RewardPoolError {
    #[error("Invalid fee percentage")]
    InvalidFeePercentage,
    #[error("Unauthorized platform")]
    UnauthorizedPlatform,
    #[error("Account not initialized")]
    AccountNotInitialized,
    #[error("Reward pool is paused")]
    RewardPoolPaused,
    #[error("Task already claimed")]
    TaskAlreadyClaimed,
    #[error("Invalid nonce")]
    InvalidNonce,
    #[error("Insufficient token balance")]
    InsufficientTokenBalance,
    #[error("Invalid token account")]
    InvalidTokenAccount,
    #[error("Task not found")]
    TaskNotFound,
    #[error("Invalid farmer address")]
    InvalidFarmerAddress,
}

impl From<RewardPoolError> for ProgramError {
    fn from(e: RewardPoolError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

// Helper functions
fn get_reward_pool_seeds() -> [&'static [u8]; 1] {
    [b"reward_pool"]
}

fn get_farmer_account_seeds(farmer_address: &Pubkey) -> [&[u8]; 2] {
    [b"farmer", farmer_address.as_ref()]
}

fn get_task_record_seeds(task_id: &str) -> [&[u8]; 2] {
    [b"task", task_id.as_bytes()]
}

fn get_reward_vault_seeds(token_mint: &Pubkey) -> [&[u8]; 2] {
    [b"reward_vault", token_mint.as_ref()]
}

fn find_program_address(
    program_id: &Pubkey,
    seeds: &[&[u8]],
) -> (Pubkey, u8) {
    solana_program::pubkey::Pubkey::find_program_address(seeds, program_id)
}

// Instruction processors (complete)
fn process_initialize_reward_pool(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    platform_fee_percentage: u8,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let reward_pool_account = next_account_info(accounts_iter)?;
    let platform_authority = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    let rent = &Rent::from_account_info(next_account_info(accounts_iter)?)?;

    if platform_fee_percentage > 100 {
        return Err(RewardPoolError::InvalidFeePercentage.into());
    }

    if !platform_authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (expected_reward_pool_pubkey, _bump) = find_program_address(
        &get_reward_pool_seeds(),
        program_id,
    );

    if reward_pool_account.key != &expected_reward_pool_pubkey {
        return Err(ProgramError::InvalidSeeds);
    }

    let reward_pool = RewardPool {
        is_initialized: true,
        platform_authority: *platform_authority.key,
        platform_fee_percentage,
        total_rewards_distributed: 0,
        total_platform_fees_collected: 0,
        is_paused: false,
    };

    let space = RewardPool::LEN;
    let lamports = rent.minimum_balance(space);
    
    invoke(
        &system_instruction::create_account(
            platform_authority.key,
            reward_pool_account.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[
            platform_authority.clone(),
            reward_pool_account.clone(),
            system_program.clone(),
        ],
    )?;

    reward_pool.serialize(&mut &mut reward_pool_account.data.borrow_mut()[..])?;

    msg!("Reward pool initialized with {}% platform fee", platform_fee_percentage);
    Ok(())
}

fn process_record_task_completion(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    task_id: String,
    pool_id: String,
    reward_amount: u64,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let reward_pool_account = next_account_info(accounts_iter)?;
    let farmer_account = next_account_info(accounts_iter)?;
    let task_record_account = next_account_info(accounts_iter)?;
    let farmer = next_account_info(accounts_iter)?;
    let token_mint = next_account_info(accounts_iter)?;
    let platform_authority = next_account_info(accounts_iter)?;
    let system_program = next_account_info(accounts_iter)?;
    let rent = &Rent::from_account_info(next_account_info(accounts_iter)?)?;

    // Verify platform authority
    if !platform_authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load and verify reward pool
    let mut reward_pool = RewardPool::try_from_slice(&reward_pool_account.data.borrow())?;
    if !reward_pool.is_initialized {
        return Err(RewardPoolError::AccountNotInitialized.into());
    }
    if reward_pool.platform_authority != *platform_authority.key {
        return Err(RewardPoolError::UnauthorizedPlatform.into());
    }
    if reward_pool.is_paused {
        return Err(RewardPoolError::RewardPoolPaused.into());
    }

    // Verify PDAs
    let (expected_reward_pool_pubkey, _) = find_program_address(&get_reward_pool_seeds(), program_id);
    if reward_pool_account.key != &expected_reward_pool_pubkey {
        return Err(ProgramError::InvalidSeeds);
    }

    let (expected_farmer_account_pubkey, _) = find_program_address(
        &get_farmer_account_seeds(farmer.key),
        program_id,
    );
    if farmer_account.key != &expected_farmer_account_pubkey {
        return Err(ProgramError::InvalidSeeds);
    }

    let (expected_task_record_pubkey, _) = find_program_address(
        &get_task_record_seeds(&task_id),
        program_id,
    );
    if task_record_account.key != &expected_task_record_pubkey {
        return Err(ProgramError::InvalidSeeds);
    }

    // Create or update farmer account
    let mut farmer_data = if farmer_account.data_is_empty() {
        // Create new farmer account
        let space = FarmerAccount::LEN;
        let lamports = rent.minimum_balance(space);
        
        invoke(
            &system_instruction::create_account(
                platform_authority.key,
                farmer_account.key,
                lamports,
                space as u64,
                program_id,
            ),
            &[
                platform_authority.clone(),
                farmer_account.clone(),
                system_program.clone(),
            ],
        )?;

        FarmerAccount {
            is_initialized: true,
            farmer_address: *farmer.key,
            withdrawal_nonce: 0,
            total_rewards_earned: 0,
            total_rewards_withdrawn: 0,
            last_withdrawal_slot: 0,
        }
    } else {
        // Load existing farmer account
        let mut existing = FarmerAccount::try_from_slice(&farmer_account.data.borrow())?;
        if !existing.is_initialized {
            return Err(RewardPoolError::AccountNotInitialized.into());
        }
        if existing.farmer_address != *farmer.key {
            return Err(RewardPoolError::InvalidFarmerAddress.into());
        }
        existing
    };

    // Create task record
    let space = TaskCompletionRecord::LEN;
    let lamports = rent.minimum_balance(space);
    
    invoke(
        &system_instruction::create_account(
            platform_authority.key,
            task_record_account.key,
            lamports,
            space as u64,
            program_id,
        ),
        &[
            platform_authority.clone(),
            task_record_account.clone(),
            system_program.clone(),
        ],
    )?;

    let task_record = TaskCompletionRecord {
        is_initialized: true,
        task_id,
        farmer_address: *farmer.key,
        pool_id,
        reward_amount,
        token_mint: *token_mint.key,
        is_claimed: false,
        completion_slot: solana_program::clock::Clock::get()?.slot,
    };

    // Update farmer account
    farmer_data.total_rewards_earned += reward_amount;

    // Save data
    reward_pool.serialize(&mut &mut reward_pool_account.data.borrow_mut()[..])?;
    farmer_data.serialize(&mut &mut farmer_account.data.borrow_mut()[..])?;
    task_record.serialize(&mut &mut task_record_account.data.borrow_mut()[..])?;

    msg!("Task completion recorded: {} for farmer {}", task_record.task_id, farmer.key);
    Ok(())
}

fn process_withdraw_rewards(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    task_ids: Vec<String>,
    expected_nonce: u64,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let reward_pool_account = next_account_info(accounts_iter)?;
    let farmer_account = next_account_info(accounts_iter)?;
    let reward_vault = next_account_info(accounts_iter)?;
    let farmer_token_account = next_account_info(accounts_iter)?;
    let platform_treasury = next_account_info(accounts_iter)?;
    let farmer = next_account_info(accounts_iter)?;
    let token_program = next_account_info(accounts_iter)?;

    // Verify farmer is signer
    if !farmer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load reward pool
    let mut reward_pool = RewardPool::try_from_slice(&reward_pool_account.data.borrow())?;
    if !reward_pool.is_initialized {
        return Err(RewardPoolError::AccountNotInitialized.into());
    }
    if reward_pool.is_paused {
        return Err(RewardPoolError::RewardPoolPaused.into());
    }

    // Load farmer account
    let mut farmer_data = FarmerAccount::try_from_slice(&farmer_account.data.borrow())?;
    if !farmer_data.is_initialized {
        return Err(RewardPoolError::AccountNotInitialized.into());
    }
    if farmer_data.farmer_address != *farmer.key {
        return Err(RewardPoolError::InvalidFarmerAddress.into());
    }

    // Verify nonce
    if farmer_data.withdrawal_nonce != expected_nonce {
        return Err(RewardPoolError::InvalidNonce.into());
    }

    // Verify PDAs
    let (expected_reward_pool_pubkey, _) = find_program_address(&get_reward_pool_seeds(), program_id);
    if reward_pool_account.key != &expected_reward_pool_pubkey {
        return Err(ProgramError::InvalidSeeds);
    }

    let (expected_farmer_account_pubkey, _) = find_program_address(
        &get_farmer_account_seeds(farmer.key),
        program_id,
    );
    if farmer_account.key != &expected_farmer_account_pubkey {
        return Err(ProgramError::InvalidSeeds);
    }

    let mut total_reward_amount = 0u64;
    let mut token_mint = None;

    // Process each task
    for task_id in &task_ids {
        let (task_record_pda, _) = find_program_address(
            &get_task_record_seeds(task_id),
            program_id,
        );

        // Find the task record account in the accounts list
        let task_record_account = accounts.iter()
            .find(|acc| acc.key == &task_record_pda)
            .ok_or(RewardPoolError::TaskNotFound)?;

        let task_record = TaskCompletionRecord::try_from_slice(&task_record_account.data.borrow())?;
        
        if !task_record.is_initialized {
            return Err(RewardPoolError::AccountNotInitialized.into());
        }
        if task_record.farmer_address != *farmer.key {
            return Err(RewardPoolError::InvalidFarmerAddress.into());
        }
        if task_record.is_claimed {
            return Err(RewardPoolError::TaskAlreadyClaimed.into());
        }

        // Set token mint (should be same for all tasks in batch)
        if let Some(ref mint) = token_mint {
            if *mint != task_record.token_mint {
                return Err(ProgramError::InvalidArgument);
            }
        } else {
            token_mint = Some(task_record.token_mint);
        }

        total_reward_amount += task_record.reward_amount;

        // Mark task as claimed
        let mut updated_task_record = task_record;
        updated_task_record.is_claimed = true;
        updated_task_record.serialize(&mut &mut task_record_account.data.borrow_mut()[..])?;
    }

    if total_reward_amount == 0 {
        return Err(ProgramError::InvalidArgument);
    }

    let token_mint = token_mint.unwrap();

    // Verify reward vault PDA
    let (expected_reward_vault_pubkey, _) = find_program_address(
        &get_reward_vault_seeds(&token_mint),
        program_id,
    );
    if reward_vault.key != &expected_reward_vault_pubkey {
        return Err(ProgramError::InvalidSeeds);
    }

    // Calculate platform fee
    let platform_fee_amount = (total_reward_amount * reward_pool.platform_fee_percentage as u64) / 100;
    let farmer_reward_amount = total_reward_amount - platform_fee_amount;

    // Verify token accounts
    let reward_vault_data = TokenAccount::unpack(&reward_vault.data.borrow())?;
    if reward_vault_data.mint != token_mint {
        return Err(RewardPoolError::InvalidTokenAccount.into());
    }
    if reward_vault_data.amount < total_reward_amount {
        return Err(RewardPoolError::InsufficientTokenBalance.into());
    }

    let farmer_token_data = TokenAccount::unpack(&farmer_token_account.data.borrow())?;
    if farmer_token_data.mint != token_mint {
        return Err(RewardPoolError::InvalidTokenAccount.into());
    }

    let platform_treasury_data = TokenAccount::unpack(&platform_treasury.data.borrow())?;
    if platform_treasury_data.mint != token_mint {
        return Err(RewardPoolError::InvalidTokenAccount.into());
    }

    // Transfer tokens to farmer
    if farmer_reward_amount > 0 {
        invoke(
            &spl_token::instruction::transfer(
                token_program.key,
                reward_vault.key,
                farmer_token_account.key,
                reward_vault.key,
                &[],
                farmer_reward_amount,
            )?,
            &[
                reward_vault.clone(),
                farmer_token_account.clone(),
                reward_vault.clone(),
                token_program.clone(),
            ],
        )?;
    }

    // Transfer platform fee to treasury
    if platform_fee_amount > 0 {
        invoke(
            &spl_token::instruction::transfer(
                token_program.key,
                reward_vault.key,
                platform_treasury.key,
                reward_vault.key,
                &[],
                platform_fee_amount,
            )?,
            &[
                reward_vault.clone(),
                platform_treasury.clone(),
                reward_vault.clone(),
                token_program.clone(),
            ],
        )?;
    }

    // Update farmer account
    farmer_data.withdrawal_nonce += 1;
    farmer_data.total_rewards_withdrawn += total_reward_amount;
    farmer_data.last_withdrawal_slot = solana_program::clock::Clock::get()?.slot;

    // Update reward pool stats
    reward_pool.total_rewards_distributed += farmer_reward_amount;
    reward_pool.total_platform_fees_collected += platform_fee_amount;

    // Save updated data
    reward_pool.serialize(&mut &mut reward_pool_account.data.borrow_mut()[..])?;
    farmer_data.serialize(&mut &mut farmer_account.data.borrow_mut()[..])?;

    msg!("Withdrawal completed: {} tokens to farmer, {} tokens to platform", 
         farmer_reward_amount, platform_fee_amount);
    Ok(())
}

fn process_set_paused(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    is_paused: bool,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let reward_pool_account = next_account_info(accounts_iter)?;
    let platform_authority = next_account_info(accounts_iter)?;

    if !platform_authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (expected_reward_pool_pubkey, _) = find_program_address(
        &get_reward_pool_seeds(),
        program_id,
    );
    if reward_pool_account.key != &expected_reward_pool_pubkey {
        return Err(ProgramError::InvalidSeeds);
    }

    let mut reward_pool = RewardPool::try_from_slice(&reward_pool_account.data.borrow())?;
    if !reward_pool.is_initialized {
        return Err(RewardPoolError::AccountNotInitialized.into());
    }

    if reward_pool.platform_authority != *platform_authority.key {
        return Err(RewardPoolError::UnauthorizedPlatform.into());
    }

    reward_pool.is_paused = is_paused;
    reward_pool.serialize(&mut &mut reward_pool_account.data.borrow_mut()[..])?;

    msg!("Reward pool paused status set to: {}", is_paused);
    Ok(())
}

fn process_update_platform_fee(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    new_fee_percentage: u8,
) -> ProgramResult {
    let accounts_iter = &mut accounts.iter();
    let reward_pool_account = next_account_info(accounts_iter)?;
    let platform_authority = next_account_info(accounts_iter)?;

    if new_fee_percentage > 100 {
        return Err(RewardPoolError::InvalidFeePercentage.into());
    }

    if !platform_authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let (expected_reward_pool_pubkey, _) = find_program_address(
        &get_reward_pool_seeds(),
        program_id,
    );
    if reward_pool_account.key != &expected_reward_pool_pubkey {
        return Err(ProgramError::InvalidSeeds);
    }

    let mut reward_pool = RewardPool::try_from_slice(&reward_pool_account.data.borrow())?;
    if !reward_pool.is_initialized {
        return Err(RewardPoolError::AccountNotInitialized.into());
    }

    if reward_pool.platform_authority != *platform_authority.key {
        return Err(RewardPoolError::UnauthorizedPlatform.into());
    }

    reward_pool.platform_fee_percentage = new_fee_percentage;
    reward_pool.serialize(&mut &mut reward_pool_account.data.borrow_mut()[..])?;

    msg!("Platform fee updated to: {}%", new_fee_percentage);
    Ok(())
} 