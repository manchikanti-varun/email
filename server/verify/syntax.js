// RFC-pragmatic email syntax validation + normalisation.

// A practical email regex. Not full RFC 5322 (which is impractical), but
// covers the vast majority of real-world valid addresses while rejecting
// obviously malformed input.
const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase();
}

export function parseEmail(email) {
  const at = email.lastIndexOf('@');
  if (at === -1) return { local: '', domain: '' };
  return { local: email.slice(0, at), domain: email.slice(at + 1) };
}

export function checkSyntax(email) {
  const issues = [];
  if (!email) issues.push('Address is empty');
  if (email.length > 254) issues.push('Address exceeds maximum length (254 chars)');

  const valid = EMAIL_RE.test(email);
  if (!valid && email) issues.push('Address does not match a valid email format');

  const { local, domain } = parseEmail(email);
  if (local.length > 64) issues.push('Local part exceeds 64 characters');
  if (email.includes('..')) issues.push('Consecutive dots are not allowed');

  return {
    valid: valid && issues.length === 0,
    local,
    domain,
    issues,
  };
}
