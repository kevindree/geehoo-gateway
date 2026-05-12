import { ReactNode, useMemo } from 'react'
import { Link, useLocation, useMatch, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { clsx } from 'clsx'
import ProfileMenu from './ProfileMenu'

export default function Layout({ children }: { children: ReactNode }) {
  const { logout, user, memberships } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  // Layout is rendered outside <Routes>, so useParams() returns {}. Match the
  // workspace slug from the URL pattern directly.
  const wsMatch = useMatch('/w/:workspaceSlug/*')
  const currentSlug = wsMatch?.params.workspaceSlug

  const { mainNav, workspaceNav } = useMemo(() => {
    const main: Array<{ label: string; href: string }> = [{ label: 'Workspaces', href: '/workspaces' }]
    if (user?.systemRole === 'SUPER_ADMIN') {
      main.push({ label: 'System Users', href: '/admin/users' })
    }
    const ws: Array<{ label: string; href: string }> = []
    if (currentSlug) {
      ws.push({ label: 'Projects', href: `/w/${currentSlug}/projects` })
      ws.push({ label: 'Members', href: `/w/${currentSlug}/members` })
    }
    return { mainNav: main, workspaceNav: ws }
  }, [currentSlug, user])

  const renderNavLink = (item: { label: string; href: string }) => {
    const active =
      item.href === '/workspaces'
        ? location.pathname === '/workspaces'
        : location.pathname.startsWith(item.href)
    return (
      <Link
        key={item.href}
        to={item.href}
        className={clsx(
          'text-sm font-medium px-3 py-1.5 rounded-md transition-colors',
          active ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900',
        )}
      >
        {item.label}
      </Link>
    )
  }

  const handleSwitchWorkspace = (slug: string) => {
    navigate(`/w/${slug}/projects`)
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          {/* Brand */}
          <Link to="/workspaces" className="flex items-center gap-2 group">
            <span className="flex items-center justify-center h-7 w-7 rounded-lg bg-indigo-600 text-white">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                <path d="M10 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 1ZM5.05 3.05a.75.75 0 0 1 1.06 0l1.062 1.06A.75.75 0 1 1 6.11 5.173L5.05 4.11a.75.75 0 0 1 0-1.06ZM14.95 3.05a.75.75 0 0 1 0 1.06l-1.06 1.062a.75.75 0 0 1-1.062-1.061l1.061-1.061a.75.75 0 0 1 1.06 0ZM3 10a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 3 10ZM14.75 10a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1-.75-.75ZM5.05 16.95a.75.75 0 0 1 0-1.06l1.06-1.062a.75.75 0 0 1 1.062 1.061l-1.061 1.061a.75.75 0 0 1-1.061 0ZM14.95 16.95a.75.75 0 0 1-1.061 0l-1.061-1.061a.75.75 0 0 1 1.061-1.061l1.061 1.06a.75.75 0 0 1 0 1.062ZM10 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
              </svg>
            </span>
            <span className="font-semibold text-gray-900 text-sm group-hover:text-indigo-600 transition-colors">Geehoo Gateway</span>
          </Link>

          {/* Divider */}
          <span className="h-5 w-px bg-gray-200" aria-hidden="true" />

          {/* Navigation */}
          <nav className="flex items-center gap-1">
            {mainNav.map(renderNavLink)}
            {workspaceNav.length > 0 && (
              <>
                <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden="true" />
                {workspaceNav.map(renderNavLink)}
              </>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {memberships.length > 0 && (
            <select
              value={currentSlug ?? ''}
              onChange={(e) => e.target.value && handleSwitchWorkspace(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50 text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              aria-label="Switch workspace"
            >
              <option value="" disabled>Switch workspace…</option>
              {memberships.map((m) => (
                <option key={m.workspace.id} value={m.workspace.slug}>
                  {m.workspace.name}
                </option>
              ))}
            </select>
          )}
          {user && <ProfileMenu onLogout={logout} />}
        </div>
      </header>
      <main className="flex-1 overflow-auto bg-gray-50">{children}</main>
    </div>
  )
}
