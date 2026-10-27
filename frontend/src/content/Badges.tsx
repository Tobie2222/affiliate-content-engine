import {
  STATUS_LABEL,
  STATUS_TONE,
  VERDICT_LABEL,
  VERDICT_TONE,
  type PostStatus,
  type QaVerdict,
} from './content';

export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span className="badge" data-tone={STATUS_TONE[status]}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function VerdictBadge({ verdict }: { verdict: QaVerdict }) {
  return (
    <span className="badge" data-tone={VERDICT_TONE[verdict]}>
      QA: {VERDICT_LABEL[verdict]}
    </span>
  );
}
