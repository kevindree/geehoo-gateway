import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export interface ProjectUpstreamAuthParams {
  bearer?: { token: string }
  basic?: { username: string; password: string }
  apikey_header?: { headerName: string; key: string }
  apikey_query?: { paramName: string; key: string }
}

export interface ProjectParams {
  upstreamAuth?: ProjectUpstreamAuthParams
}

export interface Project {
  id: string
  workspaceId?: string
  name: string
  slug: string
  status: 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'DELETING' | 'ERROR'
  ingressPrefix: string
  description?: string
  authRequired?: boolean
  params?: ProjectParams
  createdAt: string
  _count?: { routes: number; upstreams: number }
}

const base = (workspaceSlug: string) => `/workspaces/${workspaceSlug}/projects`

export function useProjects(workspaceSlug: string | undefined) {
  return useQuery({
    queryKey: ['projects', workspaceSlug],
    queryFn: () => api.get<{ data: Project[] }>(base(workspaceSlug!)).then((r) => r.data.data),
    enabled: !!workspaceSlug,
  })
}

export function useProject(workspaceSlug: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: ['projects', workspaceSlug, id],
    queryFn: () => api.get<{ data: Project }>(`${base(workspaceSlug!)}/${id}`).then((r) => r.data.data),
    enabled: !!workspaceSlug && !!id,
  })
}

export function useCreateProject(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; slug: string; description?: string }) =>
      api.post<{ data: Project }>(base(workspaceSlug!), data).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', workspaceSlug] }),
  })
}

export function useDeleteProject(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`${base(workspaceSlug!)}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', workspaceSlug] }),
  })
}

export function useUpdateProject(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { authRequired?: boolean; name?: string; description?: string; params?: ProjectParams } }) =>
      api.patch<{ data: Project }>(`${base(workspaceSlug!)}/${id}`, data).then((r) => r.data.data),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['projects', workspaceSlug] })
      qc.setQueryData(['projects', workspaceSlug, updated.id], updated)
    },
  })
}
