use anchor_lang::prelude::*;

#[error_code]
pub enum AuddShieldError {
    // ─── Pool configuration ───────────────────────────────────────────────
    #[msg("Pool name too long — max 32 bytes (Solana PDA seed limit)")]
    NameTooLong,                    // 6000

    #[msg("Pool admin cannot leave their own pool")]
    AdminCannotLeave,               // 6001

    #[msg("Pool is full — maximum members reached")]
    PoolFull,                       // 6002

    #[msg("Pool is not accepting new members")]
    PoolInactive,                   // 6003

    #[msg("You are already a member of this pool")]
    AlreadyMember,                  // 6004

    // ─── Membership ───────────────────────────────────────────────────────
    #[msg("You are not a member of this pool")]
    NotAMember,                     // 6005

    #[msg("Contribution amount is below the pool minimum")]
    ContributionTooLow,             // 6006

    // ─── Emergency requests ───────────────────────────────────────────────
    #[msg("You already have a pending emergency request")]
    AlreadyHasPendingRequest,       // 6007

    #[msg("Requested amount exceeds the pool balance")]
    InsufficientPoolBalance,        // 6008

    #[msg("Emergency reason too long — max 200 characters")]
    ReasonTooLong,                  // 6009

    #[msg("Evidence URI too long — max 100 characters")]
    EvidenceUriTooLong,             // 6010

    // ─── Voting ───────────────────────────────────────────────────────────
    #[msg("This request is no longer open for voting")]
    VotingClosed,                   // 6011

    /// Kept for IDL/SDK compatibility — on-chain prevention is via init constraint,
    /// not this error. The init constraint fires before the handler and produces
    /// an account-already-exists error which is equally clear to clients.
    #[msg("You have already voted on this request")]
    AlreadyVoted,                   // 6012

    #[msg("You cannot vote on your own emergency request")]
    CannotVoteOnOwnRequest,         // 6013

    /// Kept for IDL/SDK compatibility — currently unused on-chain.
    #[msg("This request has not been resolved yet")]
    RequestStillPending,            // 6014

    // ─── Validation ───────────────────────────────────────────────────────
    #[msg("Vote threshold percentage must be between 1 and 100")]
    InvalidVoteThreshold,           // 6015

    #[msg("Max members must be between 2 and 500")]
    InvalidMaxMembers,              // 6016

    #[msg("Minimum contribution must be greater than zero")]
    InvalidMinContribution,         // 6017

    #[msg("Voting deadline has not passed yet — wait for the 5-day window to close")]
    VotingStillOpen,                // 6018

    #[msg("Arithmetic overflow")]
    Overflow,                       // 6019

    // ─── Protocol-grade additions ─────────────────────────────────────────
    #[msg("Only the pool admin can perform this action")]
    NotAdmin,                       // 6020

    #[msg("Emergency request amount must be greater than zero")]
    InvalidRequestAmount,           // 6021

    #[msg("Max request percentage must be between 1 and 100")]
    InvalidRequestCap,              // 6022

    #[msg("Requested amount exceeds the per-request cap set by this pool")]
    RequestExceedsCap,              // 6023

    #[msg("Member is delinquent on contributions — contribute to regain voting rights")]
    MemberDelinquent,               // 6024

    #[msg("Cannot reduce max members below current member count")]
    MaxMembersBelowCurrent,         // 6025

    #[msg("Only the original requester can cancel this request")]
    NotRequester,                   // 6026

    #[msg("This request has already been settled or cancelled")]
    RequestAlreadySettled,          // 6027

    #[msg("Token account mint does not match the pool's AUDD mint")]
    InvalidTokenMint,               // 6028 — caller passed a non-AUDD token account
}
