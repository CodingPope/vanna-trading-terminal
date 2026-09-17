import { StoreProvider } from '@/store';
import { lazy, Suspense, useEffect } from 'react';
const LandingPage = lazy(() => import('@/pages/LandingPage').then(m => ({ default: m.LandingPage })));

const Dashboard = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.Dashboard })));
import { useUIStore } from '@/store/uiStore';

function AppContent() {
  const currentView = useUIStore(s => s.currentView);
  const highContrast = useUIStore(s => s.settings.highContrastMode);

  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast);
    return () => document.documentElement.classList.remove('high-contrast');
  }, [highContrast]);

  return (
    <>
      <Suspense fallback={<div className="p-8 text-vanna-text" role="status">Loading VANNA…</div>}>
      {currentView === 'landing' && <LandingPage />}
      {currentView === 'dashboard' && <Dashboard />}
      </Suspense>
    </>
  );
}

function App() {
  return (
    <StoreProvider>
      <AppContent />
    </StoreProvider>
  );
}

export default App;
