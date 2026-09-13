// Instagram-style handles: an alternative to sharing a phone number.
// 3-20 chars, lowercase letters/digits/./_, no leading/trailing/doubled dot,
// case-insensitive uniqueness (enforced by the COLLATE NOCASE column too).
const USERNAME_RE = /^[a-z0-9._]{3,20}$/;

export function normalizeUsername(u) {
  return typeof u === 'string' ? u.trim().toLowerCase() : '';
}

export function isValidUsername(u) {
  if (!USERNAME_RE.test(u)) return false;
  if (u.startsWith('.') || u.endsWith('.') || u.includes('..')) return false;
  if (/^\d{10}$/.test(u)) return false; // would be ambiguous with a phone lookup
  return true;
}

export function usernameAvailable(db, username, excludeId = null) {
  const row = db.prepare('SELECT id FROM customers WHERE username = ? COLLATE NOCASE').get(username);
  return !row || row.id === excludeId;
}

function randDigits(n) {
  const max = 10 ** n;
  return String(Math.floor(Math.random() * max)).padStart(n, '0');
}

// Instagram-style suggestions derived from a display name: the plain handle
// first, then progressively randomized variants, filtered to what's free.
export function suggestUsernames(db, name, count = 4) {
  const base = (normalizeUsername(name).replace(/[^a-z0-9]/g, '') || 'member').slice(0, 15);

  const seen = new Set();
  const results = [];

  function tryPush(candidate) {
    if (results.length >= count) return;
    if (!isValidUsername(candidate) || seen.has(candidate)) return;
    seen.add(candidate);
    if (usernameAvailable(db, candidate)) results.push(candidate);
  }

  tryPush(base);
  tryPush(`${base}${randDigits(2)}`);
  tryPush(`${base}_${randDigits(2)}`);
  tryPush(`the${base}`);
  tryPush(`${base}.${randDigits(2)}`);

  let guard = 0;
  while (results.length < count && guard < 40) {
    guard++;
    tryPush(`${base}${randDigits(3)}`);
  }

  return results;
}
