import { useState, useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useProject, useUpdateProject, ProjectParams, ProjectUpstreamAuthParams } from '../hooks/useProjects'
import { useRoutes, useDeleteRoute, useReorderRoutes } from '../hooks/useRoutes'
import { useEndUsers, useCreateEndUser, useDeleteEndUser } from '../hooks/useEndUsers'

const METHOD_COLOR: Record<string, string> = {
  GET: 'bg-green-100 text-green-700',
  POST: 'bg-orange-100 text-orange-700',
  PUT: 'bg-blue-100 text-blue-700',
  PATCH: 'bg-purple-100 text-purple-700',
  DELETE: 'bg-red-100 text-red-700',
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: project, isLoading: projectLoading } = useProject(id!)
  const { data: routes, isLoading: routesLoading } = useRoutes(id!)
  const deleteRoute = useDeleteRoute()
  const reorderRoutes = useReorderRoutes()
  const updateProject = useUpdateProject()
  const { data: endUsers } = useEndUsers(id!)
  const createUser = useCreateEndUser()
  const deleteUser = useDeleteEndUser()

  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [userError, setUserError] = useState<string | null>(null)

  // Drag-to-reorder state
  const [orderedRoutes, setOrderedRoutes] = useState(routes ?? [])
  const dragIndex = useRef<number | null>(null)
  const dragOverIndex = useRef<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  useEffect(() => {
    setOrderedRoutes(routes ?? [])
  }, [routes])

  // Project-level upstream auth params state — each auth type is independent
  const [paramBearerEnabled, setParamBearerEnabled] = useState(false)
  const [paramBearer, setParamBearer] = useState({ token: '' })
  const [paramBasicEnabled, setParamBasicEnabled] = useState(false)
  const [paramBasic, setParamBasic] = useState({ username: '', password: '' })
  const [paramApiKeyHeaderEnabled, setParamApiKeyHeaderEnabled] = useState(false)
  const [paramApiKeyHeader, setParamApiKeyHeader] = useState({ headerName: '', key: '' })
  const [paramApiKeyQueryEnabled, setParamApiKeyQueryEnabled] = useState(false)
  const [paramApiKeyQuery, setParamApiKeyQuery] = useState({ paramName: '', key: '' })
  const [paramSaved, setParamSaved] = useState(false)
  const [paramError, setParamError] = useState<string | null>(null)

  // Sync param state once project data loads
  const [paramInitialized, setParamInitialized] = useState(false)
  if (project && !paramInitialized) {
    const ua = project.params?.upstreamAuth
    if (ua?.bearer) { setParamBearerEnabled(true); setParamBearer({ token: ua.bearer.token }) }
    if (ua?.basic) { setParamBasicEnabled(true); setParamBasic({ username: ua.basic.username, password: ua.basic.password }) }
    if (ua?.apikey_header) { setParamApiKeyHeaderEnabled(true); setParamApiKeyHeader({ headerName: ua.apikey_header.headerName, key: ua.apikey_header.key }) }
    if (ua?.apikey_query) { setParamApiKeyQueryEnabled(true); setParamApiKeyQuery({ paramName: ua.apikey_query.paramName, key: ua.apikey_query.key }) }
    setParamInitialized(true)
  }

  const handleSaveParams = async () => {
    setParamError(null)
    const upstreamAuth: ProjectUpstreamAuthParams = {
      ...(paramBearerEnabled ? { bearer: paramBearer } : {}),
      ...(paramBasicEnabled ? { basic: paramBasic } : {}),
      ...(paramApiKeyHeaderEnabled ? { apikey_header: paramApiKeyHeader } : {}),
      ...(paramApiKeyQueryEnabled ? { apikey_query: paramApiKeyQuery } : {}),
    }
    const params: ProjectParams = Object.keys(upstreamAuth).length > 0 ? { upstreamAuth } : {}
    try {
      await updateProject.mutateAsync({ id: id!, data: { params } })
      setParamSaved(true)
      setTimeout(() => setParamSaved(false), 3000)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message
      setParamError(msg ?? 'Failed to save parameters')
    }
  }

  const handleCreateUser = async () => {
    if (!newUserEmail || !newUserPassword) {
      setUserError('Email and password are required')
      return
    }
    setUserError(null)
    try {
      await createUser.mutateAsync({ projectId: id!, email: newUserEmail, password: newUserPassword })
      setNewUserEmail('')
      setNewUserPassword('')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message
      setUserError(msg ?? 'Failed to create user')
    }
  }

  if (projectLoading || routesLoading) return <p className="text-gray-500">Loading…</p>
  if (!project) return <p className="text-red-600">Project not found</p>

  return (
    <div className="px-6 py-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link to="/projects" className="text-sm text-gray-400 hover:text-gray-600">
          ← Projects
        </Link>
        <h1 className="text-xl font-semibold text-gray-900 mt-1">{project.name}</h1>
        <p className="text-sm text-gray-400">
          {project.ingressPrefix} · namespace: {project.slug}
        </p>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="font-medium text-gray-700">Routes</h2>
        <Link
          to={`/projects/${id}/routes/new`}
          className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + New Route
        </Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        {orderedRoutes.length === 0 && (
          <p className="text-gray-400 text-sm p-6">
            No routes yet. Click "New Route" to create one with the visual editor.
          </p>
        )}
        {orderedRoutes.map((route, idx) => (
          <div key={route.id}>
            {/* Drop indicator line above */}
            {dragging !== null && dropTarget === idx && dragging !== idx && dragging !== idx - 1 && (
              <div className="h-0.5 bg-indigo-500 mx-4 rounded-full" />
            )}
            <div
              draggable
              onDragStart={(e) => {
                dragIndex.current = idx
                setDragging(idx)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnter={() => {
                dragOverIndex.current = idx
                setDropTarget(idx)
              }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
              onDragLeave={() => {}}
              onDragEnd={() => {
                const from = dragIndex.current
                const to = dragOverIndex.current
                if (from !== null && to !== null && from !== to) {
                  const next = [...orderedRoutes]
                  const [moved] = next.splice(from, 1)
                  next.splice(to, 0, moved)
                  setOrderedRoutes(next)
                  reorderRoutes.mutate({ projectId: id!, ids: next.map((r) => r.id) })
                }
                dragIndex.current = null
                dragOverIndex.current = null
                setDragging(null)
                setDropTarget(null)
              }}
              className={`flex items-center justify-between p-4 transition-opacity ${dragging === idx ? 'opacity-30' : 'opacity-100'}`}
            >
            <div className="flex items-center gap-3">
              {/* Drag handle */}
              <span className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0 select-none" title="Drag to reorder">
                <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/>
                  <circle cx="3" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/>
                  <circle cx="3" cy="15" r="1.5"/><circle cx="9" cy="15" r="1.5"/>
                </svg>
              </span>
              <span
                className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${METHOD_COLOR[route.method] ?? 'bg-gray-100 text-gray-600'}`}
              >
                {route.method}
              </span>
              <div>
                <span className="font-mono text-sm text-gray-900">{route.path}</span>
                {route.name && <span className="text-xs text-gray-400 ml-2">{route.name}</span>}
              </div>
              {route.public && (
                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                  public
                </span>
              )}
              {!route.enabled && (
                <span className="text-xs bg-red-50 text-red-500 px-1.5 py-0.5 rounded">
                  disabled
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Link
                to={`/projects/${id}/routes/${route.id}/edit`}
                className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                Edit
              </Link>
              <button
                onClick={() => {
                  if (confirm(`Delete route "${route.method} ${route.path}"?`)) {
                    deleteRoute.mutate({ projectId: id!, routeId: route.id })
                  }
                }}
                className="text-xs text-red-500 hover:text-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
          {/* Drop indicator line after last item */}
          {dragging !== null && dropTarget === idx && idx === orderedRoutes.length - 1 && dragging !== idx && (
            <div className="h-0.5 bg-indigo-500 mx-4 rounded-full" />
          )}
          </div>
        ))}
      </div>

      {/* Auth Settings */}
      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-medium text-gray-700 mb-4">Auth Settings</h2>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-gray-900 font-medium">Require authentication</p>
            <p className="text-xs text-gray-400 mt-0.5">
              When enabled, routes are protected by JWT or API key unless individually marked as public.
              Disable to make all routes in this project public.
            </p>
          </div>
          <button
            onClick={() =>
              updateProject.mutate({ id: id!, data: { authRequired: project!.authRequired === false ? true : false } })
            }
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              project?.authRequired !== false ? 'bg-indigo-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                project?.authRequired !== false ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Project Parameters */}
      <div className="mt-6 bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="font-medium text-gray-700 mb-1">Upstream Auth Parameters</h2>
        <p className="text-xs text-gray-400 mb-4">
          Shared credentials for upstream auth. Routes can reference these instead of storing credentials directly.
        </p>

        <div className="flex flex-col gap-3">
          {/* Bearer Token */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <label className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={paramBearerEnabled}
                onChange={(e) => setParamBearerEnabled(e.target.checked)}
                className="accent-indigo-600"
              />
              <span className="text-sm font-medium text-gray-700">Bearer Token</span>
            </label>
            {paramBearerEnabled && (
              <div className="px-4 py-3 border-t border-gray-200">
                <label className="block text-xs font-medium text-gray-500 mb-1">Token</label>
                <input
                  type="password"
                  value={paramBearer.token}
                  onChange={(e) => setParamBearer({ token: e.target.value })}
                  placeholder="Bearer token value"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}
          </div>

          {/* Basic Auth */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <label className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={paramBasicEnabled}
                onChange={(e) => setParamBasicEnabled(e.target.checked)}
                className="accent-indigo-600"
              />
              <span className="text-sm font-medium text-gray-700">Basic Auth</span>
            </label>
            {paramBasicEnabled && (
              <div className="px-4 py-3 border-t border-gray-200 flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
                  <input
                    value={paramBasic.username}
                    onChange={(e) => setParamBasic({ ...paramBasic, username: e.target.value })}
                    placeholder="username"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Password</label>
                  <input
                    type="password"
                    value={paramBasic.password}
                    onChange={(e) => setParamBasic({ ...paramBasic, password: e.target.value })}
                    placeholder="password"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* API Key — Header */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <label className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={paramApiKeyHeaderEnabled}
                onChange={(e) => setParamApiKeyHeaderEnabled(e.target.checked)}
                className="accent-indigo-600"
              />
              <span className="text-sm font-medium text-gray-700">API Key — Header</span>
            </label>
            {paramApiKeyHeaderEnabled && (
              <div className="px-4 py-3 border-t border-gray-200 flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Header Name</label>
                  <input
                    value={paramApiKeyHeader.headerName}
                    onChange={(e) => setParamApiKeyHeader({ ...paramApiKeyHeader, headerName: e.target.value })}
                    placeholder="X-API-Key"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Key</label>
                  <input
                    type="password"
                    value={paramApiKeyHeader.key}
                    onChange={(e) => setParamApiKeyHeader({ ...paramApiKeyHeader, key: e.target.value })}
                    placeholder="key value"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* API Key — Query Param */}
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <label className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={paramApiKeyQueryEnabled}
                onChange={(e) => setParamApiKeyQueryEnabled(e.target.checked)}
                className="accent-indigo-600"
              />
              <span className="text-sm font-medium text-gray-700">API Key — Query Param</span>
            </label>
            {paramApiKeyQueryEnabled && (
              <div className="px-4 py-3 border-t border-gray-200 flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Query Param Name</label>
                  <input
                    value={paramApiKeyQuery.paramName}
                    onChange={(e) => setParamApiKeyQuery({ ...paramApiKeyQuery, paramName: e.target.value })}
                    placeholder="api_key"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Key</label>
                  <input
                    type="password"
                    value={paramApiKeyQuery.key}
                    onChange={(e) => setParamApiKeyQuery({ ...paramApiKeyQuery, key: e.target.value })}
                    placeholder="key value"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveParams}
              disabled={updateProject.isPending}
              className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              Save Parameters
            </button>
            {paramSaved && <span className="text-xs text-green-600 font-medium">✓ Saved</span>}
            {paramError && <span className="text-xs text-red-500">{paramError}</span>}
          </div>
        </div>
      </div>

      {/* End Users (gateway-managed auth) */}
      {project?.authRequired !== false && (
        <div className="mt-6">
          <div className="mb-4">
            <h2 className="font-medium text-gray-700">End Users</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Gateway-managed users for routes using <code className="bg-gray-100 px-1 rounded font-mono">gateway_auth_verify</code> /{' '}
              <code className="bg-gray-100 px-1 rounded font-mono">gateway_auth_register</code> nodes.
            </p>
          </div>

          {/* Create form */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3">
            <p className="text-xs font-medium text-gray-500 mb-3">Add End User</p>
            <div className="flex gap-2">
              <input
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                placeholder="email@example.com"
                type="email"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                placeholder="password (min 8 chars)"
                type="password"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={handleCreateUser}
                disabled={createUser.isPending}
                className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                Add
              </button>
            </div>
            {userError && <p className="text-xs text-red-500 mt-2">{userError}</p>}
          </div>

          {/* User list */}
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {endUsers?.length === 0 && (
              <p className="text-gray-400 text-sm p-5">No end users yet.</p>
            )}
            {endUsers?.map((user) => (
              <div key={user.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm text-gray-900">{user.email}</p>
                  <p className="text-xs text-gray-400">
                    Created {new Date(user.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Delete user "${user.email}"?`)) {
                      deleteUser.mutate({ projectId: id!, userId: user.id })
                    }
                  }}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
