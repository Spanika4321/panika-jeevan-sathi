'use strict';
/**
 * PANIKA JEEVAN SATHI - member invite ("referral") codes.
 *
 * This is the site's organic growth loop: every member gets one short,
 * permanent invite link that they forward on WhatsApp to their family and
 * samaj groups. When somebody registers through that link, the inviter gets a
 * notification and the attribution is stored so the owner can see which
 * members actually bring new families.
 *
 * Design rules:
 *  - The code is DERIVED from the member id (base-32 + FNV check character),
 *    so no column has to be added to `users` and nothing has to be migrated.
 *    It carries no personal data: it is an opaque token, not an id in the clear.
 *  - Attribution lives in the optional `referrals` table. Every storage call
 *    is wrapped, because growth bookkeeping must never fail a registration -
 *    not on sqlite, not on D1, not on a Supabase project whose schema has not
 *    been re-run yet (same convention as site_stats / site_visitors).
 *  - Only an invite code can be resolved to an inviter. A code never grants
 *    trust, role or verification; the invitee is an ordinary new member.
 */

/* 32 characters, ambiguous glyphs removed (no 0/O/1/I) so codes survive
   being read aloud over the phone or copied from a screenshot. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/* 2 characters minimum (id 1 + check), 14 maximum (far beyond any real id). */
const CODE_RE = /^[2-9A-HJ-NP-Z]{2,14}$/;

const MAX_CODE_LENGTH = 16;

/** FNV-1a over the code body; used as the single check character. */
function checksum(body) {
  let hash = 2166136261;
  for (let i = 0; i < body.length; i += 1) {
    hash ^= body.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return ALPHABET[hash % ALPHABET.length];
}

function encodeId(id) {
  let n = Number(id);
  let out = '';
  do {
    out = ALPHABET[n % ALPHABET.length] + out;
    n = Math.floor(n / ALPHABET.length);
  } while (n > 0);
  return out;
}

function decodeBody(body) {
  let n = 0;
  for (let i = 0; i < body.length; i += 1) {
    const value = ALPHABET.indexOf(body[i]);
    if (value < 0) return null;
    n = n * ALPHABET.length + value;
    if (!Number.isSafeInteger(n)) return null;
  }
  return n;
}

/** The permanent invite code for a member id, or null for an impossible id. */
function codeFor(userId) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const body = encodeId(id);
  return body + checksum(body);
}

/**
 * Resolve an invite code back to the inviter's member id.
 * Returns null for anything that is not a well-formed code of a real id,
 * so a tampered or random code simply means "no attribution".
 */
function userIdFromCode(value) {
  const code = String(value === null || value === undefined ? '' : value).trim().toUpperCase();
  if (!CODE_RE.test(code)) return null;
  const body = code.slice(0, -1);
  if (checksum(body) !== code.slice(-1)) return null;
  const id = decodeBody(body);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** True when the value looks like one of our codes (used by the front-end). */
function looksLikeCode(value) {
  return CODE_RE.test(String(value || '').trim().toUpperCase());
}

/** Relative invite path for a member - the front-end makes it absolute. */
function invitePath(userId) {
  const code = codeFor(userId);
  return code ? `/?ref=${code}` : '/';
}

/* ------------------------------------------------------------- storage --- */

/**
 * Record one attribution. Returns true only when the row was written.
 * A duplicate (same invitee twice) or a missing table returns false; neither
 * is an error the caller may surface to a registering member.
 */
async function record(db, info) {
  const inviterId = Number(info && info.inviterId);
  const inviteeId = Number(info && info.inviteeId);
  if (!Number.isSafeInteger(inviterId) || !Number.isSafeInteger(inviteeId)) return false;
  if (inviterId === inviteeId) return false;
  try {
    if (await db.one('referrals', { invitee_id: inviteeId })) return false;
    await db.insert('referrals', {
      inviter_id: inviterId,
      invitee_id: inviteeId,
      code: String((info && info.code) || '').slice(0, MAX_CODE_LENGTH),
      created_at: Date.now()
    });
    return true;
  } catch (err) {
    if (info && typeof info.log === 'function') {
      info.log(`[referral] attribution not stored for member ${inviteeId}: ${err.message}`);
    }
    return false;
  }
}

/** How many members joined with this member's link, or null if unavailable. */
async function countFor(db, userId) {
  try {
    return await db.count('referrals', { inviter_id: Number(userId) });
  } catch (err) {
    return null;
  }
}

/**
 * Owner-facing rollup: total invites, how many members invited anybody, and
 * the members bringing the most new families. Returns null when the
 * `referrals` table is not available on this installation.
 */
async function summary(db, options = {}) {
  const limit = Number(options.limit) > 0 ? Math.min(60, Math.floor(Number(options.limit))) : 10;
  let rows = null;
  try {
    rows = await db.all('referrals');
  } catch (err) {
    return null;
  }
  const perInviter = new Map();
  for (const row of rows) {
    const inviterId = Number(row.inviter_id);
    if (!Number.isSafeInteger(inviterId) || inviterId <= 0) continue;
    perInviter.set(inviterId, (perInviter.get(inviterId) || 0) + 1);
  }
  // Rank first, resolve names only for the members that make the cut.
  const ranked = [...perInviter.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit);
  const top = [];
  for (const [inviterId, count] of ranked) {
    let name = '';
    let email = '';
    try {
      const inviter = await db.one('users', { id: inviterId });
      name = String((inviter && inviter.name) || '');
      email = String((inviter && inviter.email) || '');
    } catch (err) {
      /* an inviter row that cannot be read must not break the rollup */
    }
    top.push({ inviter_id: inviterId, name, email, invites: count });
  }
  return {
    total: rows.length,
    inviters: perInviter.size,
    top
  };
}

module.exports = {
  ALPHABET,
  codeFor,
  userIdFromCode,
  looksLikeCode,
  invitePath,
  record,
  countFor,
  summary
};
