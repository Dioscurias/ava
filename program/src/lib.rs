#![allow(unexpected_cfgs)]

use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction, system_program,
    sysvar::Sysvar,
};
use spl_token::state::Account as TokenAccount;

entrypoint!(process_instruction);

const MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const POLICY_SIZE: usize = 18;
const ESCROW_HEADER: usize = 114;
const CONDITION_MAX: usize = 200;
const ESCROW_SIZE: usize = ESCROW_HEADER + CONDITION_MAX;
const TIMED_SIZE: usize = ESCROW_SIZE + 57;
const TERMS: usize = ESCROW_SIZE;
const TIMED_ARGS: usize = 96;

#[repr(u8)]
enum TimedStatus {
    Funded = 1,
    Released = 3,
    Refunded = 4,
    Delivered = 5,
    Disputed = 6,
}
const INVALID_WINDOW: ProgramError = ProgramError::Custom(10);
const WRONG_ACTOR: ProgramError = ProgramError::Custom(11);
const TOO_EARLY: ProgramError = ProgramError::Custom(12);
const DEADLINE_PASSED: ProgramError = ProgramError::Custom(13);
const INVALID_PHASE: ProgramError = ProgramError::Custom(14);
const NO_ARBITER: ProgramError = ProgramError::Custom(15);

fn read_i64(data: &[u8]) -> i64 {
    i64::from_le_bytes(data.try_into().unwrap())
}

const FUND: u8 = 1;
const RELEASE: u8 = 2;
const PAUSED: u8 = 4;
const HELD: u8 = 1;
const READY: u8 = 2;
const RELEASED: u8 = 3;
const CANCELLED: u8 = 4;

fn read_u64(data: &[u8]) -> u64 {
    u64::from_le_bytes(data.try_into().unwrap())
}

fn require(allowed: bool, error: ProgramError) -> ProgramResult {
    if allowed { Ok(()) } else { Err(error) }
}

fn initialize<'a>(
    id: &Pubkey,
    payer: &AccountInfo<'a>,
    account: &AccountInfo<'a>,
    system: &AccountInfo<'a>,
    size: usize,
    seeds: &[&[u8]],
) -> ProgramResult {
    require(system.key == &system_program::ID, ProgramError::IncorrectProgramId)?;
    require(account.owner == &system_program::ID && account.data_is_empty(), ProgramError::AccountAlreadyInitialized)?;
    let rent = Rent::get()?.minimum_balance(size);
    // An unrelated transfer to a PDA must not prevent its rightful initialization.
    if account.lamports() < rent {
        invoke(
            &system_instruction::transfer(payer.key, account.key, rent - account.lamports()),
            &[payer.clone(), account.clone(), system.clone()],
        )?;
    }
    invoke_signed(
        &system_instruction::allocate(account.key, size as u64),
        &[account.clone(), system.clone()],
        &[seeds],
    )?;
    invoke_signed(
        &system_instruction::assign(account.key, id),
        &[account.clone(), system.clone()],
        &[seeds],
    )
}

fn token(account: &AccountInfo, owner: &Pubkey) -> ProgramResult {
    require(account.owner == &spl_token::ID, ProgramError::IncorrectProgramId)?;
    let token = TokenAccount::unpack(&account.try_borrow_data()?)?;
    require(token.mint == MINT && token.owner == *owner, ProgramError::InvalidAccountData)
}

fn policy_state(policy: &AccountInfo, id: &Pubkey) -> Result<(u8, u64, u64), ProgramError> {
    require(policy.owner == id && policy.data_len() == POLICY_SIZE, ProgramError::UninitializedAccount)?;
    let data = policy.try_borrow_data()?;
    require(data[0] == 1, ProgramError::InvalidAccountData)?;
    Ok((data[1], read_u64(&data[2..10]), read_u64(&data[10..18])))
}

fn remaining_after_funding(flags: u8, cap: u64, committed: u64, amount: u64) -> Result<u64, ProgramError> {
    require(flags & (FUND | PAUSED) == FUND, ProgramError::Custom(1))?;
    let next = committed.checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?;
    require(amount > 0 && next <= cap, ProgramError::Custom(2))?;
    Ok(next)
}

fn validate_release(flags: u8, status: u8) -> ProgramResult {
    require(flags & (RELEASE | PAUSED) == RELEASE, ProgramError::Custom(1))?;
    require(status == READY, ProgramError::Custom(3))
}

