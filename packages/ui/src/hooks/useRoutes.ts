import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

export interface Route {
  id: string
  projectId: string
  name: string
  path: string
  method: string
  public: boolean
  enabled: boolean
  description?: string
  authConfig?: unknown
  rateLimitConfig?: { windowMs: number; max: number }
  orchestrationFlow: {
    nodes: Array<{ id: string; type: string; config: Record<string, unknown>; position?: { x: number; y: number } }>
    edges: Array<{ id: string; source: string; target: string; label?: string }>
  }
  createdAt: string
}

export function useRoutes(projectId: string) {
  return useQuery({
    queryKey: ['routes', projectId],
    queryFn: () =>
      api.get<{ data: Route[] }>(`/admin/projects/${projectId}/routes`).then((r) => r.data.data),
    enabled: !!projectId,
  })
}

export function useRoute(projectId: string, routeId: string) {
  return useQuery({
    queryKey: ['routes', projectId, routeId],
    queryFn: () =>
      api
        .get<{ data: Route }>(`/admin/projects/${projectId}/routes/${routeId}`)
        .then((r) => r.data.data),
    enabled: !!projectId && !!routeId,
  })
}

export function useCreateRoute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: Omit<Route, 'id' | 'projectId' | 'createdAt'> }) =>
      api.post<{ data: Route }>(`/admin/projects/${projectId}/routes`, data).then((r) => r.data.data),
    onSuccess: (_data, { projectId }) => qc.invalidateQueries({ queryKey: ['routes', projectId] }),
  })
}

export function useUpdateRoute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, routeId, data }: { projectId: string; routeId: string; data: Partial<Route> }) =>
      api
        .put<{ data: Route }>(`/admin/projects/${projectId}/routes/${routeId}`, data)
        .then((r) => r.data.data),
    onSuccess: (_data, { projectId }) => qc.invalidateQueries({ queryKey: ['routes', projectId] }),
  })
}

export function useDeleteRoute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, routeId }: { projectId: string; routeId: string }) =>
      api.delete(`/admin/projects/${projectId}/routes/${routeId}`),
    onSuccess: (_data, { projectId }) => qc.invalidateQueries({ queryKey: ['routes', projectId] }),
  })
}

export function useReorderRoutes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, ids }: { projectId: string; ids: string[] }) =>
      api.patch(`/admin/projects/${projectId}/routes/reorder`, { ids }),
    onSuccess: (_data, { projectId }) => qc.invalidateQueries({ queryKey: ['routes', projectId] }),
  })
}
