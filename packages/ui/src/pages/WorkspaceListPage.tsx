import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function WorkspaceListPage() {
  const { memberships, loadingMe } = useAuth()

  if (loadingMe) return <p className="p-6 text-gray-500">Loading…</p>

  return (
    <div className="px-6 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Your workspaces</h1>
        <Link to="/workspaces/new"
          className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">
          + New workspace
        </Link>
      </div>

      {memberships.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-500 mb-4">You don't belong to any workspace yet.</p>
          <Link to="/workspaces/new"
            className="inline-block bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors">
            Create your first workspace
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {memberships.map((m) => (
            <Link key={m.workspace.id} to={`/w/${m.workspace.slug}/projects`}
              className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
              <div>
                <p className="font-medium text-gray-900">{m.workspace.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">/{m.workspace.slug} · {m.role}</p>
              </div>
              <span className="text-xs text-gray-400">{m.workspace.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
