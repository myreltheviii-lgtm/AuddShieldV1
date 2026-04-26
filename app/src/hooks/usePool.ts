import { useEffect, useState, useCallback } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getProvider, getProgram, getMemberPda, getRequestPda } from "../utils/anchor";
import { PROGRAM_ID } from "../utils/audd";

// ── Data types mirroring on-chain state ──────────────────────────────────────

export interface PoolData {
  pubkey:                    PublicKey;
  admin:                     PublicKey;
  name:                      string;
  auddMint:                  PublicKey;
  vault:                     PublicKey;
  minContribution:           number;
  totalBalance:              number;
  totalContributedAllTime:   number;
  memberCount:               number;
  maxMembers:                number;
  voteThresholdPct:          number;
  contributionIntervalDays:  number;
  totalRequests:             number;
  pendingRequests:           number;
  createdAt:                 number;
  isActive:                  boolean;
  maxRequestPct:             number;
}

export interface MemberData {
  pubkey:                PublicKey;
  pool:                  PublicKey;
  wallet:                PublicKey;
  totalContributed:      number;
  lastContributionAt:    number;
  votesCast:             number;
  joinedAt:              number;
  isActive:              boolean;
  hasPendingRequest:     boolean;
  contributionStreak:    number;
  reputationScore:       number;
}

export type RequestStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export interface RequestData {
  pubkey:             PublicKey;
  pool:               PublicKey;
  requester:          PublicKey;
  amountRequested:    number;
  reason:             string;
  evidenceUri:        string;
  yesVotes:           number;
  noVotes:            number;
  yesWeight:          number;
  noWeight:           number;
  status:             RequestStatus;
  submittedAt:        number;
  votingDeadline:     number;
  requestIndex:       number;
  effectiveThreshold: number;
}

// ── Status coercion ──────────────────────────────────────────────────────────
// Anchor deserialises enum variants as objects: { pending: {} }, { approved: {} }, etc.

function coerceStatus(raw: Record<string, unknown>): RequestStatus {
  if ("pending"   in raw) return "pending";
  if ("approved"  in raw) return "approved";
  if ("rejected"  in raw) return "rejected";
  if ("expired"   in raw) return "expired";
  if ("cancelled" in raw) return "cancelled";
  return "expired";
}

// ── Hook ─────────────────────────────────────────────────────────────────────

interface UsePoolResult {
  pool:     PoolData | null;
  member:   MemberData | null;
  requests: RequestData[];
  loading:  boolean;
  error:    string | null;
  refetch:  () => void;
}

export function usePool(poolPubkey: PublicKey | null): UsePoolResult {
  const { connection } = useConnection();
  const wallet         = useAnchorWallet();

  const [pool,     setPool]     = useState<PoolData | null>(null);
  const [member,   setMember]   = useState<MemberData | null>(null);
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!poolPubkey || !wallet) return;

    setLoading(true);
    setError(null);

    try {
      const idl      = await import("../idl/auddshield.json");
      const provider = getProvider(connection, wallet);
      const program  = getProgram(provider, idl as any);

      // ── Pool account ───────────────────────────────────────────────────
      const rawPool = await (program.account as any).pool.fetch(poolPubkey);

      const poolData: PoolData = {
        pubkey:                   poolPubkey,
        admin:                    rawPool.admin as PublicKey,
        name:                     rawPool.name  as string,
        auddMint:                 rawPool.auddMint as PublicKey,
        vault:                    rawPool.vault    as PublicKey,
        minContribution:          (rawPool.minContribution as any).toNumber(),
        totalBalance:             (rawPool.totalBalance    as any).toNumber(),
        totalContributedAllTime:  (rawPool.totalContributedAllTime as any).toNumber(),
        memberCount:              rawPool.memberCount   as number,
        maxMembers:               rawPool.maxMembers    as number,
        voteThresholdPct:         rawPool.voteThresholdPct as number,
        contributionIntervalDays: rawPool.contributionIntervalDays as number,
        totalRequests:            rawPool.totalRequests  as number,
        pendingRequests:          rawPool.pendingRequests as number,
        createdAt:                (rawPool.createdAt as any).toNumber(),
        isActive:                 rawPool.isActive    as boolean,
        maxRequestPct:            rawPool.maxRequestPct as number,
      };
      setPool(poolData);

      // ── Member account (may not exist if not joined) ───────────────────
      const [memberPda] = getMemberPda(poolPubkey, wallet.publicKey, PROGRAM_ID);
      const memberResult = await (program.account as any).member
        .fetchNullable(memberPda)
        .catch(() => null);

      if (memberResult) {
        setMember({
          pubkey:             memberPda,
          pool:               memberResult.pool       as PublicKey,
          wallet:             memberResult.wallet      as PublicKey,
          totalContributed:   (memberResult.totalContributed as any).toNumber(),
          lastContributionAt: (memberResult.lastContributionAt as any).toNumber(),
          votesCast:          memberResult.votesCast   as number,
          joinedAt:           (memberResult.joinedAt   as any).toNumber(),
          isActive:           memberResult.isActive    as boolean,
          hasPendingRequest:  memberResult.hasPendingRequest as boolean,
          contributionStreak: memberResult.contributionStreak as number,
          reputationScore:    memberResult.reputationScore    as number,
        });
      } else {
        setMember(null);
      }

      // ── Request accounts — fetch all in parallel ───────────────────────
      // Builds every request PDA address from the sequential index, then fetches
      // all of them in one Promise.allSettled round. This avoids N sequential
      // RPCs, and allSettled means a single missing/broken account doesn't abort
      // the rest of the fetch.
      if (rawPool.totalRequests > 0) {
        const requestPdas: PublicKey[] = Array.from(
          { length: rawPool.totalRequests as number },
          (_, i) => getRequestPda(poolPubkey, i, PROGRAM_ID)[0]
        );

        const results = await Promise.allSettled(
          requestPdas.map((pda) =>
            (program.account as any).emergencyRequest.fetch(pda)
          )
        );

        const fetchedRequests: RequestData[] = results
          .map((result, i) => {
            if (result.status !== "fulfilled") return null;
            const r = result.value;
            return {
              pubkey:             requestPdas[i],
              pool:               r.pool       as PublicKey,
              requester:          r.requester  as PublicKey,
              amountRequested:    (r.amountRequested as any).toNumber(),
              reason:             r.reason     as string,
              evidenceUri:        r.evidenceUri as string,
              yesVotes:           r.yesVotes   as number,
              noVotes:            r.noVotes    as number,
              yesWeight:          (r.yesWeight as any).toNumber(),
              noWeight:           (r.noWeight  as any).toNumber(),
              status:             coerceStatus(r.status as Record<string, unknown>),
              submittedAt:        (r.submittedAt    as any).toNumber(),
              votingDeadline:     (r.votingDeadline as any).toNumber(),
              requestIndex:       r.requestIndex    as number,
              effectiveThreshold: r.effectiveThreshold as number,
            } as RequestData;
          })
          .filter((r): r is RequestData => r !== null);

        // Most recent first
        fetchedRequests.sort((a, b) => b.submittedAt - a.submittedAt);
        setRequests(fetchedRequests);
      } else {
        setRequests([]);
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to load pool");
    } finally {
      setLoading(false);
    }
  }, [poolPubkey, wallet, connection]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { pool, member, requests, loading, error, refetch: fetch };
}
