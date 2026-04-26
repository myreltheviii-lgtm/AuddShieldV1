use anchor_lang::prelude::*;

/// The central account for a community emergency pool.
/// Holds configuration, balances, and pool-level metadata.
#[account]
pub struct Pool {
    /// Pool creator / admin — also the only account that cannot call leave_pool
    pub admin: Pubkey,

    /// Human-readable name for the pool (max 32 bytes — Solana PDA seed component limit)
    pub name: String,

    /// AUDD token mint address
    pub audd_mint: Pubkey,

    /// The pool's AUDD token vault (ATA whose authority is this pool PDA)
    pub vault: Pubkey,

    /// Minimum AUDD contribution per interval (in base units, 6 decimals)
    pub min_contribution: u64,

    /// Total AUDD currently locked in the vault
    pub total_balance: u64,

    /// Total AUDD ever contributed across all members, all time
    pub total_contributed_all_time: u64,

    /// Total number of members currently in the pool (including admin)
    pub member_count: u16,

    /// Maximum allowed members (2–500)
    pub max_members: u16,

    /// Percentage of weighted yes votes required to approve a request (1–100)
    pub vote_threshold_pct: u8,

    /// How many days between required member contributions (0 = no enforcement)
    pub contribution_interval_days: u16,

    /// Sequential count of emergency requests ever submitted to this pool
    pub total_requests: u32,

    /// Number of emergency requests currently in Pending status.
    /// u16 because max_members is 500 — u8 would overflow if all members
    /// submitted simultaneously (500 > u8::MAX of 255).
    pub pending_requests: u16,

    /// Unix timestamp when pool was created
    pub created_at: i64,

    /// Whether the pool is currently accepting new members and requests
    pub is_active: bool,

    /// PDA bump for this account
    pub bump: u8,

    /// Maximum percentage of pool balance a single request may ask for (1–100).
    /// Prevents any single request from draining the pool in one vote.
    pub max_request_pct: u8,
}

impl Pool {
    /// Account space: discriminator + all fields.
    /// Name is heap-allocated String with a 4-byte length prefix plus max 32 bytes of content.
    pub const LEN: usize = 8
        + 32        // admin
        + 4 + 32    // name (max 32 bytes — Solana PDA seed component hard limit)
        + 32        // audd_mint
        + 32        // vault
        + 8         // min_contribution
        + 8         // total_balance
        + 8         // total_contributed_all_time
        + 2         // member_count
        + 2         // max_members
        + 1         // vote_threshold_pct
        + 2         // contribution_interval_days
        + 4         // total_requests
        + 2         // pending_requests (u16 — max_members 500 exceeds u8 max of 255)
        + 8         // created_at
        + 1         // is_active
        + 1         // bump
        + 1;        // max_request_pct
}
