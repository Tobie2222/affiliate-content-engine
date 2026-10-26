import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';

export type Role = 'OWNER' | 'ADMIN' | 'CONTENT_EDITOR' | 'REVIEWER' | 'ANALYST';

export interface OrgItem {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Chủ sở hữu',
  ADMIN: 'Quản trị',
  CONTENT_EDITOR: 'Biên tập nội dung',
  REVIEWER: 'Người duyệt',
  ANALYST: 'Phân tích',
};

/** Khớp quyền office.control ở backend: chỉ OWNER và ADMIN được tạm dừng agent. */
export function canControlOffice(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

type OrgStatus = 'loading' | 'ready' | 'error';

interface OrgContextValue {
  status: OrgStatus;
  error: string | null;
  orgs: OrgItem[];
  current: OrgItem | null;
  select(id: string): void;
  reload(): Promise<void>;
  create(name: string): Promise<void>;
}

const OrgContext = createContext<OrgContextValue | null>(null);
const SELECTED_KEY = 'ace.orgId';

function readSelected(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<OrgStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(readSelected());

  const reload = useCallback(async () => {
    setStatus('loading');
    try {
      setOrgs(await api<OrgItem[]>('/organizations'));
      setError(null);
      setStatus('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được danh sách tổ chức.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      // bỏ qua
    }
  }, []);

  const create = useCallback(
    async (name: string) => {
      const created = await api<{ id: string }>('/organizations', { method: 'POST', body: { name } });
      await reload();
      if (created?.id) {
        select(created.id);
      }
    },
    [reload, select],
  );

  const current = orgs.find((o) => o.id === selectedId) ?? orgs[0] ?? null;
  const value = useMemo(
    () => ({ status, error, orgs, current, select, reload, create }),
    [status, error, orgs, current, select, reload, create],
  );
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) {
    throw new Error('useOrg phải nằm trong OrgProvider');
  }
  return ctx;
}
