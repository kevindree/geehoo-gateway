import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { clsx } from 'clsx'

export default function Layout({ children }: { children: ReactNode }) {
  const { logout } = useAuth()
  const location = useLocation()

  const navItems = [{ label: 'Projects', href: '/projects' }]

  return (
    <div className="h-screen overflow-hidden flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="font-bold text-lg text-indigo-600">API Gate</span>
          <nav className="flex gap-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className={clsx(
                  'text-sm font-medium px-3 py-1.5 rounded-md transition-colors',
                  location.pathname.startsWith(item.href)
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:text-gray-900',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <button
          onClick={logout}
          className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          Sign out
        </button>
      </header>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
