import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'wait' | 'good' | 'bad';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className="badge" data-tone={tone}>
      {children}
    </span>
  );
}
