// Contact table search + filter state, isolated from presentation.
//
// Preserves the original ListDetailView behavior: case-insensitive email
// substring search, classification filter ('all'|'safe'|'review'|'remove'|
// 'unknown'), and the 500-row render cap. The full filtered length is exposed
// so the table can show "showing first 500 of N".
import { useMemo, useState } from 'react';
import type { Contact } from '../../../types';
import type { ContactFilter } from '../types';

const RENDER_CAP = 500;

export function useContactSelection(contacts: Contact[]) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ContactFilter>('all');
  const [selected, setSelected] = useState<Contact | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      contacts.filter(
        (c) => (filter === 'all' || c.classification === filter) && (!q || c.email.includes(q)),
      ),
    [contacts, filter, q],
  );

  const visible = filtered.slice(0, RENDER_CAP);

  return {
    query,
    setQuery,
    filter,
    setFilter,
    selected,
    setSelected,
    filtered,
    visible,
    total: filtered.length,
    capped: filtered.length > RENDER_CAP,
    cap: RENDER_CAP,
  };
}
