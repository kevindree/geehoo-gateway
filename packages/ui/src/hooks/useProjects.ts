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

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ data: Project[] }>('/admin/projects').then((r) => r.data.data),
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: ['projects', id],
    queryFn: () => api.get<{ data: Project }>(`/admin/projects/${id}`).then((r) => r.data.data),
    enabled: !!id,
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; slug: string; description?: string }) =>
      api.post<{ data: Project }>('/admin/projects', data).then((r) => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/projects/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useUpdateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { authRequired?: boolean; name?: string; description?: string; params?: ProjectParams } }) =>
      api.patch<{ data: Project }>(`/admin/projects/${id}`, data).then((r) => r.data.data),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.setQueryData(['projects', updated.id], updated)
    },
  })
}
