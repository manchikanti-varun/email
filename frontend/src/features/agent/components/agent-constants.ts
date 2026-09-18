// Static agent UI vocabulary: quick-action prompts and tool → human step labels.
// Moved verbatim from AgentView.

export const QUICK_ACTIONS = [
  'Analyze my latest list',
  'Is my list ready to send?',
  'Show risky contacts',
  'Why did my health change?',
  'Find contacts that need re-verification',
  'Clean this list',
];

export const STEP_LABELS: Record<string, string> = {
  get_lists: 'Finding lists…',
  get_list: 'Loading list…',
  get_list_health: 'Checking health…',
  analyze_list: 'Analyzing list…',
  get_health_history: 'Checking health history…',
  get_contacts: 'Inspecting contacts…',
  get_risky_contacts: 'Inspecting risky contacts…',
  get_unknown_contacts: 'Inspecting unknown contacts…',
  get_remove_contacts: 'Inspecting remove contacts…',
  get_cleaning_plan: 'Building cleaning plan…',
  run_campaign_preflight: 'Running preflight…',
  get_reverify_cost: 'Estimating credit cost…',
  get_account_credits: 'Checking credits…',
  start_verification: 'Starting verification…',
  start_reverification: 'Starting re-verification…',
  delete_contacts: 'Removing contacts…',
  delete_list: 'Deleting list…',
  export_list: 'Preparing export…',
};

export function stepClass(status: string): string {
  if (status === 'ok') return 'done';
  if (status === 'awaiting_confirmation') return 'wait';
  if (status && status.startsWith('error')) return 'fail';
  return 'done';
}
