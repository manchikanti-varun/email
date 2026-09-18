// Barrel for the generic MailHealth design system (presentation primitives).
// These components have NO API, verification, or backend-shape knowledge.
// Domain-specific visualizations live in components/domain instead.
export { Button } from './Button';
export type { ButtonVariant, ButtonSize } from './Button';
export { Input, Select, Checkbox, Field } from './Input';
export { Card, StatCard, PageHeader } from './Card';
export { Pill, StatusBadge } from './Badge';
export { Progress } from './Progress';
export { Tabs } from './Tabs';
export type { TabItem } from './Tabs';
export { Tooltip } from './Tooltip';
export { Table, THead, TBody, TR } from './Table';
export { Modal } from './Modal';
export { toast, Toaster } from './Toast';
export { LoadingState, EmptyState, ErrorState } from './States';
export { SkeletonCards, SkeletonRows } from './Skeleton';
export { NavIcon } from './NavIcon';

// ---- Backward-compatibility re-exports ----------------------------------
// The previous single-file components/ui.tsx exported both generic primitives
// AND domain widgets. Existing views import all of these from '../components/ui'.
// To keep those imports working unchanged after the domain/primitive split,
// we re-export the domain widgets (their real home is components/domain) here.
// New code should import domain widgets from '../components/domain' directly.
export {
  ScoreRing,
  MetricBar,
  LineChart,
  StackedBar,
  Badge,
  ActionBadge,
  DeliverabilityLabel,
  ConfidenceLabel,
  SignalRow,
  RiskChips,
  CalibratedConfidencePanel,
  CalibratedBadge,
  ConfidencePanel,
  KindTag,
  ConfTag,
  StmtList,
} from '../domain';
