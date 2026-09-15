import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../tools.js';
import { PERMISSION } from '../permissions.js';
import { makeFakeUseCases, FAKE_USER } from './helpers.js';
import {
  GetCampaignRisk, GetHealthAnalysis, GetHealthPrediction, GetListAnomalies,
  GetDomainIntelligence, GetSmartCleaning, GetReverificationPriority,
  GetCreditOptimization, GetEmailExplanation, GetBusinessInsights,
  InvestigateVerification, DetectIncidents, AnalyzeBenchmark,
} from '../../src/application/ai-use-cases.js';

const AI_TOOLS = [
  'get_campaign_risk', 'analyze_list_health', 'predict_list_health', 'detect_list_anomalies',
  'analyze_domain', 'get_smart_cleaning', 'prioritize_reverification',
  'optimize_verification_credits', 'generate_email_explanation', 'generate_business_insights',
  'investigate_verification_issue', 'detect_incidents', 'analyze_benchmark',
];

function sampleData() {
  return {
    credits: 500,
    lists: [{ id: 'L1', name: 'Customers', total: 4, status: 'done', health: 60 }],
    contacts: {
      L1: [
        { email: 'a@good.com', deliverability: 'deliverable', classification: 'safe', confidence: 'high', score: 100, riskSignals: [], signals: [{ label: 'Valid syntax', status: 'pass' }] },
        { email: 'x@mailinator.com', deliverability: 'undeliverable', classification: 'remove', confidence: 'high', score: 10, riskSignals: [{ code: 'disposable', label: 'Disposable domain' }], signals: [{ label: 'Disposable / temporary domain', status: 'fail' }] },
        { email: 'c@corp.com', deliverability: 'risky', classification: 'review', confidence: 'medium', score: 55, riskSignals: [{ code: 'catch_all', label: 'Catch-all domain' }], signals: [] },
        { email: 'd@corp.com', deliverability: 'unknown', classification: 'unknown', confidence: 'low', score: 50, riskSignals: [], signals: [], verified_at: null },
      ],
    },
  };
}

// Build a tool ctx whose useCases include BOTH the fake existing use-cases and
// real AI use-cases wired onto the same fakes (exactly like the container).
function ctxWithAi(data, capability = { liveSmtp: true, smtpSource: 'local-smtp', smtpMode: 'auto' }) {
  const { uc, state } = makeFakeUseCases(data);
  Object.assign(uc, {
    aiCampaignRisk: new GetCampaignRisk({ getListDetail: uc.getListDetail, campaignPreflight: uc.campaignPreflight }),
    aiHealthAnalysis: new GetHealthAnalysis({ getListDetail: uc.getListDetail }),
    aiHealthPrediction: new GetHealthPrediction({ getListDetail: uc.getListDetail }),
    aiListAnomalies: new GetListAnomalies({ getListDetail: uc.getListDetail }),
    aiDomainIntelligence: new GetDomainIntelligence({ getListDetail: uc.getListDetail }),
    aiSmartCleaning: new GetSmartCleaning({ getListDetail: uc.getListDetail, getCleaningPlan: uc.getCleaningPlan }),
    aiReverificationPriority: new GetReverificationPriority({ getListDetail: uc.getListDetail }),
    aiCreditOptimization: new GetCreditOptimization({ getListDetail: uc.getListDetail, getAccountCredits: uc.getAccountCredits }),
    aiEmailExplanation: new GetEmailExplanation({ getListDetail: uc.getListDetail }),
    aiBusinessInsights: new GetBusinessInsights({ getListDetail: uc.getListDetail }),
    aiInvestigate: new InvestigateVerification({ getListDetail: uc.getListDetail, verifyCapability: capability }),
    aiIncidents: new DetectIncidents({ getListDetail: uc.getListDetail, getLists: uc.getLists, verifyCapability: capability }),
    aiBenchmarkAnalysis: new AnalyzeBenchmark(),
  });
  return { ctx: { userId: FAKE_USER.id, useCases: uc, config: {} }, state };
}

test('all AI tools are registered as READ-only, no confirmation', () => {
  for (const name of AI_TOOLS) {
    const t = registry.get(name);
    assert.ok(t, `tool ${name} exists`);
    assert.equal(t.permission, PERMISSION.READ, `${name} is READ`);
    assert.equal(t.confirm, false, `${name} needs no confirmation`);
  }
});

test('get_campaign_risk tool returns a verdict via the use-case', async () => {
  const { ctx } = ctxWithAi(sampleData());
  const r = await registry.get('get_campaign_risk').run(ctx, { listId: 'L1' });
  assert.equal(r.available, true);
  assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(r.riskLevel));
});

test('analyze_domain tool ranks worst domain first', async () => {
  const { ctx } = ctxWithAi(sampleData());
  const r = await registry.get('analyze_domain').run(ctx, { listId: 'L1', limit: 5 });
  assert.equal(r.available, true);
  assert.equal(r.domains[0].domain, 'mailinator.com');
});

test('investigate_verification_issue tool produces a root-cause report', async () => {
  const data = sampleData();
  // Make it look like an infra issue: all unknown, no smtp source recorded.
  data.contacts.L1 = data.contacts.L1.map((c) => ({ ...c, deliverability: 'unknown', classification: 'unknown', confidence: 'low' }));
  const { ctx } = ctxWithAi(data, { liveSmtp: false, smtpSource: 'none', smtpMode: 'auto', smtpDetail: 'blocked' });
  const r = await registry.get('investigate_verification_issue').run(ctx, { listId: 'L1', question: 'why unknown?' });
  assert.equal(r.available, true);
  assert.ok(r.possibleCauses.length > 0);
});

test('generate_email_explanation tool explains a specific contact', async () => {
  const { ctx } = ctxWithAi(sampleData());
  const r = await registry.get('generate_email_explanation').run(ctx, { listId: 'L1', email: 'x@mailinator.com', mode: 'simple' });
  assert.equal(r.available, true);
  assert.match(r.explanation, /disposable/i);
});

test('analyze_benchmark tool computes metrics', async () => {
  const { ctx } = ctxWithAi(sampleData());
  const r = await registry.get('analyze_benchmark').run(ctx, { benchmark: { results: [
    { expected: 'deliverable', predicted: 'deliverable' },
    { expected: 'undeliverable', predicted: 'deliverable', reason: 'catch-all' },
  ] } });
  assert.equal(r.available, true);
  assert.ok('accuracy' in r.metrics);
});

test('detect_incidents tool (account-wide) returns a scan', async () => {
  const { ctx } = ctxWithAi(sampleData());
  const r = await registry.get('detect_incidents').run(ctx, { listId: null });
  assert.equal(r.scope, 'account');
});

test('AI tools surface missing-list errors (404 propagated, never faked)', async () => {
  // Ownership enforcement itself is covered in ai-use-cases.test.js against a
  // user-aware fake; the shared tool fake keys only on listId, so here we assert
  // that a genuinely unknown list propagates the underlying 404 rather than the
  // tool inventing a result.
  const { ctx } = ctxWithAi(sampleData());
  await assert.rejects(
    async () => registry.get('get_campaign_risk').run(ctx, { listId: 'does-not-exist' }),
    (e) => e.status === 404
  );
});
