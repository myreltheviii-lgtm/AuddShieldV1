use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::errors::AuddShieldError;
use crate::state::{Member, Pool};

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(mut)]
    pub pool: Account<'info, Pool>,

    /// Member account — must belong to this pool and this wallet
    #[account(
        mut,
        seeds = [b"member", pool.key().as_ref(), contributor.key().as_ref()],
        bump = member.bump,
        constraint = member.is_active @ AuddShieldError::NotAMember,
    )]
    pub member: Account<'info, Member>,

    /// Member's AUDD token account (source of funds)
    #[account(
        mut,
        constraint = member_token_account.mint  == pool.audd_mint       @ AuddShieldError::InvalidTokenMint,
        constraint = member_token_account.owner == contributor.key()    @ AuddShieldError::NotAMember,
    )]
    pub member_token_account: Account<'info, TokenAccount>,

    /// Pool's AUDD vault (destination of funds)
    #[account(
        mut,
        address = pool.vault,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Contribute>, amount: u64) -> Result<()> {
    require!(
        amount >= ctx.accounts.pool.min_contribution,
        AuddShieldError::ContributionTooLow
    );

    let clock = Clock::get()?;

    // Transfer AUDD from member wallet to vault via SPL Token CPI
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from:      ctx.accounts.member_token_account.to_account_info(),
                to:        ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.contributor.to_account_info(),
            },
        ),
        amount,
    )?;

    let pool   = &mut ctx.accounts.pool;
    let member = &mut ctx.accounts.member;

    pool.total_balance = pool
        .total_balance
        .checked_add(amount)
        .ok_or(AuddShieldError::Overflow)?;
    pool.total_contributed_all_time = pool
        .total_contributed_all_time
        .checked_add(amount)
        .ok_or(AuddShieldError::Overflow)?;

    member.total_contributed = member
        .total_contributed
        .checked_add(amount)
        .ok_or(AuddShieldError::Overflow)?;

    // ── Contribution streak and reputation ────────────────────────────────
    // Streak tracks how many consecutive intervals the member has contributed
    // on time. A zero contribution_interval_days means no enforcement —
    // streak tracking is skipped entirely.
    if pool.contribution_interval_days > 0 {
        let interval_secs = pool.contribution_interval_days as i64 * 24 * 60 * 60;

        if member.last_contribution_at == 0 {
            // First contribution ever — streak begins
            member.contribution_streak = 1;
        } else if clock.unix_timestamp <= member.last_contribution_at.saturating_add(interval_secs) {
            // Contributed within the current interval window — extend streak
            member.contribution_streak = member.contribution_streak.saturating_add(1);
        } else {
            // Late contribution — streak resets to 1 (they contributed, just late)
            member.contribution_streak = 1;
        }

        // Reputation bonus: streak value added per on-time contribution.
        // Saturating prevents wrapping on long-lived high-activity members.
        member.reputation_score = member
            .reputation_score
            .saturating_add(member.contribution_streak as u32);
    }

    member.last_contribution_at = clock.unix_timestamp;

    emit!(ContributionMade {
        pool:        pool.key(),
        contributor: ctx.accounts.contributor.key(),
        amount,
        pool_total:  pool.total_balance,
        streak:      member.contribution_streak,
    });

    Ok(())
}

#[event]
pub struct ContributionMade {
    pub pool:        Pubkey,
    pub contributor: Pubkey,
    pub amount:      u64,
    pub pool_total:  u64,
    pub streak:      u16,
}
