import { Handle, Position, NodeProps } from 'reactflow'

export default function IssueJwtNode({ id, data }: NodeProps) {
  const claimsFrom = (data.claimsFrom as string) || ''
  const expiresIn = (data.expiresIn as string) || '24h'

  return (
    <div className="bg-white border-2 border-purple-500 rounded-lg px-4 py-3 shadow-sm min-w-[160px]">
      <Handle type="target" position={Position.Left} />
      <p className="text-xs font-bold text-purple-600 uppercase mb-1">Issue JWT</p>
      <p className="text-xs text-gray-500 truncate">
        {claimsFrom ? `from: ${claimsFrom}` : 'claims: auto-detect'}
      </p>
      <p className="text-xs text-gray-400">expires: {expiresIn}</p>
      <p className="text-[10px] text-gray-300 font-mono mt-1 truncate" title={id}>{id}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
