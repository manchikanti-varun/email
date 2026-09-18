// Contacts feature API slice.
//
// Wraps contact-level endpoints (bulk operations + per-contact calibrated
// confidence) over the shared HTTP client. Identical to the original api.*
// methods; no contract change.
import { request } from '../../../services/http/client';
import type { CalibratedConfidence } from '../../../types';

export const contactsApi = {
  // Bulk operation: e.g. delete-by-classification. Returns { deleted }.
  bulk: (id: string, action: string, classification: string) =>
    request<{ deleted: number }>('POST', `/lists/${id}/contacts/bulk`, { action, classification }),

  // Per-contact calibrated confidence for the contact detail view.
  aiConfidence: (id: string, email: string) =>
    request<{ confidence: CalibratedConfidence }>(
      'GET',
      `/ai/lists/${id}/contacts/${encodeURIComponent(email)}/confidence`,
    ),
};
