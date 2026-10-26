import { useEffect, useReducer, useState, type Dispatch } from 'react';
import { ApiError, api, readStream } from '../api/client';
import {
  initialOfficeState,
  officeReducer,
  type AgentEventType,
  type ApiAgent,
  type ApiAgentEvent,
  type OfficeAction,
  type OfficeState,
} from './officeState';

export type Connection = 'connecting' | 'live' | 'offline';

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function parseEvent(data: string): ApiAgentEvent | null {
  try {
    const value = JSON.parse(data) as Partial<ApiAgentEvent>;
    if (
      value &&
      typeof value.id === 'string' &&
      typeof value.agentKey === 'string' &&
      typeof value.type === 'string' &&
      typeof value.message === 'string'
    ) {
      return {
        id: value.id,
        agentKey: value.agentKey,
        targetAgentKey: value.targetAgentKey ?? null,
        type: value.type as AgentEventType,
        message: value.message,
        payload: value.payload ?? null,
        createdAt: value.createdAt ?? new Date().toISOString(),
      };
    }
  } catch {
    // dữ liệu hỏng: bỏ qua
  }
  return null;
}

export interface OfficeStream {
  state: OfficeState;
  dispatch: Dispatch<OfficeAction>;
  connection: Connection;
  error: string | null;
}

/** Tải danh sách agent rồi nghe luồng sự kiện; tự nối lại (và đồng bộ lại trạng thái) khi mất kết nối. */
export function useOfficeStream(orgId: string): OfficeStream {
  const [state, dispatch] = useReducer(officeReducer, initialOfficeState);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;

    void (async () => {
      let attempt = 0;
      while (!signal.aborted) {
        try {
          setConnection('connecting');
          const agents = await api<ApiAgent[]>(`/organizations/${orgId}/office/agents`, { signal });
          dispatch({ type: 'load', agents });
          await readStream(
            `/organizations/${orgId}/office/stream`,
            {
              onOpen: () => {
                attempt = 0;
                setError(null);
                setConnection('live');
              },
              onData: (data) => {
                const event = parseEvent(data);
                if (event) {
                  dispatch({ type: 'event', event, now: Date.now() });
                }
              },
            },
            signal,
          );
        } catch (e) {
          if (signal.aborted) {
            return;
          }
          const message = e instanceof Error ? e.message : 'Mất kết nối với văn phòng.';
          setError(message);
          if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
            setConnection('offline');
            return; // không có quyền hoặc tổ chức không tồn tại: thử lại cũng vô ích
          }
        }
        setConnection('offline');
        attempt += 1;
        await sleep(Math.min(1000 * 2 ** attempt, 15000), signal);
      }
    })();

    return () => ctrl.abort();
  }, [orgId]);

  // Nhịp 1 giây để bong bóng và mũi tên bàn giao tự biến mất đúng hạn.
  useEffect(() => {
    const timer = setInterval(() => dispatch({ type: 'tick', now: Date.now() }), 1000);
    return () => clearInterval(timer);
  }, []);

  return { state, dispatch, connection, error };
}
