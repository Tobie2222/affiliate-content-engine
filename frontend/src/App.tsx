import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { OrgProvider } from './org/OrgContext';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { AppLayout } from './pages/AppLayout';
import { ContentPage } from './pages/ContentPage';
import { LoginPage } from './pages/LoginPage';
import { MediaDetailPage } from './pages/MediaDetailPage';
import { MediaPage } from './pages/MediaPage';
import { OfficePage } from './pages/OfficePage';
import { PostDetailPage } from './pages/PostDetailPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { ProductsPage } from './pages/ProductsPage';
import { SocialAccountsPage } from './pages/SocialAccountsPage';

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
        <Route path="/products/:productId" element={<ProductDetailPage />} />
        <Route path="/media" element={<MediaPage />} />
        <Route path="/media/:assetId" element={<MediaDetailPage />} />
        <Route path="/content" element={<ContentPage />} />
        <Route path="/content/:postId" element={<PostDetailPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/accounts" element={<SocialAccountsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/office" replace />} />
    </Routes>
  );
}
