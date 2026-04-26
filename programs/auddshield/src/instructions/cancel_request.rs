use anchor_lang::prelude::*;
use crate::errors::AuddShieldError;
use crate::state::{EmergencyRequest, Member, Pool, RequestStatus};

#[derive(Accounts)]
pub struct CancelRequest<'info> {
    pub requester: Signer<'info>,

    #[account(mut)]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [b"member", pool.key().as_ref(), requester.key().as_ref()],
        bump = member.bump,
        constraint = member.is_active @ AuddShieldError::NotAMember,
    )]
    pub member: Account<'info, Member>,

    #[account(
        mut,
        constraint = emergency_request.pool      == pool.key()             @ AuddShieldError::NotAMember,
        constraint = emergency_request.requester == requester.key()        @ AuddShieldError::NotRequester,
        constraint = emergency_request.status    == RequestStatus::Pending  @ AuddShieldError::RequestAlreadySettled,
    )]
    pub emergency_request: Account<'info, EmergencyRequest>,
}

pub fn handler(ctx: Context<CancelRequest>) -> Result<()> {
    ctx.accounts.emergency_request.status = RequestStatus::Cancelled;
    ctx.accounts.member.has_pending_request = false;
    ctx.accounts.pool.pending_requests = ctx.accounts.pool
        .pending_requests
        .checked_sub(1)
        .ok_or(AuddShieldError::Overflow)?;

    emit!(RequestCancelled {
        pool:    ctx.accounts.pool.key(),
        request: ctx.accounts.emergency_request.key(),
    });

    Ok(())
}

#[event]
pub struct RequestCancelled {
    pub pool:    Pubkey,
    pub request: Pubkey,
}
