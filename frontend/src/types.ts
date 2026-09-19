// Shared API model types. These mirror the JSON the Express backend returns.
// Kept intentionally permissive where the backend is loosely typed, but the
// common fields the UI relies on are made explicit.

export interface User {
  id: string;
  email: string;
  name?: string;
  credits: number;
  apiKeyPrefix?: string;
}

export type Classification = 'safe' | 'review' | 'remove' | 'unknown';
export type RecommendedAction = 'keep' | 'review' | 'reverify' | 'remove';
export type Deliverability = 'deliverable' | 'accepted' | 'risky' | 'unknown' | 'undeliverable';
export type Confidence = 'high' | 'medium' | 'low' | 'unknown';
export type MailboxStatus = 'DELIVERABLE' | 'UNDELIVERABLE' | 'ACCEPT_ALL' | 'UNKNOWN';
export type AcceptanceType = 'CATCH_ALL';
export type VerificationQuality = 'HIGH' | 'MEDIUM' | 'LOW';
export type SignalStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface Signal {
  status: SignalStatus;
  label: string;
}

export interface RiskSignal {
  label: string;
  detail?: string;
}

export interface CalibrationEvidence {
  sign: '+' | '-';
  text: string;
}

export interface CalibratedConfidence {
  level?: 'HIGH' | 'MEDIUM' | 'LOW';
  score?: number;
  model?: string;
  available?: boolean;
  message?: string;
  interpretation?: string;
  evidence?: CalibrationEvidence[];
  disagreement?: { warning?: string };
}

export interface SmtpEvidence {
  vantages?: Array<Record<string, unknown>>;
  mxAttempts?: Array<Record<string, unknown>>;
  retries?: number;
  catchAll?: boolean;
  finalReason?: string | null;
  worker?: { id?: string } | null;
}

export interface Contact {
  email: string;
  classification: Classification;
  status?: string;
  deliverability?: Deliverability;
  deliverabilityScore?: number;
  score?: number;
  confidence?: Confidence;
  /** Proven mailbox outcome (additive; catch-all → ACCEPT_ALL). */
  mailboxStatus?: MailboxStatus;
  /** Set when deliverability is accepted via catch-all. */
  acceptanceType?: AcceptanceType | null;
  /** Strength of SMTP/DNS evidence (additive). */
  verificationQuality?: VerificationQuality;
  smtpEvidence?: SmtpEvidence | null;
  finalReason?: string | null;
  /** Which SMTP path produced the evidence: 'local-smtp' | 'smtp-worker' | 'none'. */
  smtpSource?: string | null;
  recommendedAction?: RecommendedAction;
  recommendation?: string;
  reasons?: string[];
  signals?: Signal[];
  riskSignals?: RiskSignal[];
  calibrationLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
  calibratedConfidence?: number;
  calibrationModel?: string;
}

export interface VerifyResult extends Contact {
  confidenceCalibration?: CalibratedConfidence;
}

export type ListStatus = 'pending' | 'verifying' | 'done';

export interface ListSummaryRow {
  id: string;
  name: string;
  total: number;
  status: ListStatus;
  health: number | null;
  created_at: string;
}

export interface ListCounts {
  safe: number;
  review: number;
  remove: number;
  unknown: number;
}

export interface ListMetrics {
  /** Confirmed mailbox-level deliverability = deliverable / total. */
  deliverability: number;
  mailboxDeliverability?: number;
  /** Catch-all acceptance = acceptAll / total (infra-positive, mailbox unconfirmed). */
  catchAllAcceptance?: number;
  /** Could-not-verify share = unknown / total. */
  unconfirmed?: number;
  dataQuality: number;
  /** Infrastructure health (MX present, not disposable). NOT mailbox deliverability. */
  domainHealth: number;
}

export interface ListSummary {
  health: number;
  total: number;
  counts: ListCounts;
  metrics: ListMetrics;
}

export interface HistoryPoint {
  created_at: string;
  health: number;
}

export interface ListDetail {
  list: {
    id: string;
    name: string;
    total: number;
    duplicates: number;
    status: ListStatus;
  };
  summary: ListSummary;
  contacts: Contact[];
  history: HistoryPoint[];
  delta: number | null;
}

export interface UploadTimings {
  parseMs: number;
  saveMs: number;
  totalMs: number;
}

export type UploadStage = 'uploading' | 'parsing' | 'saving' | 'done' | 'error';

export interface UploadProgressEvent {
  stage: UploadStage;
  total?: number;
  error?: string;
}

export interface UploadResult {
  listId: string;
  total: number;
  duplicates: number;
  columnHint?: string;
  rawCount?: number;
  timings?: UploadTimings;
}

export interface Progress {
  done: number;
  total: number;
  status: ListStatus;
}

export interface Alert {
  id: string;
  title: string;
  body?: string;
  level: 'critical' | 'warning' | 'info';
  created_at: string;
  list_id?: string;
}

export interface Webhook {
  id: string;
  url: string;
  event: string;
}

// ---- AI insight statement vocabulary ----
export type StatementKind = 'FACT' | 'INFERENCE' | 'PREDICTION' | 'RECOMMENDATION';
export type StatementConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Statement {
  kind: StatementKind;
  confidence?: StatementConfidence;
  text: string;
}

export interface CampaignRisk {
  available: boolean;
  riskLevel?: string;
  riskScore?: number;
  recommendedSendCount?: number;
  summary?: string;
  message?: string;
}

