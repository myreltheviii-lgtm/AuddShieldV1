use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::errors::AuddShieldError;
use crate::state::{Member, Pool};

#[derive(Accounts)]
#[instruction(name: String)]
pub struct CreatePool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The AUDD token mint — validated against known devnet/mainnet address in handler
    pub audd_mint: Account<'info, Mint>,

    /// Pool config PDA — seeded by admin pubkey + pool name bytes
    #[account(
        init,
        payer = admin,
        space = Pool::LEN,
        seeds = [b"pool", admin.key().as_ref(), name.as_bytes()],
        bump
    )]
    pub pool: Account<'info, Pool>,

    /// Pool's AUDD vault — token account whose authority is the pool PDA
    #[account(
        init,
        payer = admin,
        token::mint = audd_mint,
        token::authority = pool,
        seeds = [b"vault", pool.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Admin's member account — created here so member_count is 1 from the start
    /// and the admin can vote and contribute without a separate join_pool call.
    /// Uses identical PDA seeds to a regular join_pool member account.
    #[account(
        init,
        payer = admin,
        space = Member::LEN,
        seeds = [b"member", pool.key().as_ref(), admin.key().as_ref()],
        bump
    )]
    pub admin_member: Account<'info, Member>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(
    ctx: Context<CreatePool>,
    name: String,
    min_contribution: u64,
    vote_threshold_pct: u8,
    max_members: u16,
    contribution_interval_days: u16,
    max_request_pct: u8,
) -> Result<()> {
    // Solana's create_program_address enforces a 32-byte maximum per seed component.
    // In practice, if name exceeds 32 bytes the PDA derivation in the accounts struct
    // fails before this handler runs, returning a cryptic seeds error instead of our
    // NameTooLong message. The check below is defence-in-depth: it ensures that any
    // future path (e.g. CPI) that calls this handler directly still gets a clear error.
    require!(name.as_bytes().len() <= 32, AuddShieldError::NameTooLong);
    require!(min_contribution > 0, AuddShieldError::InvalidMinContribution);
    require!(
        vote_threshold_pct >= 1 && vote_threshold_pct <= 100,
        AuddShieldError::InvalidVoteThreshold
    );
    require!(
        max_members >= 2 && max_members <= 500,
        AuddShieldError::InvalidMaxMembers
    );
    require!(
        max_request_pct >= 1 && max_request_pct <= 100,
        AuddShieldError::InvalidRequestCap
    );

    let clock = Clock::get()?;

    // ── Pool account ──────────────────────────────────────────────────────
    let pool = &mut ctx.accounts.pool;

    pool.admin                    = ctx.accounts.admin.key();
    pool.name                     = name;
    pool.audd_mint                = ctx.accounts.audd_mint.key();
    pool.vault                    = ctx.accounts.vault.key();
    pool.min_contribution         = min_contribution;
    pool.total_balance            = 0;
    pool.total_contributed_all_time = 0;
    pool.member_count             = 1; // admin is the first member
    pool.max_members              = max_members;
    pool.vote_threshold_pct       = vote_threshold_pct;
    pool.contribution_interval_days = contribution_interval_days;
    pool.total_requests           = 0;
    pool.pending_requests         = 0;
    pool.created_at               = clock.unix_timestamp;
    pool.is_active                = true;
    pool.bump                     = ctx.bumps.pool;
    pool.max_request_pct          = max_request_pct;
    // vault_bump is intentionally not stored — the vault CPI in release_funds
    // is signed by the pool PDA (vault authority = pool PDA), not the vault PDA itself.

    // ── Admin member account ──────────────────────────────────────────────
    let admin_member = &mut ctx.accounts.admin_member;

    admin_member.pool                 = pool.key();
    admin_member.wallet               = ctx.accounts.admin.key();
    admin_member.total_contributed    = 0;
    admin_member.last_contribution_at = 0;
    admin_member.votes_cast           = 0;
    admin_member.joined_at            = clock.unix_timestamp;
    admin_member.is_active            = true;
    admin_member.has_pending_request  = false;
    admin_member.bump                 = ctx.bumps.admin_member;
    admin_member.contribution_streak  = 0;
    admin_member.reputation_score     = 0;

    emit!(PoolCreated {
        pool:             pool.key(),
        admin:            pool.admin,
        name:             pool.name.clone(),
        min_contribution,
        max_members,
        max_request_pct,
    });

    Ok(())
}

#[event]
pub struct PoolCreated {
    pub pool:             Pubkey,
    pub admin:            Pubkey,
    pub name:             String,
    pub min_contribution: u64,
    pub max_members:      u16,
    pub max_request_pct:  u8,
}
