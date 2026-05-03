import { Handle, Position, NodeProps } from 'reactflow'

export default function GatewayAuthNode({ id, type }: NodeProps) {
  const isRegister = type === 'gateway_auth_register'

  return (
    <div
      className={`bg-white border-2 ${isRegister ? 'border-green-500' : 'border-amber-500'} rounded-lg px-4 py-3 shadow-sm min-w-[170px]`}
    >
      <Handle type="target" position={Position.Left} />
      <p className={`text-xs font-bold ${isRegister ? 'text-green-600' : 'text-amber-600'} uppercase mb-1`}>
        {isRegister ? 'Gateway Register' : 'Gateway Verify'}
      </p>
      <p className="text-xs text-gray-400">email + password from req.body</p>
      <p className="text-[10px] text-gray-300 font-mono mt-1 truncate" title={id}>{id}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
