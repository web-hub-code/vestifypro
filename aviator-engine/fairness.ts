import { createHash, createHmac, randomBytes } from "node:crypto";

// Provably fair crash generation.
//
// Before a round opens for bets, the server picks a random 32-byte seed and
// publishes only sha256(seed). After the plane crashes the seed itself is
// revealed, so anyone can check that:
//   1. sha256(serverSeed) === seedHash published before betting, and
//   2. the crash point below is reproduced from the seed.
// The crash point is one value for the whole round and is fixed before any bet
// is accepted, so it cannot be changed for (or against) individual players.

export function newServerSeed(): { serverSeed: string; seedHash: string } {
  const serverSeed = randomBytes(32).toString("hex");
  return { serverSeed, seedHash: sha256Hex(serverSeed) };
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * crash = floor(100 * RTP / (1 - r)) / 100, clamped to [1.00, maxMultiplier]
 * where r is the first 52 bits of HMAC_SHA256(key = serverSeed, msg = roundNumber) / 2^52.
 * This gives P(crash >= x) = RTP / x, so every cash-out target has the same
 * expected return (the published RTP).
 */
export function crashPointFromSeed(
  serverSeed: string,
  roundNumber: number,
  rtp: number,
  maxMultiplier: number,
): number {
  const hex = createHmac("sha256", serverSeed).update(String(roundNumber)).digest("hex");
  const r = parseInt(hex.slice(0, 13), 16) / 2 ** 52;
  const raw = Math.floor((rtp * 100) / (1 - r)) / 100;
  return Math.min(maxMultiplier, Math.max(1, raw));
}

/** Multiplier shown after `elapsedMs` of flight: e^(k·t), floored to cents. */
export function multiplierAt(elapsedMs: number, growthRate: number): number {
  if (elapsedMs <= 0) return 1;
  return Math.floor(100 * Math.exp(growthRate * elapsedMs)) / 100;
}

/** Flight time (ms) needed to reach multiplier `m`. */
export function msToReach(m: number, growthRate: number): number {
  return m <= 1 ? 0 : Math.ceil(Math.log(m) / growthRate);
}
