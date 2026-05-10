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
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link to="/workspaces" className="font-bold text-lg text-indigo-600">Geehoo Gateway</Link>
          <nav className="flex items-center gap-2">
            {mainNav.map(renderNavLink)}
            {workspaceNav.length > 0 && (
              <>
                <span className="mx-2 h-5 w-px bg-gray-300" aria-hidden="true" />
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
              className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
              aria-label="Switch workspace"
            >
              <option value="" disabled>
                Switch workspace…
              </option>
              {memberships.map((m) => (
                <option key={m.workspace.id} value={m.workspace.slug}>
                  {m.workspace.name} ({m.workspace.slug})
                </option>
              ))}
            </select>
          )}
          {user && <ProfileMenu />}
          <button
            onClick={logout}
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
