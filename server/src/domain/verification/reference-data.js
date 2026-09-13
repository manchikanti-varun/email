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
  isRole(local) { return this.roles.has(local); }
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
