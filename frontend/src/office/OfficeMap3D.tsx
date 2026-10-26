import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Arrows, Backdrop, Person } from './OfficeMap';
import { DEFAULT_ROOF, ROOF_COLOR, STATUS_LABEL } from './labels';
import type { AgentNode, OfficeState } from './officeState';

const TILT = 56; // độ nghiêng mặt phẳng so với màn hình
const DEFAULT_YAW = -30;
const STEP = 30;
const RAD = Math.PI / 180;

/** Độ sáng của một mặt theo hướng pháp tuyến trên màn hình; ánh sáng đến từ phía trước bên trái. */
function shade(normalDeg: number, boost = 0): number {
  return Math.min(1.12, 0.66 + boost + 0.34 * Math.max(0, Math.cos((normalDeg - 125) * RAD)));
}

function normalizeYaw(v: number): number {
  return ((((v + 180) % 360) + 360) % 360) - 180;
}

/** Vừa khung hình dù mặt phẳng xoay ở góc nào (hình chữ nhật 16:10 xoay sẽ rộng hơn). */
function fitScale(yaw: number): number {
  const c = Math.abs(Math.cos(yaw * RAD));
  const s = Math.abs(Math.sin(yaw * RAD));
  const fitX = 0.94 / (c + 0.625 * s);
  const fitY = 0.62 / (Math.cos(TILT * RAD) * (s + 0.625 * c) + 0.13);
  return Math.min(fitX, fitY);
}

function Box({ roof, yaw }: { roof: string; yaw: number }) {
  const ks = [0, 1, 2, 3];
  return (
    <div className="box">
      {ks.map((k) => (
        <div key={`w${k}`} className="face wall" style={{ '--k': k, '--br': shade(90 + k * 90 + yaw) } as CSSProperties}>
          <i className="win a" />
          <i className="win b" />
          {k === 0 && <i className="door" style={{ background: roof }} />}
        </div>
      ))}
      {ks.map((k) => (
        <div
          key={`r${k}`}
          className="face roof"
          style={{ '--k': k, '--br': shade(90 + k * 90 + yaw, 0.1), background: roof } as CSSProperties}
        />
      ))}
    </div>
  );
}

function BuildingBody({ node, yaw }: { node: AgentNode; yaw: number }) {
  const roof = ROOF_COLOR[node.key] ?? DEFAULT_ROOF;
  return (
    <div className="b3" data-status={node.status} style={{ left: `${node.mapX}%`, top: `${node.mapY}%` }}>
      <div className="b3-shadow" />
      <Box roof={roof} yaw={yaw} />
    </div>
  );
}

/** Nhãn nằm ở lớp 3D riêng (cùng phép biến đổi) để luôn hiện phía trên mái nhà, không bị mặt nhà che hay cắt. */
function BuildingLabel({ node }: { node: AgentNode }) {
  const roof = ROOF_COLOR[node.key] ?? DEFAULT_ROOF;
  return (
    <div
      className="b3"
      data-status={node.status}
      style={{ left: `${node.mapX}%`, top: `${node.mapY}%` }}
      role="img"
      aria-label={`${node.displayName}: ${STATUS_LABEL[node.status]}`}
    >
      <div className="bb b3-top">
        <div className="stack">
          {node.bubble && (
            <div className="bubble" data-kind={node.bubble.kind}>
              {node.bubble.text}
            </div>
          )}
          <div className="plate-in">
            <span className="ring3">
              <Person roof={roof} />
            </span>
            <div className="agent-name">{node.displayName}</div>
            <div className="agent-status">{STATUS_LABEL[node.status]}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function OfficeMap3D({ state, initialYaw = DEFAULT_YAW }: { state: OfficeState; initialYaw?: number }) {
  const [yaw, setYaw] = useState(initialYaw);
  const [dragging, setDragging] = useState(false);
  const [width, setWidth] = useState(800);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; yaw: number } | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) {
      return;
    }
    setWidth(el.clientWidth || 800);
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) {
        setWidth(w);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'touch' || e.button !== 0) {
      return; // cảm ứng dùng nút xoay để không chặn việc cuộn trang
    }
    drag.current = { x: e.clientX, yaw };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (drag.current) {
      setYaw(normalizeYaw(drag.current.yaw + (e.clientX - drag.current.x) * 0.35));
    }
  }
  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  const nodes = state.order.map((k) => state.agents[k]).filter((n): n is AgentNode => Boolean(n));
  const style = {
    '--u': `${width / 160}px`,
    '--yaw': `${yaw}deg`,
    '--tilt': `${TILT}deg`,
    '--fit': fitScale(yaw),
  } as CSSProperties;

  return (
    <div className="map-wrap">
      <div className="map-scroll">
        <div
          ref={stageRef}
          className="map3d"
          data-dragging={dragging}
          style={style}
          role="group"
          aria-label="Bản đồ văn phòng AI dạng 3D. Kéo chuột hoặc dùng nút bên dưới để xoay."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="world">
            <div className="ground">
              <div className="ground-top">
                <Backdrop nodes={nodes} hub={state.agents['director']} />
                <Arrows state={state} />
              </div>
              <div className="side side-front" />
              <div className="side side-back" />
              <div className="side side-left" />
              <div className="side side-right" />
            </div>
            {nodes.map((n) => (
              <BuildingBody key={n.key} node={n} yaw={yaw} />
            ))}
          </div>
          <div className="world world-labels" aria-hidden="false">
            {nodes.map((n) => (
              <BuildingLabel key={n.key} node={n} />
            ))}
          </div>
        </div>
      </div>
      <div className="map-tools" role="group" aria-label="Xoay bản đồ">
        <button type="button" className="btn btn-small" onClick={() => setYaw((v) => normalizeYaw(v - STEP))}>Xoay trái</button>
        <button type="button" className="btn btn-small" onClick={() => setYaw((v) => normalizeYaw(v + STEP))}>Xoay phải</button>
        <button type="button" className="btn btn-small" onClick={() => setYaw(DEFAULT_YAW)}>Góc nhìn mặc định</button>
        <span className="muted small">Kéo chuột trên bản đồ để xoay.</span>
      </div>
    </div>
  );
}
