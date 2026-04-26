use anchor_lang::prelude::*;
use crate::errors::AuddShieldError;
use crate::state::{Member, Pool};

#[derive(Accounts)]
pub struct JoinPool<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        constraint = pool.is_active                         @ AuddShieldError::PoolInactive,
        constraint = pool.member_count < pool.max_members   @ AuddShieldError::PoolFull,
    )]
    pub pool: Account<'info, Pool>,

    /// Member PDA — the init constraint naturally prevents double-joining:
    /// attempting to init an already-existing PDA fails at account resolution
    /// before the handler runs.
    #[account(
        init,
        payer = user,
        space = Member::LEN,
        seeds = [b"member", pool.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub member: Account<'info, Member>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<JoinPool>) -> Result<()> {
    let clock = Clock::get()?;
    let pool  = &mut ctx.accounts.pool;

    pool.member_count = pool.member_count
        .checked_add(1)
        .ok_or(AuddShieldError::Overflow)?;

    let member = &mut ctx.accounts.member;
    member.pool                 = pool.key();
    member.wallet               = ctx.accounts.user.key();
    member.total_contributed    = 0;
    member.last_contribution_at = 0;
    member.votes_cast           = 0;
    member.joined_at            = clock.unix_timestamp;
    member.is_active            = true;
    member.has_pending_request  = false;
    member.bump                 = ctx.bumps.member;
    member.contribution_streak  = 0;
    member.reputation_score     = 0;

    emit!(MemberJoined {
        pool:         pool.key(),
        member:       ctx.accounts.user.key(),
        member_count: pool.member_count,
    });

    Ok(())
}

#[event]
pub struct MemberJoined {
    pub pool:         Pubkey,
    pub member:       Pubkey,
    pub member_count: u16,
}
