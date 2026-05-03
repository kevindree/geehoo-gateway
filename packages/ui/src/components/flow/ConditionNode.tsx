import { Handle, Position, NodeProps } from 'reactflow'

export default function ConditionNode({ id, data }: NodeProps) {
  return (
    <div className="bg-white border-2 border-orange-400 rounded-lg px-4 py-3 shadow-sm min-w-[140px]">
      <Handle type="target" position={Position.Left} />
      <p className="text-xs font-bold text-orange-600 uppercase mb-1">Condition</p>
      <p className="text-xs text-gray-500 font-mono truncate">{(data.condition as string) || 'expression'}</p>
      <p className="text-[10px] text-gray-300 font-mono mt-1 truncate" title={id}>{id}</p>
      <Handle type="source" position={Position.Right} id="true" style={{ top: '30%' }} />
      <Handle type="source" position={Position.Right} id="false" style={{ top: '70%' }} />
    </div>
  )
}
