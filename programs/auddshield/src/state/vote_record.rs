use anchor_lang::prelude::*;

/// Tracks that a specific member has voted on a specific request.
/// PDA derived from [b"vote", request_pubkey, voter_pubkey] — one per (voter, request) pair.
/// The existence of this account prevents double-voting at the constraint level:
/// attempting to init an already-existing PDA fails before the handler runs.
#[account]
pub struct VoteRecord {
    /// The request this vote was cast on
    pub request: Pubkey,

    /// The member who cast this vote
    pub voter: Pubkey,

    /// Whether they voted yes (approve)
    pub approved: bool,

    /// Unix timestamp when the vote was cast
    pub voted_at: i64,

    /// Voting weight at time of cast — floor(total_contributed / min_contribution),
    /// clamped to [1, MAX_VOTE_WEIGHT]. Stored so historical votes are auditable
    /// even after pool config changes that would alter future weight calculations.
    pub weight: u64,

    /// PDA bump for this account
    pub bump: u8,
}

impl VoteRecord {
    pub const LEN: usize = 8
        + 32    // request
        + 32    // voter
        + 1     // approved
        + 8     // voted_at
        + 8     // weight
        + 1;    // bump
}
