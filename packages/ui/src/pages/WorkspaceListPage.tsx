import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'

const ROLE_LABEL: Record<string, string> = { OWNER: 'Owner', ADMIN: 'Admin', MEMBER: 'Member' }

export default function WorkspaceListPage() {
  const { memberships, loadingMe } = useAuth()

  if (loadingMe) return (
    <div className="flex items-center justify-center py-24 gap-2 text-gray-400">
      <Spinner className="h-5 w-5 text-indigo-400" /> Loading…
    </div>
  )

  return (
    <div className="px-6 py-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Workspaces</h1>
          <p className="text-sm text-gray-400 mt-0.5">Select a workspace to manage its projects</p>
        </div>
        <Link to="/workspaces/new"
          className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium">
          + New workspace
        </Link>
      </div>

      {memberships.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-indigo-50 flex items-center justify-center">
            <svg className="h-6 w-6 text-indigo-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
            </svg>
          </div>
          <p className="text-gray-500 text-sm mb-4">You don't belong to any workspace yet.</p>
          <Link to="/workspaces/new"
            className="inline-block bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-medium">
            Create your first workspace
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {memberships.map((m) => (
            <Link key={m.workspace.id} to={`/w/${m.workspace.slug}/projects`}
              className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors group">
              <Avatar name={m.workspace.name} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 group-hover:text-indigo-600 transition-colors truncate">{m.workspace.name}</p>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">/{m.workspace.slug}</p>
              </div>
              <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">
                {ROLE_LABEL[m.role] ?? m.role}
              </span>
              <svg className="h-4 w-4 text-gray-300 group-hover:text-indigo-400 transition-colors shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
