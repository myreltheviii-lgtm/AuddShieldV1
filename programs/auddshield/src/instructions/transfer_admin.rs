use anchor_lang::prelude::*;
use crate::errors::AuddShieldError;
use crate::state::{Member, Pool};

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        constraint = pool.admin == admin.key() @ AuddShieldError::NotAdmin,
    )]
    pub pool: Account<'info, Pool>,

    /// The incoming admin must already be a member of this pool.
    /// They cannot be promoted from outside — membership first, admin second.
    #[account(
        seeds = [b"member", pool.key().as_ref(), new_admin.key().as_ref()],
        bump = new_admin_member.bump,
        constraint = new_admin_member.is_active @ AuddShieldError::NotAMember,
    )]
    pub new_admin_member: Account<'info, Member>,

    /// CHECK: We only read the pubkey — no data validation needed beyond membership above
    pub new_admin: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<TransferAdmin>) -> Result<()> {
    let old_admin = ctx.accounts.pool.admin;
    ctx.accounts.pool.admin = ctx.accounts.new_admin.key();

    emit!(AdminTransferred {
        pool:      ctx.accounts.pool.key(),
        old_admin,
        new_admin: ctx.accounts.new_admin.key(),
    });

    Ok(())
}

#[event]
pub struct AdminTransferred {
    pub pool:      Pubkey,
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}
