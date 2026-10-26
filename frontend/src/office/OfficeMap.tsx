import type { CSSProperties } from 'react';
import { DEFAULT_ROOF, ROOF_COLOR, STATUS_LABEL } from './labels';
import type { AgentNode, OfficeState } from './officeState';

// Bản đồ vẽ trên hệ tọa độ 160x100 (tỉ lệ 16:10), khớp với khung hiển thị.
const W = 160;
const H = 100;
export const px = (node: AgentNode) => (node.mapX / 100) * W;
export const py = (node: AgentNode) => (node.mapY / 100) * H;

const TREES: ReadonlyArray<[number, number]> = [
  [8, 14],
  [31, 90],
  [149, 27],
  [101, 93],
  [58, 10],
  [152, 60],
  [6, 62],
];

export function Backdrop({ nodes, hub }: { nodes: AgentNode[]; hub: AgentNode | undefined }) {
  const cx = hub ? px(hub) : W / 2;
  const cy = hub ? py(hub) : H / 2;
  return (
    <svg className="map-svg" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <rect width={W} height={H} fill="var(--meadow)" />
      <ellipse cx="142" cy="84" rx="15" ry="8" fill="var(--water)" />
      <ellipse cx="139" cy="82" rx="6" ry="2.4" fill="#fff" opacity="0.35" />
      {nodes.map((n) => (
        <line
          key={`road-${n.key}`}
          x1={cx}
          y1={cy}
          x2={px(n)}
          y2={py(n)}
          stroke="var(--road)"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
      ))}
      <ellipse cx={cx} cy={cy} rx="15" ry="9" fill="var(--road)" />
      <ellipse cx={cx} cy={cy} rx="15" ry="9" fill="none" stroke="var(--road-edge)" strokeWidth="0.8" />
      {TREES.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x - 0.8} y={y + 2} width="1.6" height="3.2" fill="#8B6B4A" />
          <circle cx={x} cy={y} r="4.4" fill="var(--tree)" />
          <circle cx={x - 1.4} cy={y - 1.2} r="1.6" fill="#fff" opacity="0.14" />
        </g>
      ))}
    </svg>
  );
}

export function Arrows({ state }: { state: OfficeState }) {
  return (
    <svg className="map-svg map-arrows" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {state.handoffs.map((h) => {
        const from = state.agents[h.from];
        const to = state.agents[h.to];
        if (!from || !to) {
          return null;
        }
        return (
          <g key={h.id}>
            <line
              className="handoff-line"
              x1={px(from)}
              y1={py(from)}
              x2={px(to)}
              y2={py(to)}
              stroke="var(--accent)"
              strokeWidth="1.1"
              strokeDasharray="3 2.4"
              strokeLinecap="round"
            />
            <circle cx={px(to)} cy={py(to)} r="2.2" fill="var(--accent)" />
          </g>
        );
      })}
    </svg>
  );
}

function Building({ roof }: { roof: string }) {
  return (
    <svg className="building" viewBox="0 0 64 52" aria-hidden="true">
      <rect x="9" y="22" width="46" height="27" rx="3" fill="#FFFFFF" stroke="var(--ink)" strokeWidth="1.5" />
      <path d="M4 24 32 4l28 20z" fill={roof} stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="26" y="32" width="12" height="17" rx="2" fill={roof} opacity="0.85" />
      <rect x="13" y="29" width="9" height="8" rx="1.5" fill="#CFE6F0" stroke="var(--ink)" strokeWidth="1" />
      <rect x="42" y="29" width="9" height="8" rx="1.5" fill="#CFE6F0" stroke="var(--ink)" strokeWidth="1" />
    </svg>
  );
}

export function Person({ roof }: { roof: string }) {
  return (
    <svg className="person" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#fff" />
      <circle cx="12" cy="9.5" r="4" fill="#F2C9A5" stroke="var(--ink)" strokeWidth="1" />
      <path d="M4.5 21c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5" fill={roof} stroke="var(--ink)" strokeWidth="1" />
    </svg>
  );
}

function AgentToken({ node }: { node: AgentNode }) {
  const roof = ROOF_COLOR[node.key] ?? DEFAULT_ROOF;
  const edge = node.mapX < 24 ? 'left' : node.mapX > 76 ? 'right' : 'center';
  const style = { left: `${node.mapX}%`, top: `${node.mapY}%` } as CSSProperties;
  return (
    <div className="agent" style={style} data-status={node.status} aria-label={`${node.displayName}: ${STATUS_LABEL[node.status]}`}>
      {node.bubble && (
        <div className="bubble" data-kind={node.bubble.kind} data-edge={edge}>
          {node.bubble.text}
        </div>
      )}
      <div className="agent-body">
        <Building roof={roof} />
        <span className="person-ring">
          <Person roof={roof} />
        </span>
      </div>
      <div className="agent-name">{node.displayName}</div>
      <div className="agent-status">{STATUS_LABEL[node.status]}</div>
    </div>
  );
}

export function OfficeMap({ state }: { state: OfficeState }) {
  const nodes = state.order.map((k) => state.agents[k]).filter((n): n is AgentNode => Boolean(n));
  return (
    <div className="map-scroll">
      <div className="map" role="group" aria-label="Bản đồ văn phòng AI">
        <Backdrop nodes={nodes} hub={state.agents['director']} />
        <Arrows state={state} />
        {nodes.map((n) => (
          <AgentToken key={n.key} node={n} />
        ))}
      </div>
    </div>
  );
}
