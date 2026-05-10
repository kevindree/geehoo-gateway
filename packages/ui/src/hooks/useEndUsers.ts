import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export interface EndUser {
  id: string
  email: string
  createdAt: string
}

const base = (ws: string, pid: string) => `/workspaces/${ws}/projects/${pid}/end-users`

export function useEndUsers(workspaceSlug: string | undefined, projectId: string | undefined) {
  return useQuery({
    queryKey: ['end-users', workspaceSlug, projectId],
    queryFn: () => api.get<{ data: EndUser[] }>(base(workspaceSlug!, projectId!)).then((r) => r.data.data),
    enabled: !!workspaceSlug && !!projectId,
  })
}

export function useCreateEndUser(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, email, password }: { projectId: string; email: string; password: string }) =>
      api.post<{ data: EndUser }>(base(workspaceSlug!, projectId), { email, password }).then((r) => r.data.data),
    onSuccess: (_data, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['end-users', workspaceSlug, projectId] }),
  })
}

export function useDeleteEndUser(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, userId }: { projectId: string; userId: string }) =>
      api.delete(`${base(workspaceSlug!, projectId)}/${userId}`),
    onSuccess: (_data, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['end-users', workspaceSlug, projectId] }),
  })
}
