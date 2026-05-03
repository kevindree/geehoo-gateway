import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export interface Upstream {
  id: string
  name: string
  url: string
  type: 'REST' | 'GRAPHQL' | 'SOAP' | 'WEBSOCKET'
  headers?: Record<string, string>
  timeout?: number
}

export function useUpstreams(projectId: string) {
  return useQuery({
    queryKey: ['upstreams', projectId],
    queryFn: () =>
      api.get<Upstream[]>(`/api/admin/projects/${projectId}/upstreams`).then((r) => r.data),
  })
}

export function useCreateUpstream() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: Partial<Upstream> }) =>
      api.post<Upstream>(`/api/admin/projects/${projectId}/upstreams`, data).then((r) => r.data),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['upstreams', projectId] })
    },
  })
}

export function useUpdateUpstream() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      upstreamId,
      data,
    }: {
      projectId: string
      upstreamId: string
      data: Partial<Upstream>
    }) =>
      api
        .put<Upstream>(`/api/admin/projects/${projectId}/upstreams/${upstreamId}`, data)
        .then((r) => r.data),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['upstreams', projectId] })
    },
  })
}

export function useDeleteUpstream() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, upstreamId }: { projectId: string; upstreamId: string }) =>
      api.delete(`/api/admin/projects/${projectId}/upstreams/${upstreamId}`),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['upstreams', projectId] })
    },
  })
}
