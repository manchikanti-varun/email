// Contacts table: search + classification filter, accessible semantic table,
// the 500-row render cap, empty state, and row → detail. It does NOT fetch data
// (contacts are passed in); selection/search/filter state lives in the
// useContactSelection hook. Extracted from ListDetailView's ContactsTable.
import type { Contact } from '../../../types';
import { EmptyState } from '../../../components/ui';
import { useContactSelection } from '../hooks/useContactSelection';
import { ContactRow } from './ContactRow';
import { ContactDetail } from './ContactDetail';

export function ContactTable({ contacts, listId }: { contacts: Contact[]; listId: string }) {
  const sel = useContactSelection(contacts);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="toolbar">
        <h3 style={{ margin: 0 }}>Contacts</h3>
        <div className="spacer" />
        <label className="visually-hidden" htmlFor="contact-search">Search contacts by email</label>
        <input
          id="contact-search"
          value={sel.query}
          onChange={(e) => sel.setQuery(e.target.value)}
          placeholder="Search email…"
        />
        <label className="visually-hidden" htmlFor="contact-filter">Filter by classification</label>
        <select
          id="contact-filter"
          value={sel.filter}
          onChange={(e) => sel.setFilter(e.target.value as typeof sel.filter)}
        >
          <option value="all">All</option>
          <option value="safe">Safe</option>
          <option value="review">Review</option>
          <option value="remove">Remove</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>

      {sel.visible.length === 0 ? (
        <EmptyState title="No matching contacts." />
      ) : (
        <>
          <p className="muted" style={{ margin: '0 0 10px', fontSize: 12 }}>
            {sel.total.toLocaleString()} contact{sel.total === 1 ? '' : 's'}
            {sel.filter !== 'all' ? ` · filtered by ${sel.filter}` : ''}
          </p>
          <div className="table-scroll">
            <table className="contact-table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col" title="Deterministic verification engine — the actual verdict, never guessed.">
                    Verdict <span className="pill" style={{ fontSize: 9, padding: '1px 6px' }}>RULES</span>
                  </th>
                  <th scope="col" title="How reliable the verdict is. Uses a trained ML model when one is deployed; otherwise the engine's own rule-based confidence. Never changes the verdict.">
                    Confidence
                  </th>
                  <th scope="col">Risk signals</th>
                  <th scope="col" title="Recommended action derived from the deterministic verdict.">Action</th>
                </tr>
              </thead>
              <tbody>
                {sel.visible.map((c, i) => (
                  <ContactRow key={i} contact={c} onOpen={sel.setSelected} />
                ))}
              </tbody>
            </table>
          </div>
          {sel.capped && (
            <p className="muted" style={{ marginTop: 10 }}>
              Showing first {sel.cap} of {sel.total}. Export for the full list.
            </p>
          )}
        </>
      )}

      {sel.selected && (
        <ContactDetail contact={sel.selected} listId={listId} onClose={() => sel.setSelected(null)} />
      )}
    </div>
  );
}
