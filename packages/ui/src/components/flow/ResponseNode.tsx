import { Handle, Position, NodeProps } from 'reactflow'

export default function ResponseNode({ data }: NodeProps) {
  const dataFrom = (data.dataFrom as string) || ''

  return (
    <div className="bg-green-600 text-white rounded-lg px-4 py-2 text-sm font-medium shadow-sm min-w-[120px] text-center">
      <Handle type="target" position={Position.Left} />
      <p>Response {(data.status as number) ?? 200}</p>
      {dataFrom && (
        <p className="text-xs text-green-200 font-mono mt-0.5 max-w-[160px] truncate">{dataFrom}</p>
      )}
    </div>
  )
}
