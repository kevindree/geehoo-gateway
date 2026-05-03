import { Handle, Position, NodeProps } from 'reactflow'

export default function LoopNode({ id, data }: NodeProps) {
  const targetNodeId = (data.targetNodeId as string) || ''
  const maxIterations = (data.maxIterations as number) ?? 10

  return (
    <div className="bg-white border-2 border-rose-500 rounded-lg px-4 py-3 shadow-sm min-w-[140px]">
      <Handle type="target" position={Position.Left} />
      <p className="text-xs font-bold text-rose-600 uppercase mb-1">Loop</p>
      <p className="text-xs text-gray-500 font-mono truncate" title={targetNodeId}>
        {targetNodeId ? `→ ${targetNodeId}` : 'no target'}
      </p>
      <p className="text-xs text-gray-400">max {maxIterations}</p>
      <p className="text-[10px] text-gray-300 font-mono mt-1 truncate" title={id}>{id}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