fn transfer<'a>(
    source: &AccountInfo<'a>,
    dest: &AccountInfo<'a>,
    authority: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    amount: u64,
    seeds: &[&[&[u8]]],
) -> ProgramResult {
    require(token_program.key == &spl_token::ID, ProgramError::IncorrectProgramId)?;
    #[allow(deprecated)]
    let ix = spl_token::instruction::transfer(
        &spl_token::ID, source.key, dest.key, authority.key, &[], amount,
    )?;
    invoke_signed(&ix, &[source.clone(), dest.clone(), authority.clone(), token_program.clone()], seeds)
}

fn timed_action(id: &Pubkey, accounts: &[AccountInfo], op: u8, args: &[u8]) -> ProgramResult {
    require(args.len() == if op == 10 { 9 } else { 8 }, ProgramError::InvalidInstructionData)?;
    let iter = &mut accounts.iter();
    let payer = next_account_info(iter)?;
    let policy = next_account_info(iter)?;
    let escrow = next_account_info(iter)?;
    let actor = next_account_info(iter)?;
    require(actor.is_signer, ProgramError::MissingRequiredSignature)?;
    require(escrow.owner == id && escrow.data_len() == TIMED_SIZE, ProgramError::InvalidAccountData)?;
    let (policy_key, _) = Pubkey::find_program_address(&[b"policy", payer.key.as_ref()], id);
    let nonce = &args[..8];
    let (expected, bump) = Pubkey::find_program_address(&[b"escrow", payer.key.as_ref(), nonce], id);
    require(policy.key == &policy_key && escrow.key == &expected, ProgramError::InvalidSeeds)?;

    let data = escrow.try_borrow_data()?;
    require(data[0] == 2 && data[2..34] == payer.key.to_bytes() && data[98..106] == *nonce, ProgramError::InvalidAccountData)?;
    let recipient = Pubkey::new_from_array(data[34..66].try_into().unwrap());
    let arbiter = Pubkey::new_from_array(data[TERMS+25..TERMS+57].try_into().unwrap());
    let deadline = read_i64(&data[TERMS..TERMS+8]);
    let window = read_i64(&data[TERMS+8..TERMS+16]);
    let delivered = read_i64(&data[TERMS+16..TERMS+24]);
    let disputed = data[TERMS+24] != 0;
    let review_end = delivered.checked_add(window).ok_or(ProgramError::ArithmeticOverflow)?;
    let status = data[1];
    let now = Clock::get()?.unix_timestamp;
    let release = match op {
        6 => {
            require(actor.key == &recipient, WRONG_ACTOR)?;
            require(status == TimedStatus::Funded as u8, INVALID_PHASE)?;
            require(now <= deadline, DEADLINE_PASSED)?;
            drop(data);
            let mut data = escrow.try_borrow_mut_data()?;
            data[1] = TimedStatus::Delivered as u8;
            data[TERMS+16..TERMS+24].copy_from_slice(&now.to_le_bytes());
            return Ok(());
        }
        7 => {
            require(actor.key == &recipient, WRONG_ACTOR)?;
            require(status == TimedStatus::Delivered as u8 && !disputed, INVALID_PHASE)?;
            require(now >= review_end, TOO_EARLY)?;
            true
        }
        8 => {
            require(actor.key == payer.key, WRONG_ACTOR)?;
            require(status == TimedStatus::Funded as u8 && delivered == 0, INVALID_PHASE)?;
            require(now > deadline, TOO_EARLY)?;
            false
        }
        9 => {
            require(actor.key == payer.key, WRONG_ACTOR)?;
            require(arbiter != Pubkey::default(), NO_ARBITER)?;
            require(status == TimedStatus::Delivered as u8 && !disputed, INVALID_PHASE)?;
            require(now < review_end, DEADLINE_PASSED)?;
            drop(data);
            let mut data = escrow.try_borrow_mut_data()?;
            data[1] = TimedStatus::Disputed as u8;
            data[TERMS+24] = 1;
            return Ok(());
        }
        10 => {
            require(arbiter != Pubkey::default() && actor.key == &arbiter, WRONG_ACTOR)?;
            require(status == TimedStatus::Disputed as u8 && disputed, INVALID_PHASE)?;
            require(args[8] <= 1, ProgramError::InvalidInstructionData)?;
            args[8] == 1
        }
        _ => return Err(ProgramError::InvalidInstructionData),
    };

    let vault = next_account_info(iter)?;
    let destination = next_account_info(iter)?;
    let token_program = next_account_info(iter)?;
    require(data[66..98] == vault.key.to_bytes(), ProgramError::InvalidAccountData)?;
    let amount = read_u64(&data[106..114]);
    drop(data);
    let refund_total = if release { None } else {
        let (_, _, committed) = policy_state(policy, id)?;
        Some(committed.checked_sub(amount).ok_or(ProgramError::ArithmeticOverflow)?)
    };
    token(vault, escrow.key)?;
    token(destination, if release { &recipient } else { payer.key })?;
    let seeds: &[&[u8]] = &[b"escrow", payer.key.as_ref(), nonce, &[bump]];
    transfer(vault, destination, escrow, token_program, amount, &[seeds])?;
    let mut data = escrow.try_borrow_mut_data()?;
    data[1] = if release { TimedStatus::Released as u8 } else { TimedStatus::Refunded as u8 };
    data[TERMS+24] = 0;
    if let Some(total) = refund_total {
        policy.try_borrow_mut_data()?[10..18].copy_from_slice(&total.to_le_bytes());
    }
    Ok(())
}

