use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum RequestStatus {
    /// Voting is open — request is accepting votes until voting_deadline
    Pending,
    /// Vote passed — funds have been released to the requester
    Approved,
    /// Vote failed — community voted no, funds were not released
    Rejected,
    /// Voting window expired with zero votes cast — request timed out
    Expired,
    /// Requester voluntarily withdrew the request before settlement
    Cancelled,
}

/// An emergency fund request submitted by a pool member.
#[account]
pub struct EmergencyRequest {
    /// The pool this request belongs to
    pub pool: Pubkey,

    /// The member requesting funds
    pub requester: Pubkey,

    /// Amount of AUDD requested (base units, 6 decimals)
    pub amount_requested: u64,

    /// Short description of the emergency (max 200 characters)
    pub reason: String,

    /// Optional URI to supporting evidence (IPFS hash, URL, etc.) — max 100 characters
    pub evidence_uri: String,

    /// Raw count of yes votes cast (regardless of weight)
    pub yes_votes: u16,

    /// Raw count of no votes cast (regardless of weight)
    pub no_votes: u16,

    /// Weighted sum of yes votes. Each voter contributes weight based on
    /// their contribution history relative to pool minimum.
    pub yes_weight: u64,

    /// Weighted sum of no votes.
    pub no_weight: u64,

    /// Current status of the request
    pub status: RequestStatus,

    /// Unix timestamp when request was submitted
    pub submitted_at: i64,

    /// Unix timestamp when voting closes
    pub voting_deadline: i64,

    /// Sequential request index within the pool — used as PDA seed
    pub request_index: u32,

    /// Vote threshold locked at submission time based on request size relative to pool.
    /// Larger requests face higher thresholds regardless of subsequent pool config changes.
    /// Low  (≤10% of pool): pool.vote_threshold_pct
    /// Mid  (≤30% of pool): max(pool.vote_threshold_pct, 60)
    /// High (>30% of pool): max(pool.vote_threshold_pct, 75)
    pub effective_threshold: u8,

    /// PDA bump for this account
    pub bump: u8,
}

impl EmergencyRequest {
    pub const LEN: usize = 8
        + 32        // pool
        + 32        // requester
        + 8         // amount_requested
        + 4 + 200   // reason (max 200 chars)
        + 4 + 100   // evidence_uri (max 100 chars)
        + 2         // yes_votes
        + 2         // no_votes
        + 8         // yes_weight
        + 8         // no_weight
        + 1         // status (enum — Anchor encodes fieldless variants as u8 discriminant)
        + 8         // submitted_at
        + 8         // voting_deadline
        + 4         // request_index
        + 1         // effective_threshold
        + 1;        // bump

    /// 5-day voting window
    pub const VOTING_WINDOW_SECS: i64 = 5 * 24 * 60 * 60;
}
