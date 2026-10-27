import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from './client';

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Số mã HTTP của lỗi gần nhất (0 = mất kết nối), để màn hình phân biệt 403/404. */
  status: number | null;
  reload(): Promise<void>;
}

/**
 * Tải dữ liệu GET. `path` rỗng nghĩa là chưa cần tải. Kết quả của yêu cầu cũ không ghi đè yêu cầu mới
 * (đổi tổ chức hoặc bộ lọc nhanh). Đổi `path` thì giữ dữ liệu cũ cho tới khi dữ liệu mới về, tránh nhấp nháy.
 */
export function useApi<T>(path: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (path === null) {
      setData(null);
      setError(null);
      setStatus(null);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (mine === seq.current) {
        setData(result);
        setError(null);
        setStatus(null);
      }
    } catch (e) {
      if (mine === seq.current) {
        setError(e instanceof Error ? e.message : 'Không tải được dữ liệu.');
        setStatus(e instanceof ApiError ? e.status : null);
      }
    } finally {
      if (mine === seq.current) {
        setLoading(false);
      }
    }
  }, [path]);

  useEffect(() => {
    void load();
    return () => {
      seq.current += 1; // hủy hiệu lực yêu cầu đang bay khi đổi path hoặc rời trang
    };
  }, [load]);

  return { data, error, loading, status, reload: load };
}
