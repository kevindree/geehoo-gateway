import { useState, useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useProject, useUpdateProject, ProjectParams, ProjectUpstreamAuthParams } from '../hooks/useProjects'
import { useRoutes, useDeleteRoute, useReorderRoutes } from '../hooks/useRoutes'
import { useEndUsers, useCreateEndUser, useDeleteEndUser } from '../hooks/useEndUsers'
import { useApiKeys, useCreateApiKey, useRevokeApiKey, useRevealApiKey } from '../hooks/useApiKeys'

type Tab = 'routes' | 'auth' | 'parameters' | 'endusers'

const METHOD_COLOR: Record<string, string> = {
  GET: 'bg-green-100 text-green-700',
  POST: 'bg-orange-100 text-orange-700',
  PUT: 'bg-blue-100 text-blue-700',
  PATCH: 'bg-purple-100 text-purple-700',
  DELETE: 'bg-red-100 text-red-700',
}

export default function ProjectDetailPage() {
  const { workspaceSlug, projectId: id } = useParams<{ workspaceSlug: string; projectId: string }>()
  const { data: project, isLoading: projectLoading } = useProject(workspaceSlug, id)
  const { data: routes, isLoading: routesLoading } = useRoutes(workspaceSlug, id)
  const deleteRoute = useDeleteRoute(workspaceSlug)
  const reorderRoutes = useReorderRoutes(workspaceSlug)
  const updateProject = useUpdateProject(workspaceSlug)
  const { data: endUsers } = useEndUsers(workspaceSlug, id)
  const createUser = useCreateEndUser(workspaceSlug)
  const deleteUser = useDeleteEndUser(workspaceSlug)
  const { data: apiKeys } = useApiKeys(workspaceSlug, id)
  const createApiKey = useCreateApiKey(workspaceSlug)
  const revokeApiKey = useRevokeApiKey(workspaceSlug)
  const revealApiKey = useRevealApiKey(workspaceSlug)

  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)
  // Reveal modal state
  const [revealKeyId, setRevealKeyId] = useState<string | null>(null)
  const [revealPassword, setRevealPassword] = useState('')
  const [revealError, setRevealError] = useState<string | null>(null)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [copiedRevealedKey, setCopiedRevealedKey] = useState(false)

  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [userError, setUserError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('routes')

  // Drag-to-reorder state
  const [orderedRoutes, setOrderedRoutes] = useState(routes ?? [])
  const dragIndex = useRef<number | null>(null)
  const dragOverIndex = useRef<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [draggableIdx, setDraggableIdx] = useState<number | null>(null)

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
  const [varSaved, setVarSaved] = useState(false)
  const [varError, setVarError] = useState<string | null>(null)

  // Variables state
  const [variables, setVariables] = useState<{ name: string; value: string }[]>([{ name: '', value: '' }])

  // Sync param state once project data loads
  const [paramInitialized, setParamInitialized] = useState(false)
  if (project && !paramInitialized) {
    const ua = project.params?.upstreamAuth
    if (ua?.bearer) { setParamBearerEnabled(true); setParamBearer({ token: ua.bearer.token }) }
    if (ua?.basic) { setParamBasicEnabled(true); setParamBasic({ username: ua.basic.username, password: ua.basic.password }) }
    if (ua?.apikey_header) { setParamApiKeyHeaderEnabled(true); setParamApiKeyHeader({ headerName: ua.apikey_header.headerName, key: ua.apikey_header.key }) }
    if (ua?.apikey_query) { setParamApiKeyQueryEnabled(true); setParamApiKeyQuery({ paramName: ua.apikey_query.paramName, key: ua.apikey_query.key }) }
    setVariables([...(project.params?.variables ?? []), { name: '', value: '' }])
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
    const currentVars = (project?.params?.variables) ?? variables
    const params: ProjectParams = { ...(Object.keys(upstreamAuth).length > 0 ? { upstreamAuth } : {}), variables: currentVars }
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

  const handleSaveVariables = async () => {
    setVarError(null)
    const saved = variables.filter((v) => v.name.trim() !== '')
    const upstreamAuth: ProjectUpstreamAuthParams = {
      ...(paramBearerEnabled ? { bearer: paramBearer } : {}),
      ...(paramBasicEnabled ? { basic: paramBasic } : {}),
      ...(paramApiKeyHeaderEnabled ? { apikey_header: paramApiKeyHeader } : {}),
      ...(paramApiKeyQueryEnabled ? { apikey_query: paramApiKeyQuery } : {}),
    }
    const params: ProjectParams = { ...(Object.keys(upstreamAuth).length > 0 ? { upstreamAuth } : {}), variables: saved }
    try {
      await updateProject.mutateAsync({ id: id!, data: { params } })
      setVariables([...saved, { name: '', value: '' }])
      setVarSaved(true)
      setTimeout(() => setVarSaved(false), 3000)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message
      setVarError(msg ?? 'Failed to save variables')
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

  const TABS: { key: Tab; label: string }[] = [
    { key: 'routes', label: 'Routes' },
    { key: 'auth', label: 'Auth Settings' },
    { key: 'parameters', label: 'Parameters' },
    { key: 'endusers', label: 'End Users' },
  ]

  return (
    <div className="px-6 py-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <Link to={`/w/${workspaceSlug}/projects`} className="text-sm text-gray-400 hover:text-gray-600">
          ← Projects
        </Link>
        <h1 className="text-xl font-semibold text-gray-900 mt-1">{project.name}</h1>
        <p className="text-sm text-gray-400">
          {project.ingressPrefix} · namespace: {project.slug}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Routes tab */}
      {activeTab === 'routes' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <Link
              to={`/w/${workspaceSlug}/projects/${id}/routes/new`}
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
                {dragging !== null && dropTarget === idx && dropTarget !== dragging && dropTarget !== dragging + 1 && (
                  <div className="h-0.5 bg-indigo-500 mx-4 rounded-full pointer-events-none" />
                )}
                <div
                  draggable={draggableIdx === idx}
                  onDragStart={(e) => {
                    if (draggableIdx !== idx) { e.preventDefault(); return }
                    dragIndex.current = idx
                    setDragging(idx)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnter={() => { dragOverIndex.current = idx }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    const rect = e.currentTarget.getBoundingClientRect()
                    const after = e.clientY > rect.top + rect.height / 2
                    const insertAt = after ? idx + 1 : idx
                    dragOverIndex.current = insertAt
                    setDropTarget(insertAt)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const from = dragIndex.current
                    const insertAt = dragOverIndex.current
                    if (from !== null && insertAt !== null) {
                      const to = insertAt > from ? insertAt - 1 : insertAt
                      if (to !== from) {
                        const next = [...orderedRoutes]
                        const [moved] = next.splice(from, 1)
                        next.splice(to, 0, moved)
                        setOrderedRoutes(next)
                        reorderRoutes.mutate({ projectId: id!, ids: next.map((r) => r.id) })
                      }
                    }
                    dragIndex.current = null
                    dragOverIndex.current = null
                    setDragging(null)
                    setDropTarget(null)
                    setDraggableIdx(null)
                  }}
                  onDragLeave={() => {}}
                  onDragEnd={() => {
                    dragIndex.current = null
                    dragOverIndex.current = null
                    setDragging(null)
                    setDropTarget(null)
                    setDraggableIdx(null)
                  }}
                  className={`flex items-center justify-between p-4 transition-opacity ${dragging === idx ? 'opacity-30' : 'opacity-100'}`}
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <span
                      onMouseDown={() => setDraggableIdx(idx)}
                      onMouseUp={() => setDraggableIdx(null)}
                      onMouseLeave={() => { if (dragging === null) setDraggableIdx(null) }}
                      className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0 select-none"
                      title="Drag to reorder"
                    >
                      <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/>
                        <circle cx="3" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/>
                        <circle cx="3" cy="15" r="1.5"/><circle cx="9" cy="15" r="1.5"/>
                      </svg>
                    </span>
                    <div className="w-20 shrink-0 flex justify-start">
                      <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${METHOD_COLOR[route.method] ?? 'bg-gray-100 text-gray-600'}`}>
                        {route.method}
                      </span>
                    </div>
                    <div className="w-44 shrink-0 font-mono text-sm text-gray-900 truncate">{route.path}</div>
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-xs text-gray-400 truncate">{route.name ?? ''}</span>
                      {route.public && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded shrink-0">public</span>}
                      {!route.enabled && <span className="text-xs bg-red-50 text-red-500 px-1.5 py-0.5 rounded shrink-0">disabled</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Link to={`/w/${workspaceSlug}/projects/${id}/routes/${route.id}/edit`} className="text-xs text-indigo-600 hover:text-indigo-800 transition-colors">Edit</Link>
                    <button
                      onClick={() => { if (confirm(`Delete route "${route.method} ${route.path}"?`)) deleteRoute.mutate({ projectId: id!, routeId: route.id }) }}
                      className="text-xs text-red-500 hover:text-red-700 transition-colors"
                    >Delete</button>
                  </div>
                </div>
                {dragging !== null && idx === orderedRoutes.length - 1 && dropTarget === orderedRoutes.length && dropTarget !== dragging + 1 && (
                  <div className="h-0.5 bg-indigo-500 mx-4 rounded-full pointer-events-none" />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Auth Settings tab */}
      {activeTab === 'auth' && (
        <div className="flex flex-col gap-5">
          {/* Require authentication toggle */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">Require authentication</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  When enabled, routes are protected by JWT or API key unless individually marked as public.
                  Disable to make all routes in this project public.
                </p>
              </div>
              <button
                onClick={() => updateProject.mutate({ id: id!, data: { authRequired: project!.authRequired === false ? true : false } })}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${project?.authRequired !== false ? 'bg-indigo-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${project?.authRequired !== false ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>

          {/* API Keys section — shown only when auth is required */}
          {project?.authRequired !== false && (
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h2 className="text-sm font-medium text-gray-900 mb-1">API Keys</h2>
              <p className="text-xs text-gray-400 mb-4">
                API keys allow callers to authenticate using the <code className="bg-gray-100 px-1 rounded font-mono">X-Api-Key</code> header. Routes with auth method set to <span className="font-medium">API Key</span> will validate against these keys.
              </p>

              {/* Generate new key */}
              <div className="flex gap-2 mb-4">
                <input
                  value={newKeyLabel}
                  onChange={(e) => setNewKeyLabel(e.target.value)}
                  placeholder="Key label (e.g. mobile-app)"
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  disabled={!newKeyLabel.trim() || createApiKey.isPending}
                  onClick={async () => {
                    if (!newKeyLabel.trim()) return
                    const created = await createApiKey.mutateAsync({ projectId: id!, label: newKeyLabel.trim() })
                    setNewKeyLabel('')
                    setNewKeySecret(created.key ?? null)
                  }}
                  className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  Generate Key
                </button>
              </div>

              {/* Show newly generated key (one-time) */}
              {newKeySecret && (
                <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-green-700 mb-1">Key generated — copy it now, it won't be shown again.</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 font-mono text-xs bg-white border border-green-200 rounded px-2 py-1.5 break-all">{newKeySecret}</code>
                    <button
                      className="shrink-0 p-1.5 rounded hover:bg-green-100 text-green-700 transition-colors"
                      title="Copy"
                      onClick={() => {
                        navigator.clipboard?.writeText(newKeySecret).catch(() => {
                          const el = document.createElement('textarea'); el.value = newKeySecret
                          document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el)
                        })
                        setCopiedKey(true)
                        setTimeout(() => setCopiedKey(false), 1500)
                      }}
                    >
                      {copiedKey
                        ? <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                        : <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                      }
                    </button>
                    <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setNewKeySecret(null)}>Dismiss</button>
                  </div>
                </div>
              )}

              {/* Key list */}
              <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
                {(!apiKeys || apiKeys.length === 0) && (
                  <p className="text-gray-400 text-sm p-4">No API keys yet.</p>
                )}
                {apiKeys?.map((k) => (
                  <div key={k.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm text-gray-900 font-medium">{k.label}</p>
                      <p className="text-xs text-gray-400 font-mono">{k.keyPrefix}••••••••••••</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => { setRevealKeyId(k.id); setRevealPassword(''); setRevealError(null); setRevealedKey(null) }}
                        className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
                      >View</button>
                      <button
                        onClick={() => { if (confirm(`Revoke API key "${k.label}"?`)) revokeApiKey.mutate({ projectId: id!, keyId: k.id }) }}
                        className="text-xs text-red-500 hover:text-red-700 transition-colors"
                      >Revoke</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reveal modal */}
          {revealKeyId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setRevealKeyId(null)}>
              <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-base font-semibold text-gray-900 mb-1">Reveal API Key</h3>
                <p className="text-xs text-gray-500 mb-4">Enter your login password to decrypt and view the full API key.</p>
                {!revealedKey ? (
                  <>
                    <input
                      type="password"
                      value={revealPassword}
                      onChange={(e) => setRevealPassword(e.target.value)}
                      placeholder="Your login password"
                      autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.form?.requestSubmit() }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    {revealError && <p className="text-xs text-red-500 mb-3">{revealError}</p>}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setRevealKeyId(null)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancel</button>
                      <button
                        disabled={!revealPassword || revealApiKey.isPending}
                        onClick={async () => {
                          setRevealError(null)
                          try {
                            const raw = await revealApiKey.mutateAsync({ projectId: id!, keyId: revealKeyId, password: revealPassword })
                            setRevealedKey(raw)
                          } catch (err: unknown) {
                            const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
                            setRevealError(msg ?? 'Failed to verify password')
                          }
                        }}
                        className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {revealApiKey.isPending ? 'Verifying…' : 'Confirm'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-4">
                      <code className="flex-1 font-mono text-xs bg-gray-50 border border-gray-200 rounded px-2 py-2 break-all">{revealedKey}</code>
                      <button
                        className="shrink-0 p-1.5 rounded hover:bg-gray-100 text-gray-600 transition-colors"
                        title="Copy"
                        onClick={() => {
                          navigator.clipboard?.writeText(revealedKey).catch(() => {
                            const el = document.createElement('textarea'); el.value = revealedKey
                            document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el)
                          })
                          setCopiedRevealedKey(true)
                          setTimeout(() => setCopiedRevealedKey(false), 1500)
                        }}
                      >
                        {copiedRevealedKey
                          ? <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-green-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                          : <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                        }
                      </button>
                    </div>
                    <div className="flex justify-end">
                      <button onClick={() => { setRevealKeyId(null); setRevealedKey(null) }} className="bg-gray-100 hover:bg-gray-200 text-sm text-gray-700 px-4 py-1.5 rounded-lg transition-colors">Close</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Parameters tab */}
      {activeTab === 'parameters' && (
        <>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm font-medium text-gray-900 mb-1">Upstream Auth Parameters</p>
          <p className="text-xs text-gray-400 mb-4">
            Shared credentials for upstream auth. Routes can reference these instead of storing credentials directly.
          </p>
          <div className="flex flex-col gap-3">
            {/* Bearer Token */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <label className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 cursor-pointer select-none">
                <input type="checkbox" checked={paramBearerEnabled} onChange={(e) => setParamBearerEnabled(e.target.checked)} className="accent-indigo-600" />
                <span className="text-sm font-medium text-gray-700">Bearer Token</span>
              </label>
              {paramBearerEnabled && (
                <div className="px-4 py-3 border-t border-gray-200">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Token</label>
                  <input type="password" value={paramBearer.token} onChange={(e) => setParamBearer({ token: e.target.value })} placeholder="Bearer token value" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              )}
            </div>
            {/* Basic Auth */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <label className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 cursor-pointer select-none">
                <input type="checkbox" checked={paramBasicEnabled} onChange={(e) => setParamBasicEnabled(e.target.checked)} className="accent-indigo-600" />
                <span className="text-sm font-medium text-gray-700">Basic Auth</span>
              </label>
              {paramBasicEnabled && (
                <div className="px-4 py-3 border-t border-gray-200 flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
                    <input value={paramBasic.username} onChange={(e) => setParamBasic({ ...paramBasic, username: e.target.value })} placeholder="username" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Password</label>
                    <input type="password" value={paramBasic.password} onChange={(e) => setParamBasic({ ...paramBasic, password: e.target.value })} placeholder="password" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
              )}
            </div>
            {/* API Key — Header */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <label className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 cursor-pointer select-none">
                <input type="checkbox" checked={paramApiKeyHeaderEnabled} onChange={(e) => setParamApiKeyHeaderEnabled(e.target.checked)} className="accent-indigo-600" />
                <span className="text-sm font-medium text-gray-700">API Key — Header</span>
              </label>
              {paramApiKeyHeaderEnabled && (
                <div className="px-4 py-3 border-t border-gray-200 flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Header Name</label>
                    <input value={paramApiKeyHeader.headerName} onChange={(e) => setParamApiKeyHeader({ ...paramApiKeyHeader, headerName: e.target.value })} placeholder="X-API-Key" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Key</label>
                    <input type="password" value={paramApiKeyHeader.key} onChange={(e) => setParamApiKeyHeader({ ...paramApiKeyHeader, key: e.target.value })} placeholder="key value" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
              )}
            </div>
            {/* API Key — Query Param */}
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <label className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 cursor-pointer select-none">
                <input type="checkbox" checked={paramApiKeyQueryEnabled} onChange={(e) => setParamApiKeyQueryEnabled(e.target.checked)} className="accent-indigo-600" />
                <span className="text-sm font-medium text-gray-700">API Key — Query Param</span>
              </label>
              {paramApiKeyQueryEnabled && (
                <div className="px-4 py-3 border-t border-gray-200 flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Query Param Name</label>
                    <input value={paramApiKeyQuery.paramName} onChange={(e) => setParamApiKeyQuery({ ...paramApiKeyQuery, paramName: e.target.value })} placeholder="api_key" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Key</label>
                    <input type="password" value={paramApiKeyQuery.key} onChange={(e) => setParamApiKeyQuery({ ...paramApiKeyQuery, key: e.target.value })} placeholder="key value" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={handleSaveParams} disabled={updateProject.isPending} className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                Save Parameters
              </button>
              {paramSaved && <span className="text-xs text-green-600 font-medium">✓ Saved</span>}
              {paramError && <span className="text-xs text-red-500">{paramError}</span>}
            </div>
          </div>
        </div>

        {/* Variables */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 mt-4">
          <p className="text-sm font-medium text-gray-900 mb-0.5">Project Variables</p>
          <p className="text-xs text-gray-400 mb-4">Define reusable key-value pairs. Reference them in route configurations using <code className="bg-gray-100 px-1 rounded font-mono">{'{{variables.NAME}}'}</code>.</p>

          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 mb-3">
            {variables.map((v, idx) => (
              <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
                <input
                  value={v.name}
                  onChange={(e) => {
                    const next = [...variables]
                    next[idx] = { ...next[idx], name: e.target.value }
                    setVariables(next)
                  }}
                  onBlur={(e) => {
                    const next = [...variables]
                    next[idx] = { ...next[idx], name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') }
                    setVariables(next)
                  }}
                  placeholder="VARIABLE_NAME"
                  className="w-40 shrink-0 border border-gray-200 rounded px-2 py-1 text-sm font-mono text-indigo-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <input
                  value={v.value}
                  onChange={(e) => {
                    const next = [...variables]
                    next[idx] = { ...next[idx], value: e.target.value }
                    setVariables(next)
                  }}
                  placeholder="value"
                  className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm font-mono placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {v.name !== '' || v.value !== '' ? (
                  <button
                    onClick={() => setVariables(variables.filter((_, i) => i !== idx))}
                    className="text-xs text-red-500 hover:text-red-700 shrink-0 transition-colors"
                  >Remove</button>
                ) : <span className="w-12 shrink-0" />}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleSaveVariables} disabled={updateProject.isPending} className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              Save Variables
            </button>
            {varSaved && <span className="text-xs text-green-600 font-medium">✓ Saved</span>}
            {varError && <span className="text-xs text-red-500">{varError}</span>}
          </div>
        </div>
        </>
      )}

      {/* End Users tab */}
      {activeTab === 'endusers' && (
        <div>
          <div className="mb-4">
            <h2 className="font-medium text-gray-700">End Users</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Gateway-managed users for routes using <code className="bg-gray-100 px-1 rounded font-mono">gateway_auth_verify</code> /{' '}
              <code className="bg-gray-100 px-1 rounded font-mono">gateway_auth_register</code> nodes.
            </p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3">
            <p className="text-xs font-medium text-gray-500 mb-3">Add End User</p>
            <div className="flex gap-2">
              <input value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="email@example.com" type="email" className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <input value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} placeholder="password (min 8 chars)" type="password" className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={handleCreateUser} disabled={createUser.isPending} className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">Add</button>
            </div>
            {userError && <p className="text-xs text-red-500 mt-2">{userError}</p>}
          </div>
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {endUsers?.length === 0 && <p className="text-gray-400 text-sm p-5">No end users yet.</p>}
            {endUsers?.map((user) => (
              <div key={user.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm text-gray-900">{user.email}</p>
                  <p className="text-xs text-gray-400">Created {new Date(user.createdAt).toLocaleDateString()}</p>
                </div>
                <button
                  onClick={() => { if (confirm(`Delete user "${user.email}"?`)) deleteUser.mutate({ projectId: id!, userId: user.id }) }}
                  className="text-xs text-red-500 hover:text-red-700 transition-colors"
                >Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
