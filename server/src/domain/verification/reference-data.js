// Reference datasets for the verification engine (disposable domains, role
// local-parts, free providers, common typos, reserved domains).
//
// Pure domain knowledge. The sets are instance state so they can be augmented
// at runtime (e.g. merged with an external feed) without touching the
// filesystem here — that concern belongs to infrastructure, which calls
// `merge()`.

const DISPOSABLE_SEED = [
  'temporarymail.com', 'tempmail.com', 'temp-mail.org', 'temp-mail.io',
  'guerrillamail.com', 'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamail.biz', 'sharklasers.com', 'grr.la', 'spam4.me',
  'mailinator.com', 'mailinator.net', 'maildrop.cc', 'mailnesia.com',
  '10minutemail.com', '10minutemail.net', '20minutemail.com', '33mail.com',
  'yopmail.com', 'yopmail.net', 'yopmail.fr', 'throwawaymail.com',
  'trashmail.com', 'trashmail.net', 'trash-mail.com', 'getnada.com',
  'nada.email', 'dispostable.com', 'fakeinbox.com', 'fakemailgenerator.com',
  'mytemp.email', 'tempinbox.com', 'emailondeck.com', 'moakt.com',
  'mohmal.com', 'tmpmail.org', 'tmpmail.net', 'burnermail.io',
  'discard.email', 'discardmail.com', 'mailcatch.com', 'inboxbear.com',
  'tempmailo.com', 'luxusmail.org', 'wegwerfmail.de', 'wegwerfmail.net',
  'einrot.com', 'fleckens.hu', 'gustr.com', 'jetable.org', 'mintemail.com',
  'mytrashmail.com', 'no-spam.ws', 'nowmymail.com', 'objectmail.com',
  'proxymail.eu', 'rcpt.at', 'safe-mail.net', 'selfdestructingmail.com',
  'sogetthis.com', 'spambog.com', 'spambox.us', 'spamgourmet.com',
  'tempemail.net', 'tempomail.fr', 'thankyou2010.com', 'trbvm.com',
  'wh4f.org', 'willselfdestruct.com', 'yeah.net', 'zetmail.com',
  'anonbox.net', 'bccto.me', 'chacuo.net', 'dropmail.me', 'emailfake.com',
  'fakemail.net', 'harakirimail.com', 'incognitomail.com', 'mailexpire.com',
  'mailforspam.com', 'mailscrap.com', 'mvrht.com', 'spamherelots.com',
];

const ROLE_SEED = [
  'admin', 'administrator', 'billing', 'compliance', 'contact', 'contacts',
  'devnull', 'dns', 'ftp', 'hostmaster', 'help', 'helpdesk', 'hr',
  'info', 'information', 'inquiries', 'inquiry', 'jobs', 'legal', 'list',
  'mail', 'mailer-daemon', 'marketing', 'media', 'newsletter', 'noc',
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'office', 'orders',
  'postmaster', 'press', 'privacy', 'root', 'sales', 'security', 'service',
  'services', 'signup', 'spam', 'support', 'sysadmin', 'system', 'team',
  'test', 'testing', 'usenet', 'uucp', 'webmaster', 'www', 'abuse',
  'accounts', 'accounting', 'feedback', 'general', 'enquiries', 'careers',
  'recruitment', 'partners', 'partnerships', 'finance', 'operations',
];

// Curated subset of role words that are safe to match as a SUBSTRING inside a
// concatenated local-part (e.g. "mumbaisales", "indiasupport"). Kept to common,
// unambiguous, >= 4-char words so we don't over-flag. Short/ambiguous tokens
// (hr, dns, ftp, www, team, list, mail, test, root, noc) are deliberately
// EXCLUDED from substring matching — they still match exactly or as tokens.
const SUBSTRING_ROLE_WORDS = [
  'admin', 'billing', 'careers', 'compliance', 'contact', 'enquiries',
  'feedback', 'finance', 'helpdesk', 'info', 'inquiries', 'marketing',
  'newsletter', 'noreply', 'orders', 'partnerships', 'sales', 'security',
  'support', 'webmaster',
];

// Words that CONTAIN a role substring but are NOT role mailboxes. Guards the
// tier-3 substring check against obvious false positives.
const ROLE_FALSE_POSITIVES = new Set([
  'wholesale', 'wholesales', 'resale', 'resales', 'presale', 'presales',
  'salesforce', 'salesperson', 'salesman', 'saleswoman',
  'infographic', 'securities',
]);

