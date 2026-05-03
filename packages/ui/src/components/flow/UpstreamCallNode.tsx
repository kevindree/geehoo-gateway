import { Handle, Position, NodeProps } from 'reactflow'

const AUTH_LABELS: Record<string, string> = {
  bearer: 'Bearer',
  basic: 'Basic',
  apikey_header: 'API Key',
  apikey_query: 'API Key (Q)',
}

export default function UpstreamCallNode({ id, data }: NodeProps) {
  const authType = (data.upstreamAuth as { type?: string } | undefined)?.type
  const authLabel = authType && authType !== 'none' ? AUTH_LABELS[authType] : null

  return (
    <div className="bg-white border-2 border-blue-400 rounded-lg px-4 py-3 shadow-sm min-w-[160px]">
      <Handle type="target" position={Position.Left} />
      <p className="text-xs font-bold text-blue-600 uppercase mb-1">Upstream Call</p>
      <p className="text-sm text-gray-800 truncate">{(data.url as string) || 'Configure URL'}</p>
      <div className="flex items-center gap-1.5 mt-0.5">
        <p className="text-xs text-gray-400">{(data.method as string) || 'GET'} · {(data.type as string) || 'REST'}</p>
        {authLabel && (
          <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">{authLabel}</span>
        )}
      </div>
      <p className="text-[10px] text-gray-300 font-mono mt-1 truncate" title={id}>{id}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

