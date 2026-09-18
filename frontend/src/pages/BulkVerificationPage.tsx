// Bulk Verification page (#/bulk). Thin: a page header + the shared bulk panel.
// Same single BulkVerificationPanel implementation used on the Dashboard, so
// there is no duplicated workflow code — only a dedicated entry point under the
// Verify navigation group.
import { PageHeader } from '../components/ui';
import { BulkVerificationPanel } from '../features/verification/components/BulkVerificationPanel';

export function BulkVerificationPage() {
  return (
    <>
      <PageHeader
        title="Bulk Verification"
        subtitle="Upload a CSV, XLSX, or TXT file and verify an entire list. Costs 1 credit per email."
      />
      <BulkVerificationPanel heading="Upload a list to verify" />
    </>
  );
}
