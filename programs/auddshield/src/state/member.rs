use anchor_lang::prelude::*;

/// Per-member account tracking contributions, voting history, and reputation within a pool.
#[account]
pub struct Member {
    /// The pool this membership belongs to
    pub pool: Pubkey,

    /// Member's wallet address
    pub wallet: Pubkey,

    /// Total AUDD this member has contributed to the pool (base units, 6 decimals)
    pub total_contributed: u64,

    /// Unix timestamp of last contribution (0 if never contributed)
    pub last_contribution_at: i64,

    /// Total number of votes cast by this member across all requests
    pub votes_cast: u32,

    /// Unix timestamp when they joined the pool
    pub joined_at: i64,

    /// Whether this member is still active in the pool
    pub is_active: bool,

    /// Whether this member currently has a pending emergency request
    pub has_pending_request: bool,

    /// PDA bump for this account
    pub bump: u8,

    /// Number of consecutive contribution intervals met on time.
    /// Increments when a contribution arrives within the pool's interval window.
    /// Resets to 1 (not 0) on a late contribution — member contributed, just late.
    /// Used for voting weight bonus and reputation calculation.
    pub contribution_streak: u16,

    /// Cumulative reputation score. Increases with on-time contributions (streak bonus)
    /// and votes cast. Saturating — never wraps. Display-only in V1; reserved for
    /// future reward tiers and governance weight multipliers.
    pub reputation_score: u32,
}

impl Member {
    pub const LEN: usize = 8
        + 32    // pool
        + 32    // wallet
        + 8     // total_contributed
        + 8     // last_contribution_at
        + 4     // votes_cast
        + 8     // joined_at
        + 1     // is_active
        + 1     // has_pending_request
        + 1     // bump
        + 2     // contribution_streak
        + 4;    // reputation_score
}