pub fn process_instruction(id: &Pubkey, accounts: &[AccountInfo], instruction: &[u8]) -> ProgramResult {
    let (&op, args) = instruction.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    if (6..=10).contains(&op) { return timed_action(id, accounts, op, args); }
    let accounts = &mut accounts.iter();
    let payer = next_account_info(accounts)?;
    let policy = next_account_info(accounts)?;
    require(payer.is_signer, ProgramError::MissingRequiredSignature)?;
    let (policy_key, policy_bump) = Pubkey::find_program_address(&[b"policy", payer.key.as_ref()], id);
    require(policy.key == &policy_key, ProgramError::InvalidSeeds)?;

    if op == 0 {
        require(args.len() == 9 && args[0] <= 7, ProgramError::InvalidInstructionData)?;
        let limit = read_u64(&args[1..]);
        if policy.owner == &system_program::ID {
            let system = next_account_info(accounts)?;
            initialize(id, payer, policy, system, POLICY_SIZE, &[b"policy", payer.key.as_ref(), &[policy_bump]])?;
        } else {
            let (_, _, committed) = policy_state(policy, id)?;
            require(limit >= committed, ProgramError::Custom(2))?;
        }
        let mut data = policy.try_borrow_mut_data()?;
        data[0] = 1;
        data[1] = args[0];
        data[2..10].copy_from_slice(&limit.to_le_bytes());
        return Ok(());
    }

    let (flags, cap, committed) = policy_state(policy, id)?;
    let escrow = next_account_info(accounts)?;
    require(args.len() >= 8, ProgramError::InvalidInstructionData)?;
    let nonce = &args[..8];
    let (key, bump) = Pubkey::find_program_address(&[b"escrow", payer.key.as_ref(), nonce], id);
    require(escrow.key == &key, ProgramError::InvalidSeeds)?;
    let seeds: &[&[u8]] = &[b"escrow", payer.key.as_ref(), nonce, &[bump]];

    if op == 1 || op == 5 {
        let timed = op == 5;
        let header = if timed { TIMED_ARGS } else { 48 };
        require(args.len() > header && args.len() <= header + CONDITION_MAX, ProgramError::InvalidInstructionData)?;
        let amount = read_u64(&args[8..16]);
        let condition = &args[header..];
        require(core::str::from_utf8(condition).is_ok_and(|value| !value.trim().is_empty()), ProgramError::InvalidInstructionData)?;
        let recipient = Pubkey::new_from_array(args[16..48].try_into().unwrap());
        require(recipient != Pubkey::default() && recipient != *payer.key, ProgramError::InvalidInstructionData)?;
        if timed {
            let deadline = read_i64(&args[48..56]);
            let window = read_i64(&args[56..64]);
            let now = Clock::get()?.unix_timestamp;
            require(deadline > now && (1..=30 * 86400).contains(&window) &&
                deadline <= now.saturating_add(365 * 86400), INVALID_WINDOW)?;
            let arbiter = Pubkey::new_from_array(args[64..96].try_into().unwrap());
            require(arbiter != recipient && arbiter != *payer.key, WRONG_ACTOR)?;
        }
        let next = remaining_after_funding(flags, cap, committed, amount)?;
        let source = next_account_info(accounts)?;
        let vault = next_account_info(accounts)?;
        let token_program = next_account_info(accounts)?;
        let system = next_account_info(accounts)?;
        token(source, payer.key)?;
        token(vault, escrow.key)?;
        initialize(id, payer, escrow, system, if timed { TIMED_SIZE } else { ESCROW_SIZE }, seeds)?;
        transfer(source, vault, payer, token_program, amount, &[])?;
        let mut data = escrow.try_borrow_mut_data()?;
        data[0] = if timed { 2 } else { 1 };
        data[1] = HELD;
        if timed {
            data[TERMS..TERMS+16].copy_from_slice(&args[48..64]);
            data[TERMS+25..TERMS+57].copy_from_slice(&args[64..96]);
        }
        data[2..34].copy_from_slice(payer.key.as_ref());
        data[34..66].copy_from_slice(recipient.as_ref());
        data[66..98].copy_from_slice(vault.key.as_ref());
        data[98..106].copy_from_slice(nonce);
        data[106..114].copy_from_slice(&amount.to_le_bytes());
        data[114..114 + condition.len()].copy_from_slice(condition);
        policy.try_borrow_mut_data()?[10..18].copy_from_slice(&next.to_le_bytes());
        return Ok(());
    }

    let timed = escrow.data_len() == TIMED_SIZE;
    require(args.len() == 8 && escrow.owner == id && (timed || escrow.data_len() == ESCROW_SIZE), ProgramError::InvalidAccountData)?;
    let data = escrow.try_borrow_data()?;
    require(data[0] == (if timed { 2 } else { 1 }) && data[2..34] == payer.key.to_bytes(), ProgramError::InvalidAccountData)?;
    let status = data[1];
    if timed { require(op == 3, INVALID_PHASE)?; }
    if op == 2 {
        require(flags & PAUSED == 0 && status == HELD, ProgramError::Custom(3))?;
        drop(data);
        escrow.try_borrow_mut_data()?[1] = READY;
        return Ok(());
    }
    let destination_owner = match op {
        3 => {
            if timed {
                require(flags & (RELEASE | PAUSED) == RELEASE, ProgramError::Custom(1))?;
                require(status == TimedStatus::Funded as u8 || status == TimedStatus::Delivered as u8, INVALID_PHASE)?;
            } else {
                validate_release(flags, status)?;
            }
            Pubkey::new_from_array(data[34..66].try_into().unwrap())
        }
        4 if status == HELD || status == READY => *payer.key,
        _ => return Err(ProgramError::Custom(3)),
    };
    let vault = next_account_info(accounts)?;
    let destination = next_account_info(accounts)?;
    let token_program = next_account_info(accounts)?;
    require(data[66..98] == vault.key.to_bytes(), ProgramError::InvalidAccountData)?;
    let amount = read_u64(&data[106..114]);
    drop(data);
    token(vault, escrow.key)?;
    token(destination, &destination_owner)?;
    transfer(vault, destination, escrow, token_program, amount, &[seeds])?;
    escrow.try_borrow_mut_data()?[1] = if op == 3 { RELEASED } else { CANCELLED };
    if op == 4 {
        let next = committed.checked_sub(amount).ok_or(ProgramError::ArithmeticOverflow)?;
        policy.try_borrow_mut_data()?[10..18].copy_from_slice(&next.to_le_bytes());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn funding_checks_flags_and_total_exposure() {
        assert_eq!(remaining_after_funding(FUND, 10, 4, 6), Ok(10));
        assert!(remaining_after_funding(FUND, 10, 4, 7).is_err());
        assert!(remaining_after_funding(FUND | PAUSED, 10, 4, 1).is_err());
        assert!(remaining_after_funding(FUND, u64::MAX, u64::MAX, 1).is_err());
    }

    #[test]
    fn release_requires_confirmation_and_permission() {
        assert!(validate_release(RELEASE, READY).is_ok());
        for status in [HELD, RELEASED, CANCELLED] {
            assert!(validate_release(RELEASE, status).is_err());
        }
        assert!(validate_release(RELEASE | PAUSED, READY).is_err());
        assert!(validate_release(FUND, READY).is_err());
    }
}
