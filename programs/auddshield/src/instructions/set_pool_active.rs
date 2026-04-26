use anchor_lang::prelude::*;
use crate::errors::AuddShieldError;
use crate::state::Pool;

#[derive(Accounts)]
pub struct SetPoolActive<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        constraint = pool.admin == admin.key() @ AuddShieldError::NotAdmin,
    )]
    pub pool: Account<'info, Pool>,
}

/// Circuit breaker — admin can pause the pool to block new joins and new requests.
/// Existing pending requests continue to be voted on and settled normally.
/// Re-activating is identical: call with is_active = true.
pub fn handler(ctx: Context<SetPoolActive>, is_active: bool) -> Result<()> {
    ctx.accounts.pool.is_active = is_active;

    emit!(PoolActiveChanged {
        pool:      ctx.accounts.pool.key(),
        is_active,
    });

    Ok(())
}

#[event]
pub struct PoolActiveChanged {
    pub pool:      Pubkey,
    pub is_active: bool,
}
