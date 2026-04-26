use anchor_lang::prelude::*;
use crate::errors::AuddShieldError;
use crate::state::{Member, Pool};

#[derive(Accounts)]
pub struct LeavePool<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [b"member", pool.key().as_ref(), user.key().as_ref()],
        bump = member.bump,
        constraint = member.is_active              @ AuddShieldError::NotAMember,
        constraint = !member.has_pending_request   @ AuddShieldError::AlreadyHasPendingRequest,
        // Admin leaving would orphan the pool — no mechanism exists to appoint a
        // replacement other than transfer_admin. Admins must use transfer_admin first.
        constraint = user.key() != pool.admin      @ AuddShieldError::AdminCannotLeave,
        // Closes the account and reclaims rent to the leaving member
        close = user
    )]
    pub member: Account<'info, Member>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<LeavePool>) -> Result<()> {
    // checked_sub instead of saturating_sub: a booking error (count already 0)
    // should surface as an explicit error, not silently underflow to 0.
    ctx.accounts.pool.member_count = ctx.accounts.pool
        .member_count
        .checked_sub(1)
        .ok_or(AuddShieldError::Overflow)?;

    emit!(MemberLeft {
        pool:         ctx.accounts.pool.key(),
        member:       ctx.accounts.user.key(),
        member_count: ctx.accounts.pool.member_count,
    });

    Ok(())
}

#[event]
pub struct MemberLeft {
    pub pool:         Pubkey,
    pub member:       Pubkey,
    pub member_count: u16,
}
