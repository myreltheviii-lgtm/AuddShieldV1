use anchor_lang::prelude::*;
use crate::errors::AuddShieldError;
use crate::state::{EmergencyRequest, Member, Pool, RequestStatus, VoteRecord};

/// Maximum voting weight per member.
/// Prevents whales from dominating governance while still rewarding consistent contributors.
/// Weight = floor(total_contributed / min_contribution), clamped to [1, MAX_VOTE_WEIGHT].
pub const MAX_VOTE_WEIGHT: u64 = 10;

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,

    pub pool: Account<'info, Pool>,

    /// Voter must be an active member of this pool
    #[account(
        mut,
        seeds = [b"member", pool.key().as_ref(), voter.key().as_ref()],
        bump = member.bump,
        constraint = member.is_active @ AuddShieldError::NotAMember,
    )]
    pub member: Account<'info, Member>,

    #[account(
        mut,
        constraint = emergency_request.pool   == pool.key()            @ AuddShieldError::NotAMember,
        constraint = emergency_request.status == RequestStatus::Pending @ AuddShieldError::VotingClosed,
        // Self-vote check MUST be here — not in the handler body.
        // If this constraint fires, it does so BEFORE the vote_record init below.
        // Placing this check in the handler instead would let the init run first,
        // creating a zombie VoteRecord PDA that permanently occupies the requester's
        // vote slot and wastes ~2900 lamports.
        constraint = emergency_request.requester != voter.key()        @ AuddShieldError::CannotVoteOnOwnRequest,
    )]
    pub emergency_request: Account<'info, EmergencyRequest>,

    /// Vote record PDA — ensures one vote per (voter, request) pair.
    /// The init constraint is the primary double-vote guard: attempting to init
    /// an account that already exists fails at account resolution, before the handler.
    #[account(
        init,
        payer = voter,
        space = VoteRecord::LEN,
        seeds = [b"vote", emergency_request.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote_record: Account<'info, VoteRecord>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Vote>, approve: bool) -> Result<()> {
    let clock   = Clock::get()?;
    let pool    = &ctx.accounts.pool;
    let request = &mut ctx.accounts.emergency_request;
    let member  = &mut ctx.accounts.member;

    // Voting window must still be open
    require!(
        clock.unix_timestamp <= request.voting_deadline,
        AuddShieldError::VotingClosed
    );

    // Delinquency check: members who have fallen behind on contributions lose voting rights.
    // A grace period equal to one full interval is given to new members (last_contribution_at == 0)
    // so they are not locked out the moment they join.
    if pool.contribution_interval_days > 0 {
        let interval_secs = pool.contribution_interval_days as i64 * 24 * 60 * 60;

        // Delinquency deadline: either one interval after last contribution,
        // or one interval after join date (for members who have never contributed).
        let delinquency_deadline = if member.last_contribution_at > 0 {
            member.last_contribution_at.saturating_add(interval_secs)
        } else {
            // Never contributed — grace period is one interval from join time
            member.joined_at.saturating_add(interval_secs)
        };

        require!(
            clock.unix_timestamp <= delinquency_deadline,
            AuddShieldError::MemberDelinquent
        );
    }

    // Compute voting weight.
    // min_contribution is enforced > 0 at pool creation, but we guard defensively.
    // A member who has never contributed still gets weight = 1 (if within grace period above).
    let weight: u64 = if pool.min_contribution == 0 {
        1
    } else {
        (member.total_contributed / pool.min_contribution)
            .max(1)
            .min(MAX_VOTE_WEIGHT)
    };

    // Record the vote
    let vote_record = &mut ctx.accounts.vote_record;
    vote_record.request  = request.key();
    vote_record.voter    = ctx.accounts.voter.key();
    vote_record.approved = approve;
    vote_record.voted_at = clock.unix_timestamp;
    vote_record.weight   = weight;
    vote_record.bump     = ctx.bumps.vote_record;

    // Tally both raw counts (for display) and weighted sums (for approval calculation)
    if approve {
        request.yes_votes  = request.yes_votes.checked_add(1).ok_or(AuddShieldError::Overflow)?;
        request.yes_weight = request.yes_weight.checked_add(weight).ok_or(AuddShieldError::Overflow)?;
    } else {
        request.no_votes   = request.no_votes.checked_add(1).ok_or(AuddShieldError::Overflow)?;
        request.no_weight  = request.no_weight.checked_add(weight).ok_or(AuddShieldError::Overflow)?;
    }

    member.votes_cast = member.votes_cast.checked_add(1).ok_or(AuddShieldError::Overflow)?;
    member.reputation_score = member.reputation_score.saturating_add(1);

    emit!(VoteCast {
        pool:       ctx.accounts.pool.key(),
        request:    request.key(),
        voter:      ctx.accounts.voter.key(),
        approve,
        weight,
        yes_votes:  request.yes_votes,
        no_votes:   request.no_votes,
        yes_weight: request.yes_weight,
        no_weight:  request.no_weight,
    });

    Ok(())
}

#[event]
pub struct VoteCast {
    pub pool:       Pubkey,
    pub request:    Pubkey,
    pub voter:      Pubkey,
    pub approve:    bool,
    pub weight:     u64,
    pub yes_votes:  u16,
    pub no_votes:   u16,
    pub yes_weight: u64,
    pub no_weight:  u64,
}
