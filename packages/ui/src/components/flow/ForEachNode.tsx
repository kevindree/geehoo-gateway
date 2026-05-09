import { Handle, Position, NodeProps } from 'reactflow'

export default function ForEachNode({ id, data }: NodeProps) {
  const iterateFrom = (data.iterateFrom as string) || ''
  const targetNodeId = (data.targetNodeId as string) || ''
  const concurrency = (data.maxConcurrency as number) ?? 1

  return (
    <div className="bg-white border-2 border-pink-500 rounded-lg px-4 py-3 shadow-sm min-w-[160px]">
      <Handle type="target" position={Position.Left} />
      <p className="text-xs font-bold text-pink-600 uppercase mb-1">For Each</p>
      <p className="text-xs text-gray-500 font-mono truncate" title={iterateFrom}>
        {iterateFrom ? `↻ ${iterateFrom}` : 'no source'}
      </p>
      <p className="text-xs text-gray-500 font-mono truncate" title={targetNodeId}>
        {targetNodeId ? `→ ${targetNodeId}` : 'no target'}
      </p>
      <p className="text-xs text-gray-400">concurrency {concurrency}</p>
      <p className="text-[10px] text-gray-300 font-mono mt-1 truncate" title={id}>{id}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