const FREE_SEED = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in',
  'ymail.com', 'rocketmail.com', 'outlook.com', 'outlook.co.uk',
  'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.co.uk', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aim.com',
  'protonmail.com', 'proton.me', 'pm.me', 'zoho.com', 'zohomail.com',
  'gmx.com', 'gmx.de', 'gmx.net', 'mail.com', 'yandex.com', 'yandex.ru',
  'fastmail.com', 'hey.com', 'tutanota.com', 'tuta.io',
];

const TYPO_SEED = {
  'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.cm': 'gmail.com',
  'gmail.om': 'gmail.com', 'gamil.com': 'gmail.com', 'gmaill.com': 'gmail.com',
  'gmailc.om': 'gmail.com', 'ggmail.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com', 'hotnail.com': 'hotmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.co': 'yahoo.com',
  'yhoo.com': 'yahoo.com', 'yahho.com': 'yahoo.com',
  'outlok.com': 'outlook.com', 'outook.com': 'outlook.com',
  'outlook.co': 'outlook.com', 'outlook.con': 'outlook.com',
  'iclod.com': 'icloud.com', 'icloud.co': 'icloud.com', 'iclould.com': 'icloud.com',
  'live.co': 'live.com', 'aol.co': 'aol.com', 'protonmai.com': 'protonmail.com',
};

// Reserved / documentation domains (RFC 2606 & RFC 6761). These resolve in DNS
// but are designated to NEVER accept real mail, so any address on them is
// undeliverable by definition.
const RESERVED_DOMAINS = new Set([
  'example.com', 'example.net', 'example.org', 'example.edu',
  'test.com', 'localhost', 'invalid',
]);
const RESERVED_TLDS = ['.example', '.test', '.invalid', '.localhost'];

export class ReferenceData {
  constructor() {
    this.disposable = new Set(DISPOSABLE_SEED);
    this.roles = new Set(ROLE_SEED);
    this.free = new Set(FREE_SEED);
    this.typos = { ...TYPO_SEED };
  }

  isDisposable(domain) { return this.disposable.has(domain); }

  // Role detection is intentionally fuzzy but guarded. A mailbox is treated as
  // role-based / shared when its local-part is, or clearly contains, a known
  // functional name. Three tiers, cheapest first:
  //   1. exact          "sales"                       -> role
  //   2. token match    "sales.india", "india-sales"  -> role  (split on . - _ + / digits)
  //   3. substring      "mumbaisales", "indiasupport" -> role  (guarded)
  // Substring matching only uses role words >= 4 chars and skips well-known
  // false positives (e.g. "wholesale"/"salesforce" contain "sales" but are not
  // role mailboxes). Being role-based is a characteristic, never a health
  // penalty, so a rare miss is preferable to over-flagging real people.
  isRole(local) {
    const s = String(local || '').toLowerCase();
    if (!s) return false;
    if (this.roles.has(s)) return true; // tier 1: exact

    // tier 2: any separated token is a known role.
    const tokens = s.split(/[.\-_+/\d]+/).filter(Boolean);
    if (tokens.length > 1 && tokens.some((t) => this.roles.has(t))) return true;

    // tier 3: guarded substring for unambiguous role words.
    if (ROLE_FALSE_POSITIVES.has(s)) return false;
    for (const roleWord of SUBSTRING_ROLE_WORDS) {
      if (s.includes(roleWord)) return true;
    }
    return false;
  }

  isFreeProvider(domain) { return this.free.has(domain); }
  typoSuggestion(domain) { return this.typos[domain] || null; }
  isReservedDomain(domain) {
    return RESERVED_DOMAINS.has(domain) || RESERVED_TLDS.some((t) => domain.endsWith(t));
  }

  // Merge additional entries (e.g. from an external feed) into a named set.
  // `which` is 'disposable' | 'roles' | 'free'. Returns the number added.
  merge(which, values) {
    const set = this[which];
    if (!(set instanceof Set)) return 0;
    let added = 0;
    for (const raw of values) {
      const v = String(raw).trim().toLowerCase();
      if (v && !v.startsWith('#') && !set.has(v)) { set.add(v); added++; }
    }
    return added;
  }

  counts() {
    return {
      disposable: this.disposable.size,
      roles: this.roles.size,
      free: this.free.size,
      typos: Object.keys(this.typos).length,
    };
  }
}
