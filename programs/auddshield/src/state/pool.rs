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

    /// Total AUDD currently accounted for by this pool — includes both liquid
    /// capital sitting in the vault AND capital deployed to yield strategies.
    /// Use compute_liquid_balance() from math.rs to get the spendable portion.
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

    // ─── V2 Treasury Fields ───────────────────────────────────────────────────
    //
    // These fields are initialised to zero by migrate_pool_v2 and remain
    // inert until init_treasury_config is called. All V1 instructions that
    // do not touch the treasury layer are unaffected by their presence.

    /// AUDD currently deployed to external yield protocols (Kamino, MarginFi).
    /// This capital is owned by the pool but NOT instantly available for payouts.
    /// It must be recalled before it can be transferred to a claimant.
    ///
    /// Invariant: treasury_deployed <= total_balance at all times.
    /// The difference (total_balance - treasury_deployed) is the liquid balance.
    pub treasury_deployed: u64,

    /// Sum of amount_requested across all currently Pending emergency requests.
    /// This capital is "spoken for" by active community votes and cannot be
    /// deployed to yield strategies — doing so would risk being unable to pay
    /// an approved claim without an emergency recall.
    ///
    /// Updated in:
    ///   submit_request  → += amount_requested
    ///   cancel_request  → -= amount_requested
    ///   release_funds   → -= amount_requested (on any outcome)
    pub pending_claims_total: u64,

    /// Basis points of total_balance that must remain liquid at all times.
    /// 2000 = 20%. Valid range: 500 (5%) to 9000 (90%).
    ///
    /// Stored in basis points rather than whole percent so small pools can
    /// express fractional reserve requirements precisely. The difference
    /// between 15% and 16% of a 500 AUDD pool is 5 AUDD — meaningful for
    /// small community pools.
    pub treasury_reserve_bps: u16,

    /// Cumulative AUDD yield harvested back into the vault across all
    /// strategies since the pool was created. Monotonically increasing —
    /// never decremented. Used as an audit trail and for APY estimation.
    pub yield_earned_all_time: u64,

    /// Guard flag preventing treasury operations before init_treasury_config
    /// is called. deploy_to_strategy and recall_from_strategy both require
    /// this to be true. Prevents accidental deployment to an uninitialised
    /// strategy config.
    pub treasury_initialized: bool,

    /// Reserved bytes for future V2 fields (tranche architecture, reinsurance).
    /// Pre-allocated to avoid a second realloc migration when Phase 2 lands.
    /// 32 bytes = enough for 4 u64 fields or 1 Pubkey.
    pub _reserved: [u8; 32],
}

impl Pool {
    /// Account space: discriminator + all fields.
    /// Name is heap-allocated String with a 4-byte length prefix plus max 32 bytes of content.
    ///
    /// V1 fields: 158 bytes (unchanged)
    /// V2 fields: +27 bytes (treasury_deployed, pending_claims_total,
    ///             treasury_reserve_bps, yield_earned_all_time, treasury_initialized)
    /// Reserved:  +32 bytes (pre-allocated for Phase 2 fields)
    /// Total:      217 bytes
    pub const LEN: usize = 8
        // ── V1 fields ────────────────────────────────────────────────────
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
        + 1         // max_request_pct
        // ── V2 treasury fields ───────────────────────────────────────────
        + 8         // treasury_deployed
        + 8         // pending_claims_total
        + 2         // treasury_reserve_bps
        + 8         // yield_earned_all_time
        + 1         // treasury_initialized
        // ── Phase 2 reservation ──────────────────────────────────────────
        + 32;       // _reserved — pre-allocated for tranche/reinsurance fields
}
