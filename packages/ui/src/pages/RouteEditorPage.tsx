import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  NodeTypes,
  NodeMouseHandler,
  NodeChange,
  NodeSelectionChange,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useRoute, useRoutes, useCreateRoute, useUpdateRoute } from '../hooks/useRoutes'
import { useProject } from '../hooks/useProjects'
import TriggerNode from '../components/flow/TriggerNode'
import UpstreamCallNode from '../components/flow/UpstreamCallNode'
import TransformNode from '../components/flow/TransformNode'
import ConditionNode from '../components/flow/ConditionNode'
import ResponseNode from '../components/flow/ResponseNode'
import IssueJwtNode from '../components/flow/IssueJwtNode'
import RefreshJwtNode from '../components/flow/RefreshJwtNode'
import GatewayAuthNode from '../components/flow/GatewayAuthNode'
import MergeNode from '../components/flow/MergeNode'
import LoopNode from '../components/flow/LoopNode'

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  upstream_call: UpstreamCallNode,
  transform: TransformNode,
  condition: ConditionNode,
  response: ResponseNode,
  issue_jwt: IssueJwtNode,
  refresh_jwt: RefreshJwtNode,
  gateway_auth_verify: GatewayAuthNode,
  gateway_auth_register: GatewayAuthNode,
  merge: MergeNode,
  loop: LoopNode,
}

const CONFIGURABLE_NODE_TYPES = new Set([
  'upstream_call', 'issue_jwt', 'refresh_jwt', 'gateway_auth_verify', 'gateway_auth_register',
  'merge', 'response', 'transform', 'condition', 'loop',
])

const INITIAL_NODES: Node[] = [
  { id: 'trigger', type: 'trigger', position: { x: 100, y: 200 }, data: { label: 'Trigger' } },
  { id: 'response', type: 'response', position: { x: 700, y: 200 }, data: { label: 'Response', status: 200, dataFrom: '' } },
]

const INITIAL_EDGES: Edge[] = []

