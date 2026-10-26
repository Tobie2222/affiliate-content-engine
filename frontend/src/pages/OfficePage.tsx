import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api/client';
import { OfficeMap } from '../office/OfficeMap';
import { OfficeMap3D } from '../office/OfficeMap3D';
import { EVENT_LABEL, STATUS_LABEL } from '../office/labels';
import type { ApiAgentEvent, OfficeState } from '../office/officeState';
import { useOfficeStream, type Connection } from '../office/useOfficeStream';
import { canControlOffice, useOrg, type OrgItem } from '../org/OrgContext';

const CONNECTION_LABEL: Record<Connection, string> = {
  connecting: 'Đang kết nối…',
  live: 'Đang trực tiếp',
  offline: 'Mất kết nối, đang thử lại',
};

interface SimStep {
  agentKey: string;
  type: 'TASK_STARTED' | 'HANDOFF' | 'NEEDS_APPROVAL' | 'NOTE';
  message: string;
  targetAgentKey?: string;
}

// Chuỗi sự kiện mô phỏng một vòng làm việc. Chỉ để xem giao diện chạy, không tạo nội dung thật.
const SIMULATION: SimStep[] = [
  { agentKey: 'director', type: 'TASK_STARTED', message: '[Mô phỏng] Nhận mục tiêu: 3 bài về bình giữ nhiệt' },
  { agentKey: 'director', type: 'HANDOFF', targetAgentKey: 'research', message: '[Mô phỏng] Giao nghiên cứu sản phẩm' },
  { agentKey: 'research', type: 'HANDOFF', targetAgentKey: 'writer', message: '[Mô phỏng] Chọn xong 2 sản phẩm, chuyển cho Viết bài' },
  { agentKey: 'writer', type: 'TASK_STARTED', message: '[Mô phỏng] Đang viết 3 bản caption' },
  { agentKey: 'writer', type: 'HANDOFF', targetAgentKey: 'qa', message: '[Mô phỏng] Gửi bản nháp sang QA·QC' },
  { agentKey: 'qa', type: 'NEEDS_APPROVAL', message: '[Mô phỏng] Bản nháp đạt kiểm tra, chờ người duyệt' },
];

const STEP_DELAY_MS = 2000;

type MapView = '2d' | '3d';
const VIEW_KEY = 'ace.mapView';

