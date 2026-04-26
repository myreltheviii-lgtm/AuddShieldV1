use anchor_lang::prelude::*;
use crate::errors::AuddShieldError;
use crate::state::{EmergencyRequest, Member, Pool, RequestStatus};

#[derive(Accounts)]
#[instruction(amount_requested: u64, reason: String, evidence_uri: String)]
pub struct SubmitRequest<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,

    #[account(
        mut,
        constraint = pool.is_active @ AuddShieldError::PoolInactive,
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        seeds = [b"member", pool.key().as_ref(), requester.key().as_ref()],
        bump = member.bump,
        constraint = member.is_active           @ AuddShieldError::NotAMember,
        constraint = !member.has_pending_request @ AuddShieldError::AlreadyHasPendingRequest,
    )]
    pub member: Account<'info, Member>,

    /// Emergency request PDA — seeded by pool + request index.
    /// pool.total_requests is read before being incremented, giving index 0 for
    /// the first request, 1 for the second, and so on.
    #[account(
        init,
        payer = requester,
        space = EmergencyRequest::LEN,
        seeds = [
            b"request",
            pool.key().as_ref(),
            pool.total_requests.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub emergency_request: Account<'info, EmergencyRequest>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SubmitRequest>,
    amount_requested: u64,
    reason: String,
    evidence_uri: String,
) -> Result<()> {
    require!(reason.len() <= 200, AuddShieldError::ReasonTooLong);
    require!(evidence_uri.len() <= 100, AuddShieldError::EvidenceUriTooLong);

    // Zero-amount requests are nonsensical and would waste a PDA allocation
    require!(amount_requested > 0, AuddShieldError::InvalidRequestAmount);

    // Cannot request more than the pool currently holds
    require!(
        amount_requested <= ctx.accounts.pool.total_balance,
        AuddShieldError::InsufficientPoolBalance
    );

    // Per-request cap: no single request may exceed max_request_pct% of pool balance.
    // This prevents a single emergency from draining the entire community reserve.
    let max_requestable = ctx.accounts.pool
        .total_balance
        .checked_mul(ctx.accounts.pool.max_request_pct as u64)
        .ok_or(AuddShieldError::Overflow)?
        .checked_div(100)
        .ok_or(AuddShieldError::Overflow)?;
    require!(amount_requested <= max_requestable, AuddShieldError::RequestExceedsCap);

    let clock = Clock::get()?;
    let pool   = &mut ctx.accounts.pool;
    let member = &mut ctx.accounts.member;
    let request = &mut ctx.accounts.emergency_request;

    // Compute the effective vote threshold and lock it into the request.
    // Higher-value requests face a more demanding threshold — this is calculated
    // once at submission time so subsequent pool config changes cannot retroactively
    // alter a pending request's approval bar.
    //
    // Division is safe: total_balance > 0 because amount_requested > 0 and
    // amount_requested <= total_balance, therefore total_balance >= 1.
    let pct_of_pool = amount_requested
        .checked_mul(100)
        .ok_or(AuddShieldError::Overflow)?
        / pool.total_balance;

    let effective_threshold: u8 = if pct_of_pool <= 10 {
        // Low-tier: uses pool's configured threshold as-is
        pool.vote_threshold_pct
    } else if pct_of_pool <= 30 {
        // Mid-tier: at least 60% approval required
        pool.vote_threshold_pct.max(60)
    } else {
        // High-tier: at least 75% approval required
        pool.vote_threshold_pct.max(75)
    };

    request.pool              = pool.key();
    request.requester         = ctx.accounts.requester.key();
    request.amount_requested  = amount_requested;
    request.reason            = reason;
    request.evidence_uri      = evidence_uri;
    request.yes_votes         = 0;
    request.no_votes          = 0;
    request.yes_weight        = 0;
    request.no_weight         = 0;
    request.status            = RequestStatus::Pending;
    request.submitted_at      = clock.unix_timestamp;
    request.voting_deadline   = clock
        .unix_timestamp
        .checked_add(EmergencyRequest::VOTING_WINDOW_SECS)
        .ok_or(AuddShieldError::Overflow)?;
    request.request_index     = pool.total_requests;
    request.effective_threshold = effective_threshold;
    request.bump              = ctx.bumps.emergency_request;

    pool.total_requests   = pool.total_requests.checked_add(1).ok_or(AuddShieldError::Overflow)?;
    pool.pending_requests = pool.pending_requests.checked_add(1).ok_or(AuddShieldError::Overflow)?;

    member.has_pending_request = true;

    emit!(RequestSubmitted {
        pool:               pool.key(),
        request:            request.key(),
        requester:          ctx.accounts.requester.key(),
        amount_requested,
        voting_deadline:    request.voting_deadline,
        effective_threshold,
    });

    Ok(())
}

#[event]
pub struct RequestSubmitted {
    pub pool:                Pubkey,
    pub request:             Pubkey,
    pub requester:           Pubkey,
    pub amount_requested:    u64,
    pub voting_deadline:     i64,
    pub effective_threshold: u8,
}
