import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'

interface Member {
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  joinedAt: string
  user: { id: string; email: string; displayName?: string | null }
}

interface Invitation {
  id: string
  email: string
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
  expiresAt: string
  createdAt: string
}

export default function WorkspaceMembersPage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>()
  const { user } = useAuth()
  const qc = useQueryClient()

  const membersQ = useQuery({
    queryKey: ['members', workspaceSlug],
    queryFn: () =>
      api.get<{ data: Member[] }>(`/workspaces/${workspaceSlug}/members`).then((r) => r.data.data),
    enabled: !!workspaceSlug,
  })

  const invitesQ = useQuery({
    queryKey: ['invitations', workspaceSlug],
    queryFn: () =>
      api.get<{ data: Invitation[] }>(`/workspaces/${workspaceSlug}/invitations`).then((r) => r.data.data),
    enabled: !!workspaceSlug,
    retry: false,
  })

  const myRole = membersQ.data?.find((m) => m.user.id === user?.id)?.role
  const canManage = myRole === 'OWNER' || myRole === 'ADMIN' || user?.systemRole === 'SUPER_ADMIN'

  const inviteM = useMutation({
    mutationFn: (data: { email: string; role: 'ADMIN' | 'MEMBER' }) =>
      api.post(`/workspaces/${workspaceSlug}/invitations`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations', workspaceSlug] }),
  })

  const revokeM = useMutation({
    mutationFn: (id: string) => api.delete(`/workspaces/${workspaceSlug}/invitations/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations', workspaceSlug] }),
  })

  const removeM = useMutation({
    mutationFn: (userId: string) => api.delete(`/workspaces/${workspaceSlug}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', workspaceSlug] }),
  })

  const updateRoleM = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' }) =>
      api.patch(`/workspaces/${workspaceSlug}/members/${userId}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', workspaceSlug] }),
  })

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER')
  const [inviteError, setInviteError] = useState<string | null>(null)

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviteError(null)
    try {
      await inviteM.mutateAsync({ email: inviteEmail, role: inviteRole })
      setInviteEmail('')
      setInviteRole('MEMBER')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setInviteError(msg ?? 'Failed to send invitation')
    }
  }

  return (
    <div className="px-6 py-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Workspace members</h1>

      {canManage && (
        <div className="mb-8 bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="font-medium text-gray-900 mb-3">Invite member</h2>
          <form onSubmit={handleInvite} className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Role</label>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'ADMIN' | 'MEMBER')}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                <option value="MEMBER">Member</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <button type="submit" disabled={inviteM.isPending}
              className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {inviteM.isPending ? 'Sending…' : 'Send invitation'}
            </button>
          </form>
          {inviteError && <p className="text-sm text-red-600 mt-2">{inviteError}</p>}
        </div>
      )}

      <h2 className="font-medium text-gray-700 mb-3">Members</h2>
      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 mb-8">
        {membersQ.isLoading && <p className="p-4 text-gray-400 text-sm">Loading…</p>}
        {membersQ.data?.map((m) => {
          // Who can be modified by the current user?
          // - SUPER_ADMIN / OWNER: can modify anyone except themselves
          // - ADMIN: can only modify MEMBERs (not OWNERs / other ADMINs)
          // - MEMBER: read-only
          const isSelf = m.user.id === user?.id
          const canModifyTarget =
            !isSelf &&
            (user?.systemRole === 'SUPER_ADMIN' ||
              myRole === 'OWNER' ||
              (myRole === 'ADMIN' && m.role === 'MEMBER'))
          return (
            <div key={m.user.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium text-gray-900">{m.user.displayName || m.user.email}</p>
                <p className="text-xs text-gray-400">{m.user.email}</p>
              </div>
              <div className="flex items-center gap-3">
                {canModifyTarget ? (
                  <select
                    value={m.role}
                    onChange={(e) =>
                      updateRoleM.mutate({ userId: m.user.id, role: e.target.value as 'OWNER' | 'ADMIN' | 'MEMBER' })
                    }
                    className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white"
                  >
                    {/* Always show the current role so it renders correctly even
                        when promotion to that role isn't allowed (e.g. OWNER) */}
                    {myRole === 'OWNER' || user?.systemRole === 'SUPER_ADMIN' ? (
                      <option value="OWNER">OWNER</option>
                    ) : m.role === 'OWNER' ? (
                      <option value="OWNER" disabled>
                        OWNER
                      </option>
                    ) : null}
                    <option value="ADMIN">ADMIN</option>
                    <option value="MEMBER">MEMBER</option>
                  </select>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700 font-medium">{m.role}</span>
                )}
                {canModifyTarget && (
                  <button
                    onClick={() => {
                      if (confirm(`Remove ${m.user.email}?`)) removeM.mutate(m.user.id)
                    }}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {canManage && (
        <>
          <h2 className="font-medium text-gray-700 mb-3">Pending invitations</h2>
          <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
            {invitesQ.isLoading && <p className="p-4 text-gray-400 text-sm">Loading…</p>}
            {invitesQ.data?.length === 0 && <p className="p-4 text-gray-400 text-sm">No pending invitations.</p>}
            {invitesQ.data?.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm text-gray-900">{inv.email}</p>
                  <p className="text-xs text-gray-400">
                    {inv.role} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <button onClick={() => revokeM.mutate(inv.id)}
                  className="text-xs text-red-500 hover:text-red-700">Revoke</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
