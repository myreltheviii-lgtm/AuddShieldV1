use anchor_lang::prelude::*;
use crate::errors::AuddShieldError;
use crate::state::Pool;

#[derive(Accounts)]
pub struct UpdatePoolConfig<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        constraint = pool.admin == admin.key() @ AuddShieldError::NotAdmin,
    )]
    pub pool: Account<'info, Pool>,
}

pub fn handler(
    ctx: Context<UpdatePoolConfig>,
    new_min_contribution: Option<u64>,
    new_vote_threshold_pct: Option<u8>,
    new_max_members: Option<u16>,
    new_contribution_interval_days: Option<u16>,
    new_max_request_pct: Option<u8>,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    if let Some(v) = new_min_contribution {
        require!(v > 0, AuddShieldError::InvalidMinContribution);
        pool.min_contribution = v;
    }

    if let Some(v) = new_vote_threshold_pct {
        require!(v >= 1 && v <= 100, AuddShieldError::InvalidVoteThreshold);
        pool.vote_threshold_pct = v;
    }

    if let Some(v) = new_max_members {
        require!(v >= 2 && v <= 500, AuddShieldError::InvalidMaxMembers);
        // Prevent shrinking below the current membership to avoid phantom members
        require!(v >= pool.member_count, AuddShieldError::MaxMembersBelowCurrent);
        pool.max_members = v;
    }

    if let Some(v) = new_contribution_interval_days {
        pool.contribution_interval_days = v;
    }

    if let Some(v) = new_max_request_pct {
        require!(v >= 1 && v <= 100, AuddShieldError::InvalidRequestCap);
        pool.max_request_pct = v;
    }

    emit!(PoolConfigUpdated {
        pool:                       pool.key(),
        admin:                      pool.admin,
        min_contribution:           pool.min_contribution,
        vote_threshold_pct:         pool.vote_threshold_pct,
        max_members:                pool.max_members,
        contribution_interval_days: pool.contribution_interval_days,
        max_request_pct:            pool.max_request_pct,
    });

    Ok(())
}

#[event]
pub struct PoolConfigUpdated {
    pub pool:                       Pubkey,
    pub admin:                      Pubkey,
    pub min_contribution:           u64,
    pub vote_threshold_pct:         u8,
    pub max_members:                u16,
    pub contribution_interval_days: u16,
    pub max_request_pct:            u8,
}
