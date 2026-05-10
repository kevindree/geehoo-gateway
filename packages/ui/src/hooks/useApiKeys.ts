import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export interface ApiKey {
  id: string
  label: string
  keyPrefix: string
  createdAt: string
  key?: string // raw key, only present at creation time
}

const base = (ws: string, pid: string) => `/workspaces/${ws}/projects/${pid}/api-keys`

export function useApiKeys(workspaceSlug: string | undefined, projectId: string | undefined) {
  return useQuery({
    queryKey: ['apikeys', workspaceSlug, projectId],
    queryFn: () => api.get<{ data: ApiKey[] }>(base(workspaceSlug!, projectId!)).then((r) => r.data.data),
    enabled: !!workspaceSlug && !!projectId,
  })
}

export function useCreateApiKey(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, label }: { projectId: string; label: string }) =>
      api.post<{ data: ApiKey }>(base(workspaceSlug!, projectId), { label }).then((r) => r.data.data),
    onSuccess: (_, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['apikeys', workspaceSlug, projectId] }),
  })
}

export function useRevokeApiKey(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, keyId }: { projectId: string; keyId: string }) =>
      api.delete(`${base(workspaceSlug!, projectId)}/${keyId}`),
    onSuccess: (_, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['apikeys', workspaceSlug, projectId] }),
  })
}