export interface HealthAnalysis {
  available: boolean;
  healthScore?: number;
  trend?: 'IMPROVING' | 'DECLINING' | 'STABLE';
  summary?: string;
  recommendations?: Statement[];
}

export interface DomainInsight {
  domain: string;
  total: number;
  problemScore: number;
  recommendedAction: string;
  // Backend also returns these (server detection-modules.js buildDomainInsights):
  // a plain-language summary and per-classification percentages for the domain.
  summary?: string;
  percentages?: Record<string, number>;
}

export interface DomainsResult {
  available: boolean;
  domains: DomainInsight[];
}

export interface HealthPrediction {
  available: boolean;
  currentScore?: number;
  trend?: string;
  confidence?: StatementConfidence;
  predictionRanges?: Record<string, string>;
  warning?: string;
  note?: string;
  message?: string;
}

export interface Anomaly {
  metric: string;
  statement?: Statement;
}

export interface AnomaliesResult {
  available: boolean;
  detected: boolean;
  anomalies: Anomaly[];
}

export interface Preflight {
  recipients: number;
  recommendedSendList: number;
  verdict: string;
  confirmedPct?: number;
  reviewPct?: number;
  blockedPct?: number;
  buckets: {
    confirmed: number;
    catchAll: number;
    unknown: number;
    blocked: number;
    disposable: number;
    // Backward-compatible aliases.
    safe: number;
    review: number;
    invalid: number;
  };
  eligibility?: {
    confirmed: number;
    review: number;
    unconfirmed: number;
    blocked: number;
  };
}

// ---- Agent (MailHealth AI) ----
export interface AgentAction {
  tool: string;
  status: string;
}

export interface AgentSource {
  label: string;
}

export interface PendingConfirmation {
  tool: string;
  args: Record<string, unknown> & { listId?: string };
  token: string;
  permission: 'destructive' | string;
  summary: string;
}

export interface AgentResponse {
  message: string;
  conversationId?: string;
  actions?: AgentAction[];
  sources?: AgentSource[];
  model?: string;
  latency?: number;
  estimatedCost?: number;
  pendingConfirmation?: PendingConfirmation;
}

export interface AgentChatPayload {
  message: string;
  listId?: string;
  conversationId?: string;
  confirm?: { tool: string; args: Record<string, unknown>; token: string };
}

export interface VerificationHealth {
  mode?: string;
}

// ---- AI List Health Analysis (POST /api/ai/lists/:id/analyze) ----
export type HealthLevel = 'Excellent' | 'Good' | 'Needs Attention' | 'Poor' | 'Critical';
export type Severity = 'high' | 'medium' | 'low';

export interface ListHealthMetrics {
  total: number;
  deliverable: number;
  undeliverable: number;
  unknown: number;
  acceptAll: number;
  risky: number;
  percentages: {
    deliverable: number;
    undeliverable: number;
    unknown: number;
    acceptAll: number;
    risky: number;
  };
  additionalSignals: {
    disposable: number;
    roleBased: number;
    catchAll: number;
    noMx: number;
    syntaxInvalid: number;
    domainInvalid: number;
    greylisted: number;
  };
}

export interface ScoreComponent {
  signal: string;
  percentage: number;
  weight: number;
  penalty: number;
}

export interface ScoreModel {
  formula: string;
  weightedRisk: number;
  components: ScoreComponent[];
}

export interface ProviderBreakdown {
  provider: string;
  total: number;
  deliverable: number;
  undeliverable: number;
  unknown: number;
  acceptAll: number;
  percentages: { undeliverable: number; unknown: number };
}

export interface DomainBreakdown {
  domain: string;
  total: number;
  deliverable: number;
  undeliverable: number;
  unknown: number;
  accepted: number;
  problemRate: number;
}

export interface HealthRiskSignal {
  code: string;
  severity: Severity;
  count: number;
  percentage: number;
  label: string;
  detail: string;
}

export interface HealthRecommendation {
  priority: Severity;
  actionType: string;
  action: string;
  reason: string;
}

export interface DiagnosisKeyIssue {
  issue: string;
  severity: Severity;
  evidence: string;
  impact: string;
}

export interface DiagnosisRecommendation {
  action: string;
  priority: Severity;
  reason: string;
}

export interface Diagnosis {
  summary: string;
  keyIssues: DiagnosisKeyIssue[];
  recommendations: DiagnosisRecommendation[];
  observations: string[];
}

export interface DiagnosisMeta {
  source: 'ai' | 'deterministic';
  model: string;
  latencyMs: number;
  estimatedCost: number;
  error?: string;
}

export interface ListHealthAnalysis {
  list: { id: string; name: string; total: number; status: string };
  generatedAt: string;
  healthScore: number;
  healthLevel: HealthLevel;
  scoreModel: ScoreModel;
  metrics: ListHealthMetrics;
  providers: ProviderBreakdown[];
  domains: DomainBreakdown[];
  riskSignals: HealthRiskSignal[];
  recommendations: HealthRecommendation[];
  diagnosis: Diagnosis;
  diagnosisMeta: DiagnosisMeta;
}

export interface LatestListAnalysis {
  available: boolean;
  message?: string;
  healthScore?: number;
  healthLevel?: HealthLevel;
  report?: Omit<ListHealthAnalysis, 'list' | 'diagnosis' | 'diagnosisMeta'>;
  diagnosis?: Diagnosis | null;
  diagnosisSource?: 'ai' | 'deterministic';
  createdAt?: string;
}
