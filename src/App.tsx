import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LauncherProvider } from './state/LauncherContext';
import { AppLayout } from './components/AppLayout';
import { LandingPage } from './pages/LandingPage';
import { WizardPage } from './pages/WizardPage';
import { ReviewPage } from './pages/ReviewPage';
import { ValidationPage } from './pages/ValidationPage';
import { ResetPage } from './pages/ResetPage';

const basename = (window as unknown as { CRIBL_BASE_PATH?: string }).CRIBL_BASE_PATH;

function App() {
  return (
    <LauncherProvider>
      <BrowserRouter basename={basename}>
        <AppLayout>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/wizard" element={<WizardPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/validate" element={<ValidationPage />} />
            <Route path="/reset" element={<ResetPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </LauncherProvider>
  );
}

export default App;
