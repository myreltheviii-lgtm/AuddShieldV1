use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::errors::AuddShieldError;
use crate::state::{EmergencyRequest, Member, Pool, RequestStatus};

#[derive(Accounts)]
pub struct ReleaseFunds<'info> {
    /// Anyone can call this — permissionless once the deadline passes.
    /// Ensures liveness: funds cannot be held hostage if admin disappears.
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(mut)]
    pub pool: Account<'info, Pool>,

    #[account(
        mut,
        constraint = emergency_request.pool   == pool.key()             @ AuddShieldError::NotAMember,
        constraint = emergency_request.status == RequestStatus::Pending  @ AuddShieldError::RequestAlreadySettled,
    )]
    pub emergency_request: Account<'info, EmergencyRequest>,

    /// Requester's member account — needed to clear their pending request flag
    #[account(
        mut,
        seeds = [b"member", pool.key().as_ref(), emergency_request.requester.as_ref()],
        bump = requester_member.bump,
    )]
    pub requester_member: Account<'info, Member>,

    /// Pool's AUDD vault (source of funds on approval)
    #[account(
        mut,
        address = pool.vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Requester's AUDD token account (destination on approval)
    #[account(
        mut,
        constraint = requester_token_account.owner == emergency_request.requester @ AuddShieldError::NotAMember,
        constraint = requester_token_account.mint  == pool.audd_mint              @ AuddShieldError::NotAMember,
    )]
    pub requester_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ReleaseFunds>) -> Result<()> {
    let clock = Clock::get()?;

    // Voting window must have closed before settlement
    require!(
        clock.unix_timestamp > ctx.accounts.emergency_request.voting_deadline,
        AuddShieldError::VotingStillOpen
    );

    // ── Capture all fields needed from pool and request into locals ───────
    // This must happen BEFORE any mutable borrows via ctx.accounts.pool or
    // ctx.accounts.emergency_request. Rust's borrow checker enforces that
    // a mutable borrow (e.g., pool.total_balance -= amount) cannot coexist
    // with an immutable borrow used in the CPI seed slice below.
    //
    // pool_name requires a clone because String is not Copy and its bytes are
    // needed for the pool PDA signer seeds. This allocation is intentional and
    // acceptable — release_funds is called once per request lifecycle, never
    // on a per-slot hot path.
    let pool_bump            = ctx.accounts.pool.bump;
    let pool_admin           = ctx.accounts.pool.admin;           // Pubkey is Copy
    let pool_name            = ctx.accounts.pool.name.clone();    // must own for seed lifetime
    let amount               = ctx.accounts.emergency_request.amount_requested;
    let requester            = ctx.accounts.emergency_request.requester;
    let request_key          = ctx.accounts.emergency_request.key();
    let effective_threshold  = ctx.accounts.emergency_request.effective_threshold;
    let yes_weight           = ctx.accounts.emergency_request.yes_weight;
    let no_weight            = ctx.accounts.emergency_request.no_weight;
    let yes_votes            = ctx.accounts.emergency_request.yes_votes;
    let no_votes             = ctx.accounts.emergency_request.no_votes;

    // ── Weighted approval check ───────────────────────────────────────────
    // Approval uses weighted votes, not raw vote counts.
    // Zero total weight (nobody voted) → Expired rather than Rejected,
    // distinguishing community disengagement from an active rejection.
    //
    // Uses integer arithmetic: yes_weight * 100 / total_weight.
    // Integer division floors, which is deliberately conservative — a request
    // at exactly the threshold boundary rounds down and is therefore rejected
    // unless it genuinely clears the bar.
    let total_weight = yes_weight
        .checked_add(no_weight)
        .ok_or(AuddShieldError::Overflow)?;

    let approved = total_weight > 0 && {
        let yes_pct = yes_weight
            .checked_mul(100)
            .ok_or(AuddShieldError::Overflow)?
            .checked_div(total_weight)
            .ok_or(AuddShieldError::Overflow)?;
        yes_pct >= effective_threshold as u64
    };

    if approved {
        // Re-verify pool has sufficient balance at settlement time.
        // Multiple concurrent approved requests could have reduced the balance
        // since this request was originally submitted. The check at submit_request
        // time is a preliminary guard; this is the authoritative check.
        require!(
            amount <= ctx.accounts.pool.total_balance,
            AuddShieldError::InsufficientPoolBalance
        );

        // The pool PDA is the vault's token authority — sign the transfer CPI
        // using pool PDA seeds only. The vault's own bump is not needed because
        // the vault's authority is the pool PDA, not the vault PDA itself.
        let pool_seeds: &[&[u8]] = &[
            b"pool",
            pool_admin.as_ref(),
            pool_name.as_bytes(),
            &[pool_bump],
        ];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from:      ctx.accounts.vault.to_account_info(),
                    to:        ctx.accounts.requester_token_account.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[pool_seeds],
            ),
            amount,
        )?;

        // pool_seeds borrow ends here. Mutable pool field writes are now safe.
        ctx.accounts.pool.total_balance = ctx.accounts.pool
            .total_balance
            .checked_sub(amount)
            .ok_or(AuddShieldError::Overflow)?;

        ctx.accounts.emergency_request.status = RequestStatus::Approved;

        emit!(FundsReleased {
            pool: ctx.accounts.pool.key(),
            request: request_key,
            requester,
            amount,
        });
    } else {
        // Distinguish the two failure modes so the UI can explain them correctly.
        // Rejected = community actively voted against it.
        // Expired  = nobody voted within the 5-day window.
        ctx.accounts.emergency_request.status = if total_weight == 0 {
            RequestStatus::Expired
        } else {
            RequestStatus::Rejected
        };

        emit!(RequestRejected {
            pool:      ctx.accounts.pool.key(),
            request:   request_key,
            requester,
            yes_votes,
            no_votes,
            yes_weight,
            no_weight,
        });
    }

    // Always clear the requester's pending flag and pool counter regardless of outcome
    ctx.accounts.requester_member.has_pending_request = false;
    ctx.accounts.pool.pending_requests = ctx.accounts.pool
        .pending_requests
        .checked_sub(1)
        .ok_or(AuddShieldError::Overflow)?;

    Ok(())
}

#[event]
pub struct FundsReleased {
    pub pool:      Pubkey,
    pub request:   Pubkey,
    pub requester: Pubkey,
    pub amount:    u64,
}

#[event]
pub struct RequestRejected {
    pub pool:       Pubkey,
    pub request:    Pubkey,
    pub requester:  Pubkey,
    pub yes_votes:  u16,
    pub no_votes:   u16,
    pub yes_weight: u64,
    pub no_weight:  u64,
}
