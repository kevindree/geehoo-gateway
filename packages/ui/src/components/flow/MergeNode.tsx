import { Handle, Position, NodeProps } from 'reactflow'

export default function MergeNode({ id, data }: NodeProps) {
  const sources = (data.sources as string[]) || []
  const strategy = (data.strategy as string) || 'merge'

  return (
    <div className="bg-white border-2 border-teal-500 rounded-lg px-4 py-3 shadow-sm min-w-[140px]">
      <Handle type="target" position={Position.Left} />
      <p className="text-xs font-bold text-teal-600 uppercase mb-1">Merge</p>
      <p className="text-xs text-gray-500">
        {sources.length ? `${sources.length} source${sources.length > 1 ? 's' : ''}` : 'No sources'}
      </p>
      <p className="text-xs text-gray-400">{strategy}</p>
      <p className="text-[10px] text-gray-300 font-mono mt-1 truncate" title={id}>{id}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
