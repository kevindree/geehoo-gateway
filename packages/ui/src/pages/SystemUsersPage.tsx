import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'

interface SystemUser {
  id: string
  email: string
  displayName?: string | null
  systemRole: 'SUPER_ADMIN' | 'USER'
  status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED'
  createdAt: string
  _count?: { memberships: number; ownedWorkspaces: number }
}

export default function SystemUsersPage() {
  const { user } = useAuth()
  const qc = useQueryClient()

  const usersQ = useQuery({
    queryKey: ['system-users'],
    queryFn: () => api.get<{ data: SystemUser[] }>('/admin/users').then((r) => r.data.data),
  })

  const updateM = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<SystemUser, 'systemRole' | 'status'>> }) =>
      api.patch(`/admin/users/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['system-users'] }),
  })

  if (user?.systemRole !== 'SUPER_ADMIN') {
    return <div className="p-6 text-red-600">Forbidden — SUPER_ADMIN only.</div>
  }

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">System users</h1>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Email</th>
              <th className="text-left px-4 py-2 font-medium">Role</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Workspaces</th>
              <th className="text-left px-4 py-2 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {usersQ.data?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2">
                  <div>
                    <p className="text-gray-900">{u.email}</p>
                    {u.displayName && <p className="text-xs text-gray-400">{u.displayName}</p>}
                  </div>
                </td>
                <td className="px-4 py-2">
                  <select
                    value={u.systemRole}
                    onChange={(e) => updateM.mutate({ id: u.id, data: { systemRole: e.target.value as 'SUPER_ADMIN' | 'USER' } })}
                    disabled={u.id === user?.id}
                    className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white disabled:opacity-50">
                    <option value="USER">USER</option>
                    <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                  </select>
                </td>
                <td className="px-4 py-2">
                  <select
                    value={u.status}
                    onChange={(e) => updateM.mutate({ id: u.id, data: { status: e.target.value as SystemUser['status'] } })}
                    disabled={u.id === user?.id}
                    className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white disabled:opacity-50">
                    <option value="PENDING_ACTIVATION">PENDING_ACTIVATION</option>
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                  </select>
                </td>
                <td className="px-4 py-2 text-gray-500">
                  {u._count?.memberships ?? 0} ({u._count?.ownedWorkspaces ?? 0} owned)
                </td>
                <td className="px-4 py-2 text-gray-400 text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
