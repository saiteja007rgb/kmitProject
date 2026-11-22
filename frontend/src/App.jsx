import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireRole, useAuth } from './auth/AuthProvider';
import { AdminLayout } from './components/layout/AdminLayout';
import { CandidateLayout } from './components/layout/CandidateLayout';
import { Spinner } from './components/ui';
import { LoginPage } from './features/auth/LoginPage';
import { ChangePasswordPage } from './features/auth/ChangePasswordPage';

// Lazy-loaded feature bundles keep login & initial load lightweight (no CodeMirror or MediaPipe upfront).
const CandidateDashboardPage = lazy(() => import('./features/candidate/CandidateDashboardPage'));
const PreExamCheckPage = lazy(() => import('./features/candidate/PreExamCheckPage'));
const ExamRoomPage = lazy(() => import('./features/candidate/ExamRoomPage'));
const ResultReviewPage = lazy(() => import('./features/candidate/ResultReviewPage'));

const AdminDashboardPage = lazy(() => import('./features/admin/AdminDashboardPage'));
const CandidatesPage = lazy(() => import('./features/admin/CandidatesPage'));
const BatchesPage = lazy(() => import('./features/admin/BatchesPage'));
const StaffPage = lazy(() => import('./features/admin/StaffPage'));
const ExamsListPage = lazy(() => import('./features/admin/ExamsListPage'));
const ExamEditorPage = lazy(() => import('./features/admin/ExamEditorPage'));
const ExamWorkspacePage = lazy(() => import('./features/admin/ExamWorkspacePage'));
const AuditLogPage = lazy(() => import('./features/admin/AuditLogPage'));

function PageFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

function RoleHomeRedirect() {
  const { user, initializing } = useAuth();
  if (initializing) return <PageFallback />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <Navigate to="/change-password" replace />;
  return <Navigate to={user.role === 'candidate' ? '/candidate' : '/admin'} replace />;
}

export function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/change-password"
          element={
            <RequireRole>
              <ChangePasswordPage />
            </RequireRole>
          }
        />
        <Route path="/" element={<RoleHomeRedirect />} />

        {/* Candidate portal */}
        <Route
          element={
            <RequireRole allowedRoles={['candidate']}>
              <CandidateLayout />
            </RequireRole>
          }
        >
          <Route path="/candidate" element={<CandidateDashboardPage />} />
          <Route path="/candidate/exams/:examId/check" element={<PreExamCheckPage />} />
          <Route path="/candidate/attempts/:attemptId/result" element={<ResultReviewPage />} />
        </Route>

        {/* Distraction-free exam room */}
        <Route
          path="/candidate/attempts/:attemptId"
          element={
            <RequireRole allowedRoles={['candidate']}>
              <ExamRoomPage />
            </RequireRole>
          }
        />

        {/* Admin & Invigilator console */}
        <Route
          path="/admin"
          element={
            <RequireRole allowedRoles={['admin', 'invigilator']}>
              <AdminLayout />
            </RequireRole>
          }
        >
          <Route index element={<AdminDashboardPage />} />
          <Route path="exams" element={<ExamsListPage />} />
          <Route
            path="exams/new"
            element={
              <RequireRole allowedRoles={['admin']}>
                <ExamEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="exams/:examId/edit"
            element={
              <RequireRole allowedRoles={['admin']}>
                <ExamEditorPage />
              </RequireRole>
            }
          />
          <Route path="exams/:examId" element={<ExamWorkspacePage />} />
          <Route path="candidates" element={<CandidatesPage />} />
          <Route path="batches" element={<BatchesPage />} />
          <Route
            path="staff"
            element={
              <RequireRole allowedRoles={['admin']}>
                <StaffPage />
              </RequireRole>
            }
          />
          <Route
            path="audit"
            element={
              <RequireRole allowedRoles={['admin']}>
                <AuditLogPage />
              </RequireRole>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
