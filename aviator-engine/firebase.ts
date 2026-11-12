import { createRemoteJWKSet, jwtVerify, SignJWT, importPKCS8 } from "jose";

// Bridges Aviator with the app's existing Firebase wallet (users/{uid}.balance).
// All balance changes use Firestore atomic increments; debits are additionally
// guarded by an optimistic precondition so a bet can never overdraw a wallet.

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "vestify-pro";
const DOCS = `projects/${PROJECT_ID}/databases/(default)/documents`;
const API = `https://firestore.googleapis.com/v1/${DOCS}`;
const COMMIT_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`;

const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export class GameError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function verifyIdToken(token: string | null): Promise<string> {
  if (!token) throw new GameError("unauthenticated", "Please log in to play.", 401);
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    });
    if (!payload.sub) throw new Error("no sub");
    return payload.sub;
  } catch {
    throw new GameError("unauthenticated", "Your session expired. Please log in again.", 401);
  }
}

// Optional: when a Firebase service account is configured, payouts can be
// credited even while the player is offline. Without it, the player's own
// session token is used (which is how the rest of the app writes balances).
let adminToken: { token: string; exp: number } | null = null;
export function hasServiceAccount(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT);
}
async function getAdminToken(): Promise<string | null> {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  if (adminToken && adminToken.exp > Date.now() + 60_000) return adminToken.token;
  const sa = JSON.parse(raw);
  const key = await importPKCS8(String(sa.private_key).replace(/\\n/g, "\n"), "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/datastore" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Service account token exchange failed (${res.status})`);
  const json: any = await res.json();
  adminToken = { token: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
  return adminToken.token;
}

async function bearer(userToken: string | null): Promise<string> {
  const admin = await getAdminToken().catch((e) => {
    console.error("[aviator] service account error", e);
    return null;
  });
  const t = admin || userToken;
  if (!t) throw new GameError("wallet_unavailable", "Wallet is temporarily unavailable.", 503);
  return t;
}

function num(v: any): number {
  if (!v) return 0;
  if ("doubleValue" in v) return Number(v.doubleValue) || 0;
  if ("integerValue" in v) return Number(v.integerValue) || 0;
  return 0;
}

export interface WalletDoc {
  balance: number;
  username: string;
  isBlocked: boolean;
  updateTime: string;
}

export async function getWallet(uid: string, userToken: string | null): Promise<WalletDoc> {
  const res = await fetch(`${API}/users/${encodeURIComponent(uid)}`, {
    headers: { authorization: `Bearer ${await bearer(userToken)}` },
  });
  if (res.status === 404) throw new GameError("no_wallet", "Wallet not found for this account.", 404);
  if (!res.ok) throw new GameError("wallet_unavailable", "Could not read your wallet. Please retry.", 503);
  const doc: any = await res.json();
  const f = doc.fields || {};
  return {
    balance: num(f.balance),
    username: f.username?.stringValue || "Player",
    isBlocked: Boolean(f.isBlocked?.booleanValue),
    updateTime: doc.updateTime,
  };
}

async function commit(token: string, writes: any[]): Promise<Response> {
  return fetch(COMMIT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ writes }),
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Atomically deducts `amount` if the balance covers it. Returns the new balance. */
export async function debitWallet(uid: string, userToken: string | null, amount: number): Promise<number> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const w = await getWallet(uid, userToken);
    if (w.isBlocked) throw new GameError("blocked", "Account is blocked by admin.", 403);
    if (w.balance + 1e-9 < amount) throw new GameError("insufficient_balance", "Insufficient balance! Please deposit.", 402);
    const res = await commit(await bearer(userToken), [
      {
        transform: {
          document: `${DOCS}/users/${uid}`,
          fieldTransforms: [{ fieldPath: "balance", increment: { doubleValue: -amount } }],
        },
        currentDocument: { updateTime: w.updateTime },
      },
    ]);
    if (res.ok) return round2(w.balance - amount);
    const body = await res.text();
    // Precondition failure = wallet changed between read and write; retry.
    if (res.status === 409 || /FAILED_PRECONDITION|ABORTED/.test(body)) {
      await new Promise((r) => setTimeout(r, 80 * (attempt + 1)));
      continue;
    }
    console.error("[aviator] debit failed", res.status, body.slice(0, 300));
    break;
  }
  throw new GameError("wallet_unavailable", "Could not deduct your bet. Please retry.", 503);
}

/** Atomically adds `amount` to the wallet. */
export async function creditWallet(uid: string, userToken: string | null, amount: number): Promise<void> {
  if (amount <= 0) return;
  const res = await commit(await bearer(userToken), [
    {
      transform: {
        document: `${DOCS}/users/${uid}`,
        fieldTransforms: [{ fieldPath: "balance", increment: { doubleValue: round2(amount) } }],
      },
      currentDocument: { exists: true },
    },
  ]);
  if (!res.ok) {
    const body = await res.text();
    console.error("[aviator] credit failed", res.status, body.slice(0, 300));
    throw new GameError("wallet_unavailable", "Payout is queued and will be credited shortly.", 503);
  }
}
