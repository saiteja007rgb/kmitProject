import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import ExamLobby from './pages/candidate/ExamLobby';
import ExamPortal from './pages/candidate/ExamPortal';
import AdminDashboard from './pages/invigilator/AdminDashboard';

function MainApp() {
  const { user, loading } = useAuth();
  const [activeSession, setActiveSession] = useState(null);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 dark:border-indigo-400"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-150">
        <Navbar />
        <LoginPage />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col transition-colors duration-150">
      <Navbar />

      <main className="flex-1">
        {user.role === 'admin' || user.role === 'invigilator' ? (
          <AdminDashboard />
        ) : (
          <div>
            {!activeSession ? (
              <ExamLobby onStartExam={(session) => setActiveSession(session)} />
            ) : (
              <ExamPortal
                initialSession={activeSession}
                onExit={() => setActiveSession(null)}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </ThemeProvider>
  );
}

