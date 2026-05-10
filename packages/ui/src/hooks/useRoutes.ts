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

const base = (ws: string, pid: string) => `/workspaces/${ws}/projects/${pid}/routes`

export function useRoutes(workspaceSlug: string | undefined, projectId: string | undefined) {
  return useQuery({
    queryKey: ['routes', workspaceSlug, projectId],
    queryFn: () => api.get<{ data: Route[] }>(base(workspaceSlug!, projectId!)).then((r) => r.data.data),
    enabled: !!workspaceSlug && !!projectId,
  })
}

export function useRoute(workspaceSlug: string | undefined, projectId: string | undefined, routeId: string) {
  return useQuery({
    queryKey: ['routes', workspaceSlug, projectId, routeId],
    queryFn: () =>
      api.get<{ data: Route }>(`${base(workspaceSlug!, projectId!)}/${routeId}`).then((r) => r.data.data),
    enabled: !!workspaceSlug && !!projectId && !!routeId,
  })
}

export function useCreateRoute(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: Omit<Route, 'id' | 'projectId' | 'createdAt'> }) =>
      api.post<{ data: Route }>(base(workspaceSlug!, projectId), data).then((r) => r.data.data),
    onSuccess: (_data, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['routes', workspaceSlug, projectId] }),
  })
}

export function useUpdateRoute(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, routeId, data }: { projectId: string; routeId: string; data: Partial<Route> }) =>
      api.put<{ data: Route }>(`${base(workspaceSlug!, projectId)}/${routeId}`, data).then((r) => r.data.data),
    onSuccess: (_data, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['routes', workspaceSlug, projectId] }),
  })
}

export function useDeleteRoute(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, routeId }: { projectId: string; routeId: string }) =>
      api.delete(`${base(workspaceSlug!, projectId)}/${routeId}`),
    onSuccess: (_data, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['routes', workspaceSlug, projectId] }),
  })
}

export function useReorderRoutes(workspaceSlug: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, ids }: { projectId: string; ids: string[] }) =>
      api.patch(`${base(workspaceSlug!, projectId)}/reorder`, { ids }),
    onSuccess: (_data, { projectId }) =>
      qc.invalidateQueries({ queryKey: ['routes', workspaceSlug, projectId] }),
  })
}
