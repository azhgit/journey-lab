// CLAUDE-OWNED (M9). Staged rollout, SPEC §12. Each call gets a fixed bucket 0–99 from a hash of its id; buckets
// below CANDIDATE_PERCENT get the candidate journey. Same call id → same version (deterministic), and raising the
// percent only moves calls onto the candidate, never off it (monotonic), so a ramp never flips a caller back.
import { createHash } from "node:crypto";

export type Arm = "stable" | "candidate";

export function bucket(callId: string): number {
  const digest = createHash("sha256").update(callId).digest();
  return digest.readUInt32BE(0) % 100;
}

export function armFor(callId: string, candidatePercent: number): Arm {
  if (!Number.isInteger(candidatePercent) || candidatePercent < 0 || candidatePercent > 100) {
    throw new RangeError(`CANDIDATE_PERCENT must be an integer 0–100, got ${candidatePercent}`);
  }
  return bucket(callId) < candidatePercent ? "candidate" : "stable";
}

// Reads CANDIDATE_PERCENT; unset means 0 (everyone on stable). A bad value throws instead of guessing.
export function candidatePercentFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CANDIDATE_PERCENT;
  return raw === undefined || raw === "" ? 0 : Number(raw);
}
