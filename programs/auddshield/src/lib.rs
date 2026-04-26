use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod auddshield {
    use super::*;

    // ── Pool lifecycle ────────────────────────────────────────────────────

    /// Create a new community emergency pool with an AUDD vault.
    /// Admin is automatically enrolled as the first member (member_count = 1).
    pub fn create_pool(
        ctx: Context<CreatePool>,
        name: String,
        min_contribution: u64,
        vote_threshold_pct: u8,
        max_members: u16,
        contribution_interval_days: u16,
        max_request_pct: u8,
    ) -> Result<()> {
        instructions::create_pool::handler(
            ctx,
            name,
            min_contribution,
            vote_threshold_pct,
            max_members,
            contribution_interval_days,
            max_request_pct,
        )
    }

    /// Join an existing active pool. Cannot join a full or inactive pool.
    pub fn join_pool(ctx: Context<JoinPool>) -> Result<()> {
        instructions::join_pool::handler(ctx)
    }

    /// Leave the pool. Closes the member account and refunds rent.
    /// Blocked if: admin, or has a pending request.
    pub fn leave_pool(ctx: Context<LeavePool>) -> Result<()> {
        instructions::leave_pool::handler(ctx)
    }

    // ── Admin controls ────────────────────────────────────────────────────

    /// Transfer admin role to another existing pool member.
    /// The recipient must already be a pool member before promotion.
    pub fn transfer_admin(ctx: Context<TransferAdmin>) -> Result<()> {
        instructions::transfer_admin::handler(ctx)
    }

    /// Update mutable pool configuration parameters. All fields are optional.
    /// Changes apply to future requests only — existing pending requests retain
    /// their locked effective_threshold.
    pub fn update_pool_config(
        ctx: Context<UpdatePoolConfig>,
        new_min_contribution: Option<u64>,
        new_vote_threshold_pct: Option<u8>,
        new_max_members: Option<u16>,
        new_contribution_interval_days: Option<u16>,
        new_max_request_pct: Option<u8>,
    ) -> Result<()> {
        instructions::update_pool_config::handler(
            ctx,
            new_min_contribution,
            new_vote_threshold_pct,
            new_max_members,
            new_contribution_interval_days,
            new_max_request_pct,
        )
    }

    /// Pause or resume the pool. Paused pools reject new joins and new requests.
    /// Existing pending requests are unaffected.
    pub fn set_pool_active(ctx: Context<SetPoolActive>, is_active: bool) -> Result<()> {
        instructions::set_pool_active::handler(ctx, is_active)
    }

    // ── Contributions ─────────────────────────────────────────────────────

    /// Deposit AUDD into the pool vault. Tracks streaks and reputation.
    pub fn contribute(ctx: Context<Contribute>, amount: u64) -> Result<()> {
        instructions::contribute::handler(ctx, amount)
    }

    // ── Emergency requests ────────────────────────────────────────────────

    /// Submit an emergency fund request. Opens a 5-day community vote.
    pub fn submit_request(
        ctx: Context<SubmitRequest>,
        amount_requested: u64,
        reason: String,
        evidence_uri: String,
    ) -> Result<()> {
        instructions::submit_request::handler(ctx, amount_requested, reason, evidence_uri)
    }

    /// Cancel an open emergency request before it is settled.
    /// Only the original requester may cancel.
    pub fn cancel_request(ctx: Context<CancelRequest>) -> Result<()> {
        instructions::cancel_request::handler(ctx)
    }

    // ── Voting ────────────────────────────────────────────────────────────

    /// Cast a weighted yes/no vote on a pending emergency request.
    pub fn vote(ctx: Context<Vote>, approve: bool) -> Result<()> {
        instructions::vote::handler(ctx, approve)
    }

    // ── Settlement ────────────────────────────────────────────────────────

    /// Settle a request after the voting deadline.
    /// Permissionless — anyone can call this for liveness guarantees.
    pub fn release_funds(ctx: Context<ReleaseFunds>) -> Result<()> {
        instructions::release_funds::handler(ctx)
    }
}
