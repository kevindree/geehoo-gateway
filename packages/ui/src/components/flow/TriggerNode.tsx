import { Handle, Position, NodeProps } from 'reactflow'

export default function TriggerNode({ data }: NodeProps) {
  return (
    <div className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium shadow-sm min-w-[120px] text-center">
      {data.label ?? 'Trigger'}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
