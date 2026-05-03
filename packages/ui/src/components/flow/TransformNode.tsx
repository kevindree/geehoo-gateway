import { Handle, Position, NodeProps } from 'reactflow'

export default function TransformNode({ id, data }: NodeProps) {
  const transform = (data.transform as Record<string, unknown> | undefined) ?? {}
  const transformType = (transform.type as string) || 'jmespath'
  const inputFrom = (data.inputFrom as string) || ''

  // Build a short preview of the transform expression/content
  let preview = ''
  if (transformType === 'jmespath') {
    preview = (transform.expression as string) || ''
  } else if (transformType === 'template') {
    const tpl = (transform.template as string) || ''
    preview = tpl.length > 40 ? tpl.slice(0, 40) + '…' : tpl
  } else if (transformType === 'sandbox_js') {
    const script = (transform.script as string) || ''
    preview = script.split('\n')[0]?.slice(0, 40) || ''
  } else if (transformType === 'field_mapping') {
    const mappings = (transform.mappings as Array<{ from: string; to: string }>) || []
    preview = mappings.length ? `${mappings.length} mapping${mappings.length !== 1 ? 's' : ''}` : ''
  }

  const TYPE_LABELS: Record<string, string> = {
    jmespath: 'JMESPath',
    field_mapping: 'Field Mapping',
    template: 'Template',
    sandbox_js: 'Sandbox JS',
  }

  return (
    <div className="bg-white border-2 border-yellow-400 rounded-lg px-4 py-3 shadow-sm min-w-[160px] max-w-[240px]">
      <Handle type="target" position={Position.Left} />
      <p className="text-xs font-bold text-yellow-600 uppercase mb-1">Transform</p>
      <p className="text-xs text-gray-700 font-medium">{TYPE_LABELS[transformType] ?? transformType}</p>
      {inputFrom && (
        <p className="text-xs text-gray-400 truncate mt-0.5">
          in: <span className="font-mono text-gray-500">{inputFrom}</span>
        </p>
      )}
      {preview && (
        <p className="text-[10px] text-gray-400 font-mono mt-1 truncate" title={preview}>{preview}</p>
      )}
      <p className="text-[9px] text-gray-300 font-mono mt-1 truncate" title={id}>{id}</p>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