// Input with {{ autocomplete for template variables
function TemplateInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder?: string
  className?: string
}) {
  const [show, setShow] = useState(false)
  const [token, setToken] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    onChange(v)
    // Detect {{ token being typed
    const cursor = e.target.selectionStart ?? v.length
    const before = v.slice(0, cursor)
    const match = before.match(/\{\{([^}]*)$/)
    if (match) {
      setToken(match[1])
      setShow(true)
    } else {
      setShow(false)
    }
  }

  const filtered = token === ''
    ? suggestions
    : suggestions.filter((s) => s.toLowerCase().includes(token.toLowerCase()))

  const insert = (suggestion: string) => {
    if (!inputRef.current) return
    const cursor = inputRef.current.selectionStart ?? value.length
    const before = value.slice(0, cursor)
    const after = value.slice(cursor)
    // Replace the open {{ token with the full expression
    const replaced = before.replace(/\{\{([^}]*)$/, `{{variables.${suggestion}}}`)
    onChange(replaced + after)
    setShow(false)
    setTimeout(() => {
      if (!inputRef.current) return
      const pos = replaced.length
      inputRef.current.setSelectionRange(pos, pos)
      inputRef.current.focus()
    }, 0)
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onBlur={() => setTimeout(() => setShow(false), 150)}
        placeholder={placeholder}
        className={className}
      />
      {show && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insert(s) }}
              className="w-full text-left px-3 py-1.5 text-xs font-mono text-indigo-700 hover:bg-indigo-50 transition-colors"
            >
              {`{{variables.${s}}}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RouteEditorPage() {
  const { workspaceSlug, projectId, routeId } = useParams<{ workspaceSlug: string; projectId: string; routeId: string }>()
  const navigate = useNavigate()
  const isNew = routeId === undefined

  const { data: project } = useProject(workspaceSlug, projectId)
  const { data: existingRoute } = useRoute(workspaceSlug, projectId, routeId ?? '')
  const { data: routes } = useRoutes(workspaceSlug, projectId)
  const createRoute = useCreateRoute(workspaceSlug)
  const updateRoute = useUpdateRoute(workspaceSlug)

  const [nodes, setNodes, onNodesChange] = useNodesState(INITIAL_NODES)
  const [edges, setEdges, onEdgesChange] = useEdgesState(INITIAL_EDGES)

  const [meta, setMeta] = useState({
    name: '',
    path: '/',
    method: 'GET',
    public: false,
    authMethod: 'jwt' as 'public' | 'apikey' | 'jwt',
    description: '',
  })

  // Populate state once the existing route data is loaded (e.g. after page refresh)
  useEffect(() => {
    if (!existingRoute) return
    setNodes(
      existingRoute.orchestrationFlow.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position ?? { x: 100, y: 100 },
        data: n.config,
      })),
    )
    setEdges(existingRoute.orchestrationFlow.edges)
    const authConfig = existingRoute.authConfig as { type?: string } | null | undefined
    const authMethod: 'public' | 'apikey' | 'jwt' = existingRoute.public
      ? 'public'
      : authConfig?.type === 'apikey' ? 'apikey' : 'jwt'
    setMeta({
      name: existingRoute.name,
      path: existingRoute.path,
      method: existingRoute.method,
      public: existingRoute.public,
      authMethod,
      description: existingRoute.description ?? '',
    })
  }, [existingRoute, setNodes, setEdges])
  const [panelWidth, setPanelWidth] = useState(420)
  const isResizing = useRef(false)

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    const startX = e.clientX
    const startW = panelWidth
    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      const delta = startX - ev.clientX
      setPanelWidth(Math.max(280, Math.min(800, startW + delta)))
    }
    const onMouseUp = () => {
      isResizing.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [panelWidth])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [copiedNodeId, setCopiedNodeId] = useState(false)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes)
      const selectionChanges = changes.filter((c) => c.type === 'select') as NodeSelectionChange[]
      if (selectionChanges.length > 0) {
        setSelectedNodeIds((prev) => {
          const next = new Set(prev)
          selectionChanges.forEach((c) => {
            if (c.selected) next.add(c.id)
            else next.delete(c.id)
          })
          return Array.from(next)
        })
      }
    },
    [onNodesChange],
  )

  const deleteSelectedNodes = useCallback(() => {
    const protectedIds = new Set(['trigger', 'response'])
    setNodes((nds) => nds.filter((n) => !selectedNodeIds.includes(n.id) || protectedIds.has(n.id)))
    setEdges((eds) => eds.filter((e) => !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target)))
    setSelectedNodeIds([])
  }, [selectedNodeIds, setNodes, setEdges])
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)

  // Reset to blank state when navigating to the "new route" page
  useEffect(() => {
    if (!isNew) return
    setNodes(INITIAL_NODES)
    setEdges(INITIAL_EDGES)
    setMeta({ name: '', path: '/', method: 'GET', public: false, authMethod: 'jwt', description: '' })
    setSelectedNode(null)
    setSelectedNodeIds([])
  }, [routeId, isNew, setNodes, setEdges])

  const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    if (CONFIGURABLE_NODE_TYPES.has(node.type ?? '')) setSelectedNode(node)
    else setSelectedNode(null)
  }, [])

  const updateNodeData = (id: string, patch: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
    )
    setSelectedNode((prev) => prev && prev.id === id ? { ...prev, data: { ...prev.data, ...patch } } : prev)
  }

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  )

  const addNode = (type: string) => {
    const id = type === 'trigger' ? 'trigger' : type === 'response' ? 'response' : `${type}-${Date.now()}`
    const defaultData: Record<string, unknown> =
      type === 'trigger'
        ? { label: 'Trigger' }
        : type === 'response'
        ? { label: 'Response', status: 200, dataFrom: '' }
        : type === 'merge'
        ? { label: 'Merge', sources: [], strategy: 'merge' }
        : type === 'transform'
        ? { label: 'Transform', inputFrom: '', transform: { type: 'jmespath', expression: '' } }
        : type === 'condition'
        ? { label: 'Condition', inputFrom: '', condition: '', true: '', false: '' }
        : type === 'loop'
        ? { label: 'Loop', targetNodeId: '', stopCondition: '', maxIterations: 10, aggregateResultsFrom: '' }
        : type === 'issue_jwt'
        ? { label: 'Issue JWT', claimsFrom: '', expiresIn: '24h' }
        : type === 'refresh_jwt'
        ? { label: 'Refresh JWT', expiresIn: '24h' }
        : type === 'gateway_auth_verify'
        ? { label: 'Verify Credentials' }
        : type === 'gateway_auth_register'
        ? { label: 'Register User' }
        : { label: type }
    const newNode: Node = {
      id,
      type,
      position: { x: 300 + Math.random() * 200, y: 150 + Math.random() * 200 },
      data: defaultData,
    }
    setNodes((nds) => [...nds, newNode])
  }

  const handleSave = async () => {
    if (!nodes.some((n) => n.type === 'trigger')) {
      setError('A Trigger node is required. Add one from the toolbar.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const flow = {
        nodes: nodes.map((n) => ({ id: n.id, type: n.type ?? 'trigger', config: n.data, position: n.position })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label as string | undefined })),
      }

      const { authMethod, ...metaRest } = meta
      const routePublic = authMethod === 'public'
      const authConfig = authMethod === 'apikey' ? { type: 'apikey' } : authMethod === 'jwt' ? { type: 'jwt' } : undefined
      const saveData = { ...metaRest, public: routePublic, authConfig }

      if (isNew) {
        await createRoute.mutateAsync({
          projectId: projectId!,
          data: { ...saveData, enabled: true, orchestrationFlow: flow },
        })
      } else {
        await updateRoute.mutateAsync({
          projectId: projectId!,
          routeId: routeId!,
          data: { ...saveData, orchestrationFlow: flow },
        })
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message
      setError(msg ?? 'Failed to save route')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Project breadcrumb */}
      <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200 text-sm">
        <button
          onClick={() => navigate(`/w/${workspaceSlug}/projects/${projectId}`)}
          className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          {project?.name ?? 'Project'}
        </button>
        {project?.ingressPrefix && (
          <span className="text-xs text-gray-400 font-mono bg-gray-100 px-1.5 py-0.5 rounded">
            {project.ingressPrefix}
          </span>
        )}
        <span className="text-gray-400">›</span>
        <span className="text-gray-600">{isNew ? 'New Route' : (meta.name || meta.path)}</span>
        {!isNew && meta.path && project?.ingressPrefix && (
          <button
            className="flex items-center gap-1 text-xs font-mono text-gray-400 bg-gray-100 hover:bg-gray-200 px-2 py-0.5 rounded transition-colors select-all"
            title="Click to copy full path"
            onClick={() => {
              const full = `${project.ingressPrefix}${meta.path}`
              if (navigator.clipboard) {
                navigator.clipboard.writeText(full)
              } else {
                const el = document.createElement('textarea')
                el.value = full
                document.body.appendChild(el)
                el.select()
                document.execCommand('copy')
                document.body.removeChild(el)
              }
            }}
          >
            {project.ingressPrefix}{meta.path}
          </button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
        <StyledSelect
          value={meta.method}
          onChange={(v) => setMeta({ ...meta, method: v })}
          options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))}
          className="w-28"
        />
        <input
          value={meta.path}
          onChange={(e) => setMeta({ ...meta, path: e.target.value })}
          placeholder="/path"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-48 font-mono"
        />
        <input
          value={meta.name}
          onChange={(e) => setMeta({ ...meta, name: e.target.value })}
          placeholder="Route name"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-48"
        />
        <div className="flex items-center gap-1 border border-gray-300 rounded-lg overflow-hidden text-xs">
          {(['public', 'apikey', 'jwt'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMeta({ ...meta, authMethod: m, public: m === 'public' })}
              className={`px-2.5 py-1.5 font-medium transition-colors ${
                meta.authMethod === m ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
              title={m === 'public' ? 'No auth required' : m === 'apikey' ? 'Require API key (X-Api-Key header)' : 'Require JWT Bearer token'}
            >
              {m === 'public' ? 'Public' : m === 'apikey' ? 'API Key' : 'JWT'}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {selectedNodeIds.filter((id) => id !== 'trigger' && id !== 'response').length > 0 && (
          <button
            onClick={deleteSelectedNodes}
            className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded transition-colors"
          >
            Delete selected
          </button>
        )}

        {error && <span className="text-xs text-red-600">{error}</span>}
        {saved && <span className="text-xs text-green-600 font-medium">✓ Saved successfully</span>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Main editor area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Routes list panel */}
        <div className="w-52 border-r border-gray-200 bg-white flex flex-col shrink-0 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50 shrink-0">
            <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Routes</p>
            <div className="flex items-center gap-2">
              {!isNew && existingRoute && (
                <button
                  onClick={async () => {
                    try {
                      // Find a unique path by appending -copy, -copy-2, etc.
                      const existingPaths = new Set(
                        (routes ?? [])
                          .filter((r) => r.method === existingRoute.method)
                          .map((r) => r.path),
                      )
                      let newPath = `${existingRoute.path}-copy`
                      let counter = 2
                      while (existingPaths.has(newPath)) {
                        newPath = `${existingRoute.path}-copy-${counter++}`
                      }
                      const created = await createRoute.mutateAsync({
                        projectId: projectId!,
                        data: {
                          name: `${existingRoute.name} (Copy)`,
                          path: newPath,
                          method: existingRoute.method,
                          public: existingRoute.public,
                          description: existingRoute.description ?? '',
                          enabled: existingRoute.enabled,
                          orchestrationFlow: existingRoute.orchestrationFlow,
                        },
                      })
                      navigate(`/w/${workspaceSlug}/projects/${projectId}/routes/${created.id}/edit`)
                    } catch (err) {
                      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
                        ?.response?.data?.error?.message
                      setError(msg ?? 'Failed to duplicate route')
                    }
                  }}
                  className="p-1 rounded text-indigo-500 hover:text-indigo-800 hover:bg-indigo-50 transition-colors"
                  title="Duplicate this route"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => navigate(`/w/${workspaceSlug}/projects/${projectId}/routes/new`)}
                className="p-1 rounded text-indigo-500 hover:text-indigo-800 hover:bg-indigo-50 transition-colors"
                title="New route"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {(routes ?? []).map((r) => {
              const isActive = r.id === routeId
              return (
                <button
                  key={r.id}
                  onClick={() => navigate(`/w/${workspaceSlug}/projects/${projectId}/routes/${r.id}/edit`)}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-100 transition-colors ${
                    isActive
                      ? 'bg-indigo-50 border-l-2 border-l-indigo-500'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                      r.method === 'GET' ? 'bg-green-100 text-green-700' :
                      r.method === 'POST' ? 'bg-orange-100 text-orange-700' :
                      r.method === 'PUT' ? 'bg-blue-100 text-blue-700' :
                      r.method === 'PATCH' ? 'bg-purple-100 text-purple-700' :
                      'bg-red-100 text-red-700'
                    }`}>{r.method}</span>
                  </div>
                  <p className="text-xs font-mono text-gray-700 truncate">{r.path}</p>
                  {r.name && <p className="text-[10px] text-gray-400 truncate">{r.name}</p>}
                </button>
              )
            })}
            {isNew && (
              <div className="px-3 py-2.5 bg-indigo-50 border-l-2 border-l-indigo-500 border-b border-gray-100">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono ${
                    meta.method === 'GET' ? 'bg-green-100 text-green-700' :
                    meta.method === 'POST' ? 'bg-orange-100 text-orange-700' :
                    meta.method === 'PUT' ? 'bg-blue-100 text-blue-700' :
                    meta.method === 'PATCH' ? 'bg-purple-100 text-purple-700' :
                    'bg-red-100 text-red-700'
                  }`}>{meta.method}</span>
                </div>
                <p className="text-xs font-mono text-gray-700 truncate">{meta.path || '/'}</p>
                <p className="text-[10px] text-gray-400 italic">New route</p>
              </div>
            )}
            <div className="h-[25%]" />
          </div>
        </div>

        {/* Canvas area with node palette */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Horizontal node palette */}
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-200 bg-gray-50 overflow-x-auto shrink-0">
            {!nodes.some((n) => n.type === 'trigger') && (
              <button
                onClick={() => addNode('trigger')}
                className="shrink-0 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap"
                title="Required — exactly one per flow"
              >Trigger</button>
            )}
            <button
              onClick={() => addNode('upstream_call')}
              className="shrink-0 bg-white hover:bg-blue-50 border-2 border-blue-400 rounded-md px-2.5 py-1 text-xs font-bold text-blue-600 uppercase transition-colors whitespace-nowrap"
            >Upstream Call</button>
            <button
              onClick={() => addNode('transform')}
              className="shrink-0 bg-white hover:bg-yellow-50 border-2 border-yellow-400 rounded-md px-2.5 py-1 text-xs font-bold text-yellow-600 uppercase transition-colors whitespace-nowrap"
            >Transform</button>
            <button
              onClick={() => addNode('condition')}
              className="shrink-0 bg-white hover:bg-orange-50 border-2 border-orange-400 rounded-md px-2.5 py-1 text-xs font-bold text-orange-600 uppercase transition-colors whitespace-nowrap"
            >Condition</button>
            <button
              onClick={() => addNode('loop')}
              className="shrink-0 bg-white hover:bg-rose-50 border-2 border-rose-500 rounded-md px-2.5 py-1 text-xs font-bold text-rose-600 uppercase transition-colors whitespace-nowrap"
              title="Iteratively re-execute a node until a stop condition is met"
            >Loop</button>
            <button
              onClick={() => addNode('merge')}
              className="shrink-0 bg-white hover:bg-teal-50 border-2 border-teal-500 rounded-md px-2.5 py-1 text-xs font-bold text-teal-600 uppercase transition-colors whitespace-nowrap"
            >Merge</button>
            <div className="w-px h-5 bg-gray-300 mx-1 shrink-0" />
            <button
              onClick={() => addNode('issue_jwt')}
              className="shrink-0 bg-white hover:bg-purple-50 border-2 border-purple-500 rounded-md px-2.5 py-1 text-xs font-bold text-purple-600 uppercase transition-colors whitespace-nowrap"
              title="Sign access + refresh tokens from claims"
            >Issue JWT</button>
            <button
              onClick={() => addNode('refresh_jwt')}
              className="shrink-0 bg-white hover:bg-violet-50 border-2 border-violet-500 rounded-md px-2.5 py-1 text-xs font-bold text-violet-600 uppercase transition-colors whitespace-nowrap"
              title="Rotate refresh token, issue new access token"
            >Refresh JWT</button>
            <button
              onClick={() => addNode('gateway_auth_verify')}
              className="shrink-0 bg-white hover:bg-amber-50 border-2 border-amber-500 rounded-md px-2.5 py-1 text-xs font-bold text-amber-600 uppercase transition-colors whitespace-nowrap"
              title="Verify email+password against gateway-managed users"
            >Gateway Verify</button>
            <button
              onClick={() => addNode('gateway_auth_register')}
              className="shrink-0 bg-white hover:bg-green-50 border-2 border-green-500 rounded-md px-2.5 py-1 text-xs font-bold text-green-600 uppercase transition-colors whitespace-nowrap"
              title="Create a gateway-managed user"
            >Gateway Register</button>
            {!nodes.some((n) => n.type === 'response') && (
              <>
                <div className="w-px h-5 bg-gray-300 mx-1 shrink-0" />
                <button
                  onClick={() => addNode('response')}
                  className="shrink-0 bg-green-600 hover:bg-green-700 text-white rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap"
                  title="Recommended — defines response status & body"
                >Response 200</button>
              </>
            )}
          </div>

          <div className="flex-1 flex overflow-hidden">
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={() => setSelectedNode(null)}
            nodeTypes={nodeTypes}
            deleteKeyCode={['Delete', 'Backspace']}
            fitView
            fitViewOptions={{ maxZoom: 1.0 }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e5e7eb" />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {/* Node config panel */}
        {selectedNode && (
          <div className="flex shrink-0" style={{ width: panelWidth }}>
            {/* Resize handle */}
            <div
              onMouseDown={onResizeMouseDown}
              className="w-1 cursor-col-resize hover:bg-indigo-400 active:bg-indigo-500 bg-gray-200 transition-colors shrink-0"
            />
            <div className="flex-1 border-l border-gray-200 bg-white overflow-y-auto flex flex-col min-w-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <span className="text-sm font-semibold text-gray-800">
                {({
                  upstream_call: 'Upstream Call Config',
                  issue_jwt: 'Issue JWT',
                  refresh_jwt: 'Refresh JWT',
                  gateway_auth_verify: 'Gateway Verify',
                  gateway_auth_register: 'Gateway Register',
                  merge: 'Merge',
                  response: 'Response',
                  transform: 'Transform',
                  condition: 'Condition',
                } as Record<string, string>)[selectedNode.type ?? ''] ?? 'Node Config'}
              </span>
              <button onClick={() => setSelectedNode(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50">
              <code className="flex-1 text-xs font-mono text-gray-600 truncate select-all" title={selectedNode.id}>{selectedNode.id}</code>
              <button
                onClick={() => {
                  const text = selectedNode.id
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(text).then(() => {
                      setCopiedNodeId(true)
                      setTimeout(() => setCopiedNodeId(false), 1500)
                    })
                  } else {
                    const el = document.createElement('textarea')
                    el.value = text
                    document.body.appendChild(el)
                    el.select()
                    document.execCommand('copy')
                    document.body.removeChild(el)
                    setCopiedNodeId(true)
                    setTimeout(() => setCopiedNodeId(false), 1500)
                  }
                }}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors shrink-0"
                title="Copy node ID"
              >
                {copiedNodeId ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                    <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                  </svg>
                )}
                {copiedNodeId ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="p-4 flex flex-col gap-4 text-sm">

            {selectedNode.type === 'upstream_call' && <>
              {/* Type */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
                <StyledSelect
                  value={(selectedNode.data.type as string) || 'REST'}
                  onChange={(v) => updateNodeData(selectedNode.id, { type: v })}
                  options={[
                    { value: 'REST', label: 'REST' },
                    { value: 'GRAPHQL', label: 'GRAPHQL' },
                    { value: 'SOAP', label: 'SOAP' },
                  ]}
                />
              </div>

              {/* Method */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
                <StyledSelect
                  value={(selectedNode.data.method as string) || 'GET'}
                  onChange={(v) => updateNodeData(selectedNode.id, { method: v })}
                  options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))}
                />
              </div>

              {/* URL */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">URL</label>
                <TemplateInput
                  value={(selectedNode.data.url as string) || ''}
                  onChange={(v) => updateNodeData(selectedNode.id, { url: v })}
                  suggestions={(project?.params?.variables ?? []).map((v) => v.name)}
                  placeholder="https://example.com/api/..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Use <code className="bg-gray-100 px-1 rounded font-mono">{'{{nodeId.path}}'}</code> for dynamic segments, e.g. <code className="bg-gray-100 px-1 rounded font-mono">{'{{trigger.params.id}}'}</code>. Values are URL-encoded.
                </p>
              </div>

              {/* Timeout */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Timeout (ms)</label>
                <input
                  type="number"
                  value={(selectedNode.data.timeout as number) || 10000}
                  onChange={(e) => updateNodeData(selectedNode.id, { timeout: Number(e.target.value) })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Upstream Auth */}
              <div className="border border-gray-200 rounded-lg p-3 flex flex-col gap-3">
                <label className="text-xs font-semibold text-gray-600">Upstream Auth</label>
                <StyledSelect
                  value={((selectedNode.data.upstreamAuth as Record<string, unknown> | undefined)?.type as string) || 'none'}
                  onChange={(v) => updateNodeData(selectedNode.id, { upstreamAuth: { type: v, useProjectParam: false } })}
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'bearer', label: 'Bearer Token' },
                    { value: 'basic', label: 'Basic Auth' },
                    { value: 'apikey_header', label: 'API Key — Header' },
                    { value: 'apikey_query', label: 'API Key — Query Param' },
                  ]}
                />

                {/* "Use project parameter" toggle — only shown when the selected type is configured in project params */}
                {(() => {
                  const authType = ((selectedNode.data.upstreamAuth as Record<string, unknown> | undefined)?.type as string) || 'none'
                  const ua = project?.params?.upstreamAuth
                  const hasProjectParam =
                    (authType === 'bearer' && !!ua?.bearer) ||
                    (authType === 'basic' && !!ua?.basic) ||
                    (authType === 'apikey_header' && !!ua?.apikey_header) ||
                    (authType === 'apikey_query' && !!ua?.apikey_query)
                  if (authType === 'none' || !hasProjectParam) return null
                  const usingProjectParam = !!(selectedNode.data.upstreamAuth as Record<string, unknown> | undefined)?.useProjectParam
                  return (
                    <label className="flex items-center gap-2 text-xs text-indigo-700 font-medium cursor-pointer select-none bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
                      <input
                        type="checkbox"
                        checked={usingProjectParam}
                        onChange={(e) => updateNodeData(selectedNode.id, {
                          upstreamAuth: { ...((selectedNode.data.upstreamAuth as Record<string, unknown>) ?? {}), useProjectParam: e.target.checked },
                        })}
                        className="accent-indigo-600"
                      />
                      Use project parameter
                      {usingProjectParam && (
                        <span className="ml-auto text-indigo-400 font-normal">credentials from project settings</span>
                      )}
                    </label>
                  )
                })()}

                {/* Credential fields — hidden when useProjectParam is true */}
                {!((selectedNode.data.upstreamAuth as Record<string, unknown> | undefined)?.useProjectParam) && (
                  <>
                    {((selectedNode.data.upstreamAuth as Record<string, string> | undefined)?.type) === 'bearer' && (
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Token</label>
                        <input
                          value={((selectedNode.data.upstreamAuth as Record<string, string> | undefined)?.token) || ''}
                          onChange={(e) => updateNodeData(selectedNode.id, { upstreamAuth: { type: 'bearer', token: e.target.value } })}
                          placeholder="$ENV_VAR or literal token"
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    )}

                    {((selectedNode.data.upstreamAuth as Record<string, string> | undefined)?.type) === 'basic' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
                          <input
                            value={((selectedNode.data.upstreamAuth as Record<string, string> | undefined)?.username) || ''}
                            onChange={(e) => updateNodeData(selectedNode.id, { upstreamAuth: { ...((selectedNode.data.upstreamAuth as Record<string, string>) ?? {}), type: 'basic', username: e.target.value } })}
                            placeholder="$ENV_VAR or literal"
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Password</label>
                          <input
                            value={((selectedNode.data.upstreamAuth as Record<string, string> | undefined)?.password) || ''}
                            onChange={(e) => updateNodeData(selectedNode.id, { upstreamAuth: { ...((selectedNode.data.upstreamAuth as Record<string, string>) ?? {}), type: 'basic', password: e.target.value } })}
                            placeholder="$ENV_VAR or literal"
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </>
                    )}

                    {((selectedNode.data.upstreamAuth as Record<string, string> | undefined)?.type) === 'apikey_header' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Header Name</label>
                          <input
                            value={((selectedNode.data.upstreamAuth as Record<string, string> | undefined)?.headerName) || ''}
                            onChange={(e) => updateNodeData(selectedNode.id, { upstreamAuth: { ...((selectedNode.data.upstreamAuth as Record<string, string>) ?? {}), type: 'apikey_header', headerName: e.target.value } })}
                            placeholder="X-API-Key"
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Key</label>
                          <input
                            value={((selectedNode.data.upstreamAuth as Record<string, string> | undefined)?.key) || ''}
                            onChange={(e) => updateNodeData(selectedNode.id, { upstreamAuth: { ...((selectedNode.data.upstreamAuth as Record<string, string>) ?? {}), type: 'apikey_header', key: e.target.value } })}
                            placeholder="$ENV_VAR or literal"
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </>
                    )}

                    {((selectedNode.data.upstreamAuth as Record<string, string> | undefined)?.type) === 'apikey_query' && (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Query Param Name</label>
                          <input
                            value={((selectedNode.data.upstreamAuth as Record<string, string> | undefined)?.paramName) || ''}
                            onChange={(e) => updateNodeData(selectedNode.id, { upstreamAuth: { ...((selectedNode.data.upstreamAuth as Record<string, string>) ?? {}), type: 'apikey_query', paramName: e.target.value } })}
                            placeholder="api_key"
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Key</label>
                          <input
                            value={((selectedNode.data.upstreamAuth as Record<string, string> | undefined)?.key) || ''}
                            onChange={(e) => updateNodeData(selectedNode.id, { upstreamAuth: { ...((selectedNode.data.upstreamAuth as Record<string, string>) ?? {}), type: 'apikey_query', key: e.target.value } })}
                            placeholder="$ENV_VAR or literal"
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </>
                    )}
                  </>
                )}

                <p className="text-xs text-gray-400">
                  Use <code className="bg-gray-100 px-1 rounded font-mono">$VAR_NAME</code> to reference an environment variable (recommended for secrets).
                </p>
              </div>

              {/* Headers */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Headers</label>
                <HeadersEditor
                  headers={(selectedNode.data.headers as Record<string, string>) || {}}
                  onChange={(h) => updateNodeData(selectedNode.id, { headers: h })}
                />
              </div>

              {/* Params / Body From */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Params / Body From</label>
                <NodeRefMultiInput
                  values={Array.isArray(selectedNode.data.bodyFrom) ? selectedNode.data.bodyFrom as string[] : (selectedNode.data.bodyFrom ? [selectedNode.data.bodyFrom as string] : [])}
                  onChange={(vs) => updateNodeData(selectedNode.id, { bodyFrom: vs.length > 0 ? vs : undefined })}
                  availableNodes={nodes.filter((n) => n.id !== selectedNode.id && n.type !== 'response')}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Select one or more sources — they are shallow-merged in order (later entries win on key collision).
                  Use <code className="bg-gray-100 px-1 rounded font-mono">trigger.query</code> to forward all incoming query parameters.
                </p>
              </div>

              {/* Body / GraphQL */}
              {(selectedNode.data.type === 'GRAPHQL') ? (
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">GraphQL Query</label>
                    <textarea
                      rows={5}
                      value={(selectedNode.data.graphqlQuery as string) || ''}
                      onChange={(e) => updateNodeData(selectedNode.id, { graphqlQuery: e.target.value })}
                      placeholder="query { ... }"
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">GraphQL Variables From (optional)</label>
                    <NodeRefInput
                      value={(selectedNode.data.graphqlVariablesFrom as string) || ''}
                      onChange={(v) => updateNodeData(selectedNode.id, { graphqlVariablesFrom: v || undefined })}
                      placeholder="trigger.body"
                      availableNodes={nodes.filter((n) => n.id !== selectedNode.id && n.type !== 'response')}
                    />
                    <p className="text-xs text-gray-400 mt-1">Node ref to resolve as the GraphQL variables object (e.g. <code className="bg-gray-100 px-1 rounded font-mono">trigger.body</code>). Leave blank for no variables.</p>
                  </div>
                </div>
              ) : (selectedNode.data.type === 'SOAP') ? (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">SOAP Action</label>
                  <input
                    value={(selectedNode.data.soapAction as string) || ''}
                    onChange={(e) => updateNodeData(selectedNode.id, { soapAction: e.target.value })}
                    placeholder="urn:SomeAction"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <label className="block text-xs font-medium text-gray-500 mt-3 mb-1">SOAP Body (XML)</label>
                  <textarea
                    rows={5}
                    value={(selectedNode.data.body as string) || ''}
                    onChange={(e) => updateNodeData(selectedNode.id, { body: e.target.value })}
                    placeholder="<soap:Body>...</soap:Body>"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Request Body (JSON)</label>
                  <textarea
                    rows={4}
                    value={typeof selectedNode.data.body === 'string' ? selectedNode.data.body : (selectedNode.data.body ? JSON.stringify(selectedNode.data.body, null, 2) : '')}
                    onChange={(e) => updateNodeData(selectedNode.id, { body: e.target.value || undefined })}
                    placeholder='{ "key": "value" }'
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                  />
                </div>
              )}
            </>}

            {/* issue_jwt config */}
            {selectedNode.type === 'issue_jwt' && <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Claims From (optional)</label>
                <NodeRefInput
                  value={(selectedNode.data.claimsFrom as string) || ''}
                  onChange={(v) => updateNodeData(selectedNode.id, { claimsFrom: v })}
                  placeholder="nodeId.data (leave blank to auto-detect)"
                  availableNodes={nodes.filter((n) => n.id !== selectedNode.id && n.type !== 'trigger' && n.type !== 'response')}
                />
                <p className="text-xs text-gray-400 mt-1">JMESPath ref to extract claims from a previous node result. Leave blank to auto-use the preceding <code className="bg-gray-100 px-1 rounded">gateway_auth_*</code> or <code className="bg-gray-100 px-1 rounded">upstream_call</code> node.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Expires In</label>
                <input
                  value={(selectedNode.data.expiresIn as string) || '24h'}
                  onChange={(e) => updateNodeData(selectedNode.id, { expiresIn: e.target.value })}
                  placeholder="24h"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">Access token lifetime: 1h, 24h, 7d, etc. Refresh token is always 7 days.</p>
              </div>
            </>}

            {/* refresh_jwt config */}
            {selectedNode.type === 'refresh_jwt' && <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Expires In</label>
                <input
                  value={(selectedNode.data.expiresIn as string) || '24h'}
                  onChange={(e) => updateNodeData(selectedNode.id, { expiresIn: e.target.value })}
                  placeholder="24h"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">New access token lifetime after refresh. Refresh tokens rotate automatically.</p>
              </div>
              <p className="text-xs text-gray-500 bg-violet-50 border border-violet-100 rounded-lg p-3">
                Reads <code className="font-mono bg-violet-100 px-1 rounded">refreshToken</code> from <code className="font-mono bg-violet-100 px-1 rounded">req.body</code>. Validates against Redis, rotates the token, and issues a new access + refresh token pair.
              </p>
            </>}

            {/* gateway_auth_verify / gateway_auth_register info */}
            {(selectedNode.type === 'gateway_auth_verify' || selectedNode.type === 'gateway_auth_register') && <>
              <p className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg p-3">
                {selectedNode.type === 'gateway_auth_verify'
                  ? 'Verifies email + password from req.body against the project\'s gateway-managed EndUser table. Returns user claims on success, or 401 on failure. Connect to an issue_jwt node to sign a token.'
                  : 'Creates a new EndUser in the project\'s gateway-managed user table using email + password from req.body. Returns user claims on success, or 409 if already registered. Connect to an issue_jwt node to sign a token.'}
              </p>
              <p className="text-xs text-gray-400">No additional configuration required. Manage users under the project\'s <strong>End Users</strong> section.</p>
            </>}

            {/* merge config */}
            {selectedNode.type === 'merge' && <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Strategy</label>
                <StyledSelect
                  value={(selectedNode.data.strategy as string) || 'merge'}
                  onChange={(v) => updateNodeData(selectedNode.id, { strategy: v })}
                  options={[
                    { value: 'merge', label: 'Deep merge objects (default)' },
                    { value: 'array', label: 'Return as array' },
                    { value: 'first', label: 'Return first source only' },
                  ]}
                />
                <p className="text-xs text-gray-400 mt-1">How to combine results from multiple nodes.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Sources</label>
                <div className="flex flex-col gap-2">
                  {((selectedNode.data.sources as string[]) || []).map((src, i) => {
                    const sources = (selectedNode.data.sources as string[]) || []
                    return (
                      <div key={i} className="flex gap-1 items-center">
                        <div className="flex-1">
                          <NodeRefInput
                            value={src}
                            onChange={(v) => {
                              const next = sources.map((s, idx) => idx === i ? v : s)
                              updateNodeData(selectedNode.id, { sources: next })
                            }}
                            placeholder="nodeId.data"
                            objectsOnly
                            availableNodes={nodes.filter((n) => n.id !== selectedNode.id && n.type !== 'trigger' && n.type !== 'response')}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => updateNodeData(selectedNode.id, { sources: sources.filter((_, idx) => idx !== i) })}
                          className="shrink-0 text-gray-400 hover:text-red-500 px-1.5 text-sm transition-colors"
                        >×</button>
                      </div>
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => updateNodeData(selectedNode.id, { sources: [...((selectedNode.data.sources as string[]) || []), ''] })}
                    className="text-xs text-indigo-600 hover:text-indigo-800 text-left transition-colors"
                  >+ Add source</button>
                </div>
                <p className="text-xs text-gray-400 mt-2">Supports dot-path refs, e.g. <code className="bg-gray-100 px-1 rounded font-mono">nodeId.data</code> for just the response body, or <code className="bg-gray-100 px-1 rounded font-mono">nodeId</code> for the full result.</p>
              </div>
            </>}

            {/* response config */}
            {selectedNode.type === 'response' && <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">HTTP Status</label>
                <input
                  type="number"
                  value={(selectedNode.data.status as number) ?? 200}
                  onChange={(e) => updateNodeData(selectedNode.id, { status: Number(e.target.value) })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Data From</label>
                <NodeRefInput
                  value={(selectedNode.data.dataFrom as string) || ''}
                  onChange={(v) => updateNodeData(selectedNode.id, { dataFrom: v })}
                  placeholder="nodeId or nodeId.data.field"
                  availableNodes={nodes.filter((n) => n.type !== 'trigger' && n.type !== 'response')}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Leave blank to auto-detect last meaningful node. Available IDs:{' '}
                  <span className="font-mono break-all">
                    {nodes.filter((n) => n.type !== 'trigger' && n.type !== 'response').map((n) => n.id).join(', ') || '(none)'}
                  </span>
                </p>
              </div>
            </>}

            {/* transform config */}
            {selectedNode.type === 'transform' && <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Input From</label>
                <NodeRefInput
                  value={(selectedNode.data.inputFrom as string) || ''}
                  onChange={(v) => updateNodeData(selectedNode.id, { inputFrom: v })}
                  placeholder="e.g. upstream-1.data or trigger.body"
                  availableNodes={nodes.filter((n) => n.id !== selectedNode.id && n.type !== 'response')}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Reference any prior node's output. Use <code className="bg-gray-100 px-1 rounded font-mono">trigger.body</code> / <code className="bg-gray-100 px-1 rounded font-mono">trigger.query</code> for the incoming request, or <code className="bg-gray-100 px-1 rounded font-mono">nodeId.data</code> for an upstream response body.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Transform Type</label>
                <StyledSelect
                  value={((selectedNode.data.transform as Record<string, unknown> | undefined)?.type as string) || 'jmespath'}
                  onChange={(v) =>
                    updateNodeData(selectedNode.id, {
                      transform: { ...((selectedNode.data.transform as Record<string, unknown>) ?? {}), type: v },
                    })
                  }
                  options={[
                    { value: 'jmespath', label: 'JMESPath' },
                    { value: 'field_mapping', label: 'Field Mapping' },
                    { value: 'template', label: 'Handlebars Template' },
                    { value: 'sandbox_js', label: 'Sandbox JS' },
                  ]}
                />
              </div>
              {(((selectedNode.data.transform as Record<string, unknown> | undefined)?.type as string) || 'jmespath') === 'jmespath' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">JMESPath Expression</label>
                  <textarea
                    value={((selectedNode.data.transform as Record<string, unknown> | undefined)?.expression as string) || ''}
                    onChange={(e) =>
                      updateNodeData(selectedNode.id, {
                        transform: { ...((selectedNode.data.transform as Record<string, unknown>) ?? {}), expression: e.target.value },
                      })
                    }
                    placeholder="items[0].name"
                    rows={4}
                    spellCheck={false}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y whitespace-pre"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    JMESPath expression evaluated against the input. Examples: <code className="bg-gray-100 px-1 rounded font-mono">data.user.id</code>, <code className="bg-gray-100 px-1 rounded font-mono">items[*].name</code>, <code className="bg-gray-100 px-1 rounded font-mono">data[?active==`true`]</code>.
                  </p>
                </div>
              )}
              {((selectedNode.data.transform as Record<string, unknown> | undefined)?.type as string) === 'field_mapping' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Field Mappings</label>
                  <MappingsEditor
                    mappings={((selectedNode.data.transform as Record<string, unknown> | undefined)?.mappings as Array<{ from: string; to: string }>) || []}
                    onChange={(m) =>
                      updateNodeData(selectedNode.id, {
                        transform: { ...((selectedNode.data.transform as Record<string, unknown>) ?? {}), mappings: m },
                      })
                    }
                  />
                  <p className="text-xs text-gray-400 mt-2">
                    Use <code className="bg-gray-100 px-1 rounded font-mono">$.path.to.field</code> notation for both source (<em>From</em>) and destination (<em>To</em>). The leading <code className="bg-gray-100 px-1 rounded font-mono">$.</code> is optional. Each mapping copies one field; missing paths are silently skipped.
                  </p>
                </div>
              )}
              {((selectedNode.data.transform as Record<string, unknown> | undefined)?.type as string) === 'template' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Handlebars Template</label>
                  <textarea
                    rows={5}
                    value={((selectedNode.data.transform as Record<string, unknown> | undefined)?.template as string) || ''}
                    onChange={(e) =>
                      updateNodeData(selectedNode.id, {
                        transform: { ...((selectedNode.data.transform as Record<string, unknown>) ?? {}), template: e.target.value },
                      })
                    }
                    placeholder='{"id": "{{data.id}}"}'
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                  />
                  <p className="text-xs text-gray-400 mt-1">Variables: <code className="bg-gray-100 px-1 rounded font-mono">data</code> (input), <code className="bg-gray-100 px-1 rounded font-mono">context.nodeId</code> (prior results).</p>
                </div>
              )}
              {((selectedNode.data.transform as Record<string, unknown> | undefined)?.type as string) === 'sandbox_js' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">JS Script</label>
                  <textarea
                    rows={6}
                    value={((selectedNode.data.transform as Record<string, unknown> | undefined)?.script as string) || ''}
                    onChange={(e) =>
                      updateNodeData(selectedNode.id, {
                        transform: { ...((selectedNode.data.transform as Record<string, unknown>) ?? {}), script: e.target.value },
                      })
                    }
                    placeholder="return { id: input.data.id };"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Variables: <code className="bg-gray-100 px-1 rounded font-mono">input</code> (the resolved Input From value) and <code className="bg-gray-100 px-1 rounded font-mono">context</code> (map of all prior node results keyed by node ID). Must return a value via <code className="bg-gray-100 px-1 rounded font-mono">return ...</code>. CPU timeout: 100ms. No network or filesystem access.
                  </p>
                </div>
              )}
            </>}

            {/* condition config */}
            {selectedNode.type === 'condition' && <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Input From</label>
                <NodeRefInput
                  value={(selectedNode.data.inputFrom as string) || ''}
                  onChange={(v) => updateNodeData(selectedNode.id, { inputFrom: v })}
                  availableNodes={nodes.filter((n) => n.id !== selectedNode.id && n.type !== 'trigger' && n.type !== 'response')}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Condition (JMESPath)</label>
                <input
                  value={(selectedNode.data.condition as string) || ''}
                  onChange={(e) => updateNodeData(selectedNode.id, { condition: e.target.value })}
                  placeholder="status == `200`"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">Evaluated against the input. Routes to True or False branch based on truthiness.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">True Branch → Node</label>
                <StyledSelect
                  value={(selectedNode.data['true'] as string) || ''}
                  onChange={(v) => updateNodeData(selectedNode.id, { true: v })}
                  options={[
                    { value: '', label: '— not set —' },
                    ...nodes.filter((n) => n.id !== selectedNode.id).map((n) => ({
                      value: n.id,
                      label: `${n.id} (${n.type})`,
                    })),
                  ]}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">False Branch → Node</label>
                <StyledSelect
                  value={(selectedNode.data['false'] as string) || ''}
                  onChange={(v) => updateNodeData(selectedNode.id, { false: v })}
                  options={[
                    { value: '', label: '— not set —' },
                    ...nodes.filter((n) => n.id !== selectedNode.id).map((n) => ({
                      value: n.id,
                      label: `${n.id} (${n.type})`,
                    })),
                  ]}
                />
              </div>
            </>}

            {/* loop config */}
            {selectedNode.type === 'loop' && <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Target Node</label>
                <StyledSelect
                  value={(selectedNode.data.targetNodeId as string) || ''}
                  onChange={(v) => updateNodeData(selectedNode.id, { targetNodeId: v })}
                  options={[
                    { value: '', label: '— not set —' },
                    ...nodes
                      .filter((n) => n.id !== selectedNode.id && n.type !== 'trigger' && n.type !== 'response' && n.type !== 'loop')
                      .map((n) => ({ value: n.id, label: `${n.id} (${n.type})` })),
                  ]}
                />
                <p className="text-xs text-gray-400 mt-1">The node that is re-executed each iteration. Its result is collected into an array.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Stop Condition (JMESPath)</label>
                <input
                  value={(selectedNode.data.stopCondition as string) || ''}
                  onChange={(e) => updateNodeData(selectedNode.id, { stopCondition: e.target.value })}
                  placeholder="length(items) == `0`"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">Evaluated against the latest iteration result. Loop stops when this expression is truthy.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Max Iterations</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={(selectedNode.data.maxIterations as number) ?? 10}
                  onChange={(e) => updateNodeData(selectedNode.id, { maxIterations: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">Hard cap is 50 iterations regardless of this value.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Aggregate Results From (optional)</label>
                <NodeRefInput
                  value={(selectedNode.data.aggregateResultsFrom as string) || ''}
                  onChange={(v) => updateNodeData(selectedNode.id, { aggregateResultsFrom: v || undefined })}
                  placeholder="nodeId.data.items"
                  availableNodes={nodes.filter((n) => n.id !== selectedNode.id && n.type !== 'trigger' && n.type !== 'response')}
                />
                <p className="text-xs text-gray-400 mt-1">Optional ref to extract a value from each iteration. Defaults to the target node's full result.</p>
              </div>
              <p className="text-xs text-gray-500 bg-rose-50 border border-rose-100 rounded-lg p-3">
                Each iteration re-runs the target node and appends its (optionally extracted) result to an array. The loop stops when the stop condition is truthy or when max iterations is reached. The collected array is exposed as this loop node's result.
              </p>
            </>}

            </div>
            </div>
          </div>
        )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helper: universal styled select dropdown ──────────────────────────────────
function StyledSelect({
  value,
  onChange,
  options,
  className,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Element)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className={`relative ${className ?? 'w-full'}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
      >
        <span className="truncate text-left">{selected?.label ?? value}</span>
        <svg className="w-4 h-4 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 right-0 min-w-max bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false) }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-indigo-50 transition-colors ${
                value === o.value ? 'text-indigo-700 font-medium bg-indigo-50/50' : 'text-gray-700'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Helper: node ref input with custom styled dropdown ────────────────────────
const NODE_TYPE_COLORS: Record<string, string> = {
  upstream_call: 'bg-blue-100 text-blue-700',
  issue_jwt: 'bg-purple-100 text-purple-700',
  refresh_jwt: 'bg-violet-100 text-violet-700',
  merge: 'bg-teal-100 text-teal-700',
  transform: 'bg-yellow-100 text-yellow-700',
  condition: 'bg-orange-100 text-orange-700',
  gateway_auth_verify: 'bg-amber-100 text-amber-700',
  gateway_auth_register: 'bg-green-100 text-green-700',
}

function NodeRefInput({
  value,
  onChange,
  placeholder,
  availableNodes,
  objectsOnly = false,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  availableNodes: Node[]
  objectsOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Paths that resolve to primitives (not objects) — excluded when objectsOnly=true
  const PRIMITIVE_HINTS = new Set(['HTTP status', 'JWT access token', 'refresh token', 'expiry (seconds)'])

  // Build option groups: each node → its ref paths
  const groups: Array<{ node: Node; paths: Array<{ path: string; hint: string }> }> = []
  for (const n of availableNodes) {
    const paths: Array<{ path: string; hint: string }> = [
      { path: n.id, hint: 'full result' },
    ]
    if (n.type === 'trigger') {
      paths.push({ path: `${n.id}.query`, hint: 'query params' })
      paths.push({ path: `${n.id}.body`, hint: 'request body' })
      paths.push({ path: `${n.id}.params`, hint: 'path params' })
      paths.push({ path: `${n.id}.headers`, hint: 'request headers' })
    }
    if (n.type === 'upstream_call') {
      paths.push({ path: `${n.id}.data`, hint: 'response body' })
      paths.push({ path: `${n.id}.status`, hint: 'HTTP status' })
      paths.push({ path: `${n.id}.headers`, hint: 'response headers' })
    }
    if (n.type === 'issue_jwt') {
      paths.push({ path: `${n.id}.accessToken`, hint: 'JWT access token' })
      paths.push({ path: `${n.id}.refreshToken`, hint: 'refresh token' })
      paths.push({ path: `${n.id}.expiresIn`, hint: 'expiry (seconds)' })
    }
    const filtered = objectsOnly ? paths.filter((p) => !PRIMITIVE_HINTS.has(p.hint)) : paths
    groups.push({ node: n, paths: filtered })
  }

  const lowerFilter = filter.toLowerCase()
  const filteredGroups = groups
    .map((g) => ({
      ...g,
      paths: g.paths.filter(
        (p) => !lowerFilter || p.path.toLowerCase().includes(lowerFilter),
      ),
    }))
    .filter((g) => g.paths.length > 0)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Element)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (path: string) => {
    onChange(path)
    setOpen(false)
    setFilter('')
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-1">
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setFilter(e.target.value) }}
          onFocus={() => { setOpen(true); setFilter('') }}
          placeholder={placeholder ?? 'nodeId or nodeId.data.field'}
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="button"
          onClick={() => { setOpen((o) => !o); setFilter('') }}
          className="shrink-0 px-2 border border-gray-300 rounded-lg text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors"
          title="Show available refs"
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {/* Search filter */}
          <div className="px-3 py-2 border-b border-gray-100">
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter..."
              className="w-full text-xs px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-400 font-mono"
            />
          </div>

          {/* Options */}
          <div className="max-h-64 overflow-y-auto">
            {filteredGroups.length === 0 && (
              <p className="px-3 py-3 text-xs text-gray-400 italic">No matching refs</p>
            )}
            {filteredGroups.map(({ node, paths }) => (
              <div key={node.id}>
                {/* Node header */}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${NODE_TYPE_COLORS[node.type ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
                    {node.type}
                  </span>
                  <span className="text-xs font-mono text-gray-500 break-all">{node.id}</span>
                </div>
                {/* Ref path rows */}
                {paths.map(({ path, hint }) => (
                  <button
                    key={path}
                    type="button"
                    onClick={() => select(path)}
                    className="w-full text-left flex items-baseline gap-2 px-4 py-2 hover:bg-indigo-50 transition-colors group"
                  >
                    <span className="font-mono text-xs text-gray-800 break-all group-hover:text-indigo-700">{path}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-gray-400 group-hover:text-indigo-400">{hint}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helper: multi-select node ref input ───────────────────────────────────────
function NodeRefMultiInput({
  values,
  onChange,
  availableNodes,
}: {
  values: string[]
  onChange: (vs: string[]) => void
  availableNodes: Node[]
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const groups: Array<{ node: Node; paths: Array<{ path: string; hint: string }> }> = []
  for (const n of availableNodes) {
    const paths: Array<{ path: string; hint: string }> = [{ path: n.id, hint: 'full result' }]
    if (n.type === 'trigger') {
      paths.push({ path: `${n.id}.query`, hint: 'query params' })
      paths.push({ path: `${n.id}.body`, hint: 'request body' })
      paths.push({ path: `${n.id}.params`, hint: 'path params' })
      paths.push({ path: `${n.id}.headers`, hint: 'request headers' })
    }
    if (n.type === 'upstream_call') {
      paths.push({ path: `${n.id}.data`, hint: 'response body' })
      paths.push({ path: `${n.id}.headers`, hint: 'response headers' })
    }
    groups.push({ node: n, paths })
  }

  const lowerFilter = filter.toLowerCase()
  const filteredGroups = groups
    .map((g) => ({
      ...g,
      paths: g.paths.filter((p) => !lowerFilter || p.path.toLowerCase().includes(lowerFilter)),
    }))
    .filter((g) => g.paths.length > 0)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Element)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const toggle = (path: string) => {
    if (values.includes(path)) {
      onChange(values.filter((v) => v !== path))
    } else {
      onChange([...values, path])
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Selected tags + open button */}
      <div
        className="min-h-[34px] flex flex-wrap gap-1 items-center border border-gray-300 rounded-lg px-2 py-1 cursor-pointer hover:border-indigo-400 transition-colors"
        onClick={() => { setOpen((o) => !o); setFilter('') }}
      >
        {values.length === 0 && (
          <span className="text-xs text-gray-400 font-mono select-none">e.g. trigger.query</span>
        )}
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-mono rounded px-1.5 py-0.5"
          >
            {v}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(values.filter((x) => x !== v)) }}
              className="text-indigo-400 hover:text-indigo-700 leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <span className="ml-auto shrink-0 text-gray-400">
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </span>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100">
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter..."
              className="w-full text-xs px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-400 font-mono"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {filteredGroups.length === 0 && (
              <p className="px-3 py-3 text-xs text-gray-400 italic">No matching refs</p>
            )}
            {filteredGroups.map(({ node, paths }) => (
              <div key={node.id}>
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${NODE_TYPE_COLORS[node.type ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
                    {node.type}
                  </span>
                  <span className="text-xs font-mono text-gray-500 break-all">{node.id}</span>
                </div>
                {paths.map(({ path, hint }) => {
                  const selected = values.includes(path)
                  return (
                    <button
                      key={path}
                      type="button"
                      onClick={() => toggle(path)}
                      className={`w-full text-left flex items-baseline gap-2 px-4 py-2 transition-colors group ${selected ? 'bg-indigo-50' : 'hover:bg-indigo-50'}`}
                    >
                      <span className={`font-mono text-xs break-all ${selected ? 'text-indigo-700 font-semibold' : 'text-gray-800 group-hover:text-indigo-700'}`}>{path}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-gray-400 group-hover:text-indigo-400">{hint}</span>
                      {selected && <span className="shrink-0 text-indigo-500 text-xs">✓</span>}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helper: from→to field mapping editor ──────────────────────────────────────
function MappingsEditor({
  mappings,
  onChange,
}: {
  mappings: Array<{ from: string; to: string }>
  onChange: (m: Array<{ from: string; to: string }>) => void
}) {
  const set = (idx: number, field: 'from' | 'to', value: string) => {
    const next = mappings.map((m, i) => (i === idx ? { ...m, [field]: value } : m))
    onChange(next)
  }
  const remove = (idx: number) => onChange(mappings.filter((_, i) => i !== idx))
  return (
    <div className="flex flex-col gap-1.5">
      {mappings.map((m, i) => (
        <div key={i} className="flex gap-1 items-center">
          <input
            value={m.from}
            onChange={(e) => set(i, 'from', e.target.value)}
            placeholder="$.from"
            className="w-2/5 border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <span className="text-gray-400 text-xs">→</span>
          <input
            value={m.to}
            onChange={(e) => set(i, 'to', e.target.value)}
            placeholder="$.to"
            className="w-2/5 border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <button onClick={() => remove(i)} className="text-gray-400 hover:text-red-500 px-1 text-sm">×</button>
        </div>
      ))}
      <button
        onClick={() => onChange([...mappings, { from: '', to: '' }])}
        className="text-xs text-indigo-600 hover:text-indigo-800 text-left mt-0.5"
      >
        + Add mapping
      </button>
    </div>
  )
}

// ── Helper: key-value headers editor ──────────────────────────────────────────
function HeadersEditor({
  headers,
  onChange,
}: {
  headers: Record<string, string>
  onChange: (h: Record<string, string>) => void
}) {
  const entries = Object.entries(headers)
  const set = (idx: number, key: string, value: string) => {
    const next = [...entries]
    next[idx] = [key, value]
    onChange(Object.fromEntries(next.filter(([k]) => k !== '')))
  }
  const remove = (idx: number) => {
    const next = entries.filter((_, i) => i !== idx)
    onChange(Object.fromEntries(next))
  }
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-1">
          <input
            value={k}
            onChange={(e) => set(i, e.target.value, v)}
            placeholder="Key"
            className="w-1/2 border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <input
            value={v}
            onChange={(e) => set(i, k, e.target.value)}
            placeholder="Value"
            className="w-1/2 border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <button onClick={() => remove(i)} className="text-gray-400 hover:text-red-500 px-1 text-sm">×</button>
        </div>
      ))}
      <button
        onClick={() => onChange({ ...headers, '': '' })}
        className="text-xs text-indigo-600 hover:text-indigo-800 text-left mt-0.5"
      >
        + Add header
      </button>
    </div>
  )
}
