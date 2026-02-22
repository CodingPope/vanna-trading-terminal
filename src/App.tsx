import { StoreProvider } from '@/store';
import { LandingPage } from '@/pages/LandingPage';
import { Dashboard } from '@/pages/Dashboard';
import { useUI } from '@/store';

function AppContent() {
  const { state } = useUI();

  return (
    <>
      {state.currentView === 'landing' && <LandingPage />}
      {state.currentView === 'dashboard' && <Dashboard />}
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
