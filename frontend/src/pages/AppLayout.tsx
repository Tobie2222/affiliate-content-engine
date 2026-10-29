import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABEL, useOrg } from '../org/OrgContext';
import { CreateOrgForm } from './CreateOrgForm';

export function AppLayout() {
  const { user, logout } = useAuth();
  const { status, error, orgs, current, select, reload } = useOrg();
  const [creating, setCreating] = useState(false);

  if (status === 'loading' && orgs.length === 0) {
    return <main className="center-note"><p className="muted">Đang tải tổ chức…</p></main>;
  }
  if (status === 'error') {
    return (
      <main className="center-note">
        <p className="notice notice-error" role="alert">{error}</p>
        <button type="button" className="btn" onClick={() => void reload()}>Thử lại</button>
      </main>
    );
  }
  if (orgs.length === 0) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <p className="muted">Mỗi tổ chức có văn phòng AI, sản phẩm và nội dung riêng. Hãy tạo tổ chức đầu tiên của bạn.</p>
          <CreateOrgForm title="Tạo tổ chức" />
          <button type="button" className="link-btn" onClick={() => void logout()}>Đăng xuất</button>
        </div>
      </main>
    );
  }

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Điều hướng chính">
        <div className="brand">Affiliate Content Engine</div>

        <label className="org-picker">
          Tổ chức
          <select value={current?.id ?? ''} onChange={(e) => select(e.target.value)}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
        {current && <p className="muted small role-line">Vai trò: {ROLE_LABEL[current.role]}</p>}

        <ul className="nav">
          <li><NavLink to="/office">Văn phòng AI</NavLink></li>
          <li><NavLink to="/content">Bài viết</NavLink></li>
          <li><NavLink to="/products">Sản phẩm</NavLink></li>
          <li><NavLink to="/media">Media</NavLink></li>
          <li><NavLink to="/accounts">Tài khoản Threads</NavLink></li>
        </ul>

        <div className="side-foot">
          {creating ? (
            <div className="mini-form">
              <CreateOrgForm title="Tổ chức mới" onDone={() => setCreating(false)} />
              <button type="button" className="link-btn" onClick={() => setCreating(false)}>Hủy</button>
            </div>
          ) : (
            <button type="button" className="link-btn" onClick={() => setCreating(true)}>Tạo tổ chức mới</button>
          )}
          <p className="muted small user-line">{user?.displayName ?? user?.email}</p>
          <button type="button" className="link-btn" onClick={() => void logout()}>Đăng xuất</button>
        </div>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
