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
};

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
        RewardPoolInstruction::SetPaused { is_paused } => {
            process_set_paused(program_id, accounts, is_paused)
        }
        RewardPoolInstruction::UpdatePlatformFee { new_fee_percentage } => {
            process_update_platform_fee(program_id, accounts, new_fee_percentage)
        }
    }
}

// Instruction enum (simplified)
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum RewardPoolInstruction {
    InitializeRewardPool { platform_fee_percentage: u8 },
    SetPaused { is_paused: bool },
    UpdatePlatformFee { new_fee_percentage: u8 },
}

// Account structures (simplified)
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

// Error enum
#[derive(Debug, thiserror::Error)]
pub enum RewardPoolError {
    #[error("Invalid fee percentage")]
    InvalidFeePercentage,
    #[error("Unauthorized platform")]
    UnauthorizedPlatform,
    #[error("Account not initialized")]
    AccountNotInitialized,
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

fn find_program_address(
    program_id: &Pubkey,
    seeds: &[&[u8]],
) -> (Pubkey, u8) {
    solana_program::pubkey::Pubkey::find_program_address(seeds, program_id)
}

// Instruction processors (simplified)
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

    let (expected_reward_pool_pubkey, _bump) = solana_program::pubkey::Pubkey::find_program_address(
        &[b"reward_pool"],
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
    
    // Create the account using invoke instead of invoke_signed
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
        program_id,
        &get_reward_pool_seeds()[..],
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
        program_id,
        &get_reward_pool_seeds()[..],
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