import { Handle, Position, NodeProps } from 'reactflow'

export default function RefreshJwtNode({ id, data }: NodeProps) {
  const expiresIn = (data.expiresIn as string) || '24h'

  return (
    <div className="bg-white border-2 border-violet-500 rounded-lg px-4 py-3 shadow-sm min-w-[150px]">
      <Handle type="target" position={Position.Left} />
      <p className="text-xs font-bold text-violet-600 uppercase mb-1">Refresh JWT</p>
      <p className="text-xs text-gray-400">req.body.refreshToken</p>
      <p className="text-xs text-gray-400">new expires: {expiresIn}</p>
      <p className="text-[10px] text-gray-300 font-mono mt-1 truncate" title={id}>{id}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
