import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ActivatePage from './pages/ActivatePage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import AcceptInvitationPage from './pages/AcceptInvitationPage'
import WorkspaceListPage from './pages/WorkspaceListPage'
import WorkspaceSetupPage from './pages/WorkspaceSetupPage'
import WorkspaceMembersPage from './pages/WorkspaceMembersPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import RouteEditorPage from './pages/RouteEditorPage'
import SystemUsersPage from './pages/SystemUsersPage'
import Layout from './components/Layout'

export default function App() {
  const { token, loadingMe } = useAuth()

  // Public routes always available
  const publicRoutes = (
    <>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/activate" element={<ActivatePage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invitations/accept" element={<AcceptInvitationPage />} />
    </>
  )

  if (!token) {
    return (
      <Routes>
        {publicRoutes}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  if (loadingMe) {
    return <div className="flex items-center justify-center h-screen text-gray-500">Loading…</div>
  }

  return (
    <Layout>
      <Routes>
        {publicRoutes}
        <Route path="/" element={<Navigate to="/workspaces" replace />} />
        <Route path="/workspaces" element={<WorkspaceListPage />} />
        <Route path="/workspaces/new" element={<WorkspaceSetupPage />} />
        <Route path="/w/:workspaceSlug/projects" element={<ProjectsPage />} />
        <Route path="/w/:workspaceSlug/projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="/w/:workspaceSlug/projects/:projectId/routes/new" element={<RouteEditorPage />} />
        <Route path="/w/:workspaceSlug/projects/:projectId/routes/:routeId/edit" element={<RouteEditorPage />} />
        <Route path="/w/:workspaceSlug/members" element={<WorkspaceMembersPage />} />
        <Route path="/admin/users" element={<SystemUsersPage />} />
        <Route path="*" element={<Navigate to="/workspaces" replace />} />
      </Routes>
    </Layout>
  )
}
