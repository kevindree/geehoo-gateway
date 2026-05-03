import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export interface ApiKey {
  id: string
  name: string
  prefix: string
  createdAt: string
  // rawKey is only present immediately after creation
  rawKey?: string
}

export function useApiKeys(projectId: string) {
  return useQuery({
    queryKey: ['apikeys', projectId],
    queryFn: () =>
      api.get<ApiKey[]>(`/api/admin/projects/${projectId}/api-keys`).then((r) => r.data),
  })
}

export function useCreateApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, name }: { projectId: string; name: string }) =>
      api
        .post<ApiKey>(`/api/admin/projects/${projectId}/api-keys`, { name })
        .then((r) => r.data),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['apikeys', projectId] })
    },
  })
}

export function useRevokeApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, keyId }: { projectId: string; keyId: string }) =>
      api.delete(`/api/admin/projects/${projectId}/api-keys/${keyId}`),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['apikeys', projectId] })
    },
  })
}
