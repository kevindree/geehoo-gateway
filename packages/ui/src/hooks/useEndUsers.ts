import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export interface EndUser {
  id: string
  email: string
  createdAt: string
}

export function useEndUsers(projectId: string) {
  return useQuery({
    queryKey: ['end-users', projectId],
    queryFn: () =>
      api.get<{ data: EndUser[] }>(`/admin/projects/${projectId}/end-users`).then((r) => r.data.data),
    enabled: !!projectId,
  })
}

export function useCreateEndUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, email, password }: { projectId: string; email: string; password: string }) =>
      api
        .post<{ data: EndUser }>(`/admin/projects/${projectId}/end-users`, { email, password })
        .then((r) => r.data.data),
    onSuccess: (_data, { projectId }) => qc.invalidateQueries({ queryKey: ['end-users', projectId] }),
  })
}

export function useDeleteEndUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) =>
      api.delete(`/admin/projects/${projectId}/end-users/${userId}`),
    onSuccess: (_data, { projectId }) => qc.invalidateQueries({ queryKey: ['end-users', projectId] }),
  })
}