function readView(): MapView {
  try {
    return localStorage.getItem(VIEW_KEY) === '2d' ? '2d' : '3d';
  } catch {
    return '3d';
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

function nameOf(state: OfficeState, key: string): string {
  return state.agents[key]?.displayName ?? key;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('vi-VN', { hour12: false });
}

function OfficeView({ org }: { org: OrgItem }) {
  const { state, dispatch, connection, error } = useOfficeStream(org.id);
  const canControl = canControlOffice(org.role);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const simAbort = useRef<AbortController | null>(null);
  const [view, setView] = useState<MapView>(readView);

  const changeView = useCallback((next: MapView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // bỏ qua
    }
  }, []);

  useEffect(() => () => simAbort.current?.abort(), []);

  const applyEvent = useCallback(
    (event: ApiAgentEvent) => dispatch({ type: 'event', event, now: Date.now() }),
    [dispatch],
  );

  const setAgentStatus = useCallback(
    async (key: string, status: 'IDLE' | 'PAUSED') => {
      setBusyKey(key);
      setActionError(null);
      try {
        const event = await api<ApiAgentEvent>(`/organizations/${org.id}/office/agents/${key}/status`, {
          method: 'POST',
          body: { status },
        });
        applyEvent(event);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Không đổi được trạng thái.');
      } finally {
        setBusyKey(null);
      }
    },
    [org.id, applyEvent],
  );

  const runSimulation = useCallback(async () => {
    simAbort.current?.abort();
    const ctrl = new AbortController();
    simAbort.current = ctrl;
    setSimulating(true);
    setActionError(null);
    try {
      for (const step of SIMULATION) {
        if (ctrl.signal.aborted) {
          return;
        }
        const event = await api<ApiAgentEvent>(`/organizations/${org.id}/office/dev/emit`, {
          method: 'POST',
          body: step,
          signal: ctrl.signal,
        });
        applyEvent(event);
        await delay(STEP_DELAY_MS, ctrl.signal);
      }
    } catch (e) {
      if (ctrl.signal.aborted) {
        return;
      }
      if (e instanceof ApiError && (e.status === 403 || e.status === 404) && !e.message.includes('tạm dừng')) {
        setActionError('Chế độ mô phỏng chỉ chạy khi backend ở môi trường phát triển (NODE_ENV khác production).');
      } else {
        setActionError(e instanceof Error ? e.message : 'Mô phỏng bị dừng.');
      }
    } finally {
      if (simAbort.current === ctrl) {
        setSimulating(false);
      }
    }
  }, [org.id, applyEvent]);

  const resetAll = useCallback(async () => {
    setActionError(null);
    for (const key of state.order) {
      const status = state.agents[key]?.status;
      if (status && status !== 'IDLE' && status !== 'PAUSED') {
        await setAgentStatus(key, 'IDLE');
      }
    }
  }, [state, setAgentStatus]);

  return (
    <div className="office">
      <header className="page-head">
        <div>
          <h1>Văn phòng AI</h1>
          <p className="muted">Các bộ phận phối hợp để chuẩn bị nội dung. Mọi bài đều chờ bạn duyệt trước khi đăng.</p>
        </div>
        <div className="head-tools">
          <div className="view-switch" role="group" aria-label="Kiểu hiển thị bản đồ">
            <button type="button" aria-pressed={view === '2d'} onClick={() => changeView('2d')}>2D</button>
            <button type="button" aria-pressed={view === '3d'} onClick={() => changeView('3d')}>3D</button>
          </div>
          <span className="conn" data-state={connection}>
            <span className="dot" aria-hidden="true" />
            {CONNECTION_LABEL[connection]}
          </span>
        </div>
      </header>

      {error && connection !== 'live' && <p className="notice notice-error" role="alert">{error}</p>}

      <div className="office-grid">
        {view === '3d' ? <OfficeMap3D state={state} /> : <OfficeMap state={state} />}

        <aside className="side">
          <section className="card" aria-labelledby="agents-h">
            <h2 id="agents-h">Bộ phận</h2>
            <ul className="agent-list">
              {state.order.map((key) => {
                const node = state.agents[key];
                if (!node) {
                  return null;
                }
                const paused = node.status === 'PAUSED';
                return (
                  <li key={key} data-status={node.status}>
                    <span className="pill" data-status={node.status}>{STATUS_LABEL[node.status]}</span>
                    <span className="agent-li-name">
                      {node.displayName}
                      <small>{node.department}</small>
                    </span>
                    {canControl && (
                      <button
                        type="button"
                        className="btn btn-small"
                        disabled={busyKey === key}
                        onClick={() => void setAgentStatus(key, paused ? 'IDLE' : 'PAUSED')}
                        aria-label={`${paused ? 'Cho chạy lại' : 'Tạm dừng'} bộ phận ${node.displayName}`}
                      >
                        {paused ? 'Chạy lại' : 'Tạm dừng'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {!canControl && <p className="muted small">Chỉ chủ sở hữu và quản trị mới tạm dừng được bộ phận.</p>}
          </section>

          {canControl && (
            <section className="card" aria-labelledby="sim-h">
              <h2 id="sim-h">Chạy thử giao diện</h2>
              <p className="muted small">Phát một chuỗi sự kiện mô phỏng để xem các bộ phận bàn giao việc. Không tạo bài viết thật.</p>
              <div className="row">
                <button type="button" className="btn btn-primary" disabled={simulating} onClick={() => void runSimulation()}>
                  {simulating ? 'Đang mô phỏng…' : 'Chạy mô phỏng'}
                </button>
                <button type="button" className="btn" disabled={simulating} onClick={() => void resetAll()}>
                  Đưa về rảnh
                </button>
              </div>
            </section>
          )}

          {actionError && <p className="notice notice-error" role="alert">{actionError}</p>}

          <section className="card feed-card" aria-labelledby="feed-h">
            <h2 id="feed-h">Hoạt động gần đây</h2>
            {state.feed.length === 0 ? (
              <p className="muted small">Chưa có hoạt động nào. Khi một bộ phận bắt đầu việc, nó sẽ hiện ở đây.</p>
            ) : (
              <ol className="feed" role="log">
                {state.feed.map((item) => (
                  <li key={item.id} data-kind={item.type}>
                    <time>{formatTime(item.at)}</time>
                    <span>
                      <strong>{nameOf(state, item.agentKey)}</strong>
                      {item.targetAgentKey ? ` → ${nameOf(state, item.targetAgentKey)}` : ''}
                      <em>{EVENT_LABEL[item.type]}</em>
                      <br />
                      {item.text}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

export function OfficePage() {
  const { current } = useOrg();
  if (!current) {
    return null;
  }
  // key theo tổ chức để đổi tổ chức thì dựng lại toàn bộ trạng thái văn phòng.
  return <OfficeView key={current.id} org={current} />;
}
