import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { OrgProvider } from './org/OrgContext';
import { AppLayout } from './pages/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { OfficePage } from './pages/OfficePage';
import { ProductsPage } from './pages/ProductsPage';

function Protected() {
  const { status } = useAuth();
  if (status === 'loading') {
    return <main className="center-note"><p className="muted">Đang khôi phục phiên đăng nhập…</p></main>;
  }
  if (status === 'anon') {
    return <Navigate to="/login" replace />;
  }
  return (
    <OrgProvider>
      <AppLayout />
    </OrgProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Protected />}>
        <Route path="/office" element={<OfficePage />} />
        <Route path="/products" element={<ProductsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/office" replace />} />
    </Routes>
  );
}
