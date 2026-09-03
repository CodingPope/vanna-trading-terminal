import { StoreProvider } from '@/store';
import { LandingPage } from '@/pages/LandingPage';
import { Dashboard } from '@/pages/Dashboard';
import { useUIStore } from '@/store/uiStore';

function AppContent() {
  const currentView = useUIStore(s => s.currentView);

  return (
    <>
      {currentView === 'landing' && <LandingPage />}
      {currentView === 'dashboard' && <Dashboard />}
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
