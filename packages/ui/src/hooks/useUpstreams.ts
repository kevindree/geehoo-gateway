import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export interface Upstream {
  id: string
  name: string
  baseUrl: string
  type: 'REST' | 'GRAPHQL' | 'SOAP' | 'WEBSOCKET'
  defaultHeaders?: Record<string, string>
  timeout?: number
}

const base = (ws: string, pid: string) => `/workspaces/${ws}/projects/${pid}/upstreams`

export function useUpstreams(workspaceSlug: string | undefined, projectId: string | undefined) {
  return useQuery({
    queryKey: ['upstreams', workspaceSlug, projectId],
    queryFn: () => api.get<{ data: Upstream[] }>(base(workspaceSlug!, projectId!)).then((r) => r.data.data),
    enabled: !!workspaceSlug && !!projectId,
  })
}

export function useCreateUpstream(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: Partial<Upstream> }) =>
      api.post<{ data: Upstream }>(base(workspaceSlug!, projectId), data).then((r) => r.data.data),
    onSuccess: (_, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['upstreams', workspaceSlug, projectId] }),
  })
}

export function useUpdateUpstream(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, upstreamId, data }: { projectId: string; upstreamId: string; data: Partial<Upstream> }) =>
      api.put<{ data: Upstream }>(`${base(workspaceSlug!, projectId)}/${upstreamId}`, data).then((r) => r.data.data),
    onSuccess: (_, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['upstreams', workspaceSlug, projectId] }),
  })
}

export function useDeleteUpstream(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, upstreamId }: { projectId: string; upstreamId: string }) =>
      api.delete(`${base(workspaceSlug!, projectId)}/${upstreamId}`),
    onSuccess: (_, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['upstreams', workspaceSlug, projectId] }),
  })
}
