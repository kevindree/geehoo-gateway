import { useEffect, useState } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'

interface Preview {
  email: string
  role: string
  workspaceName: string
  workspaceSlug: string
  inviterEmail: string
  isNewUser: boolean
}

export default function AcceptInvitationPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const { setSession, refreshMe } = useAuth()

  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setError('Missing invitation token')
      setLoading(false)
      return
    }
    api
      .get<{ data: Preview }>('/invitations/preview', { params: { token } })
      .then((res) => setPreview(res.data.data))
      .catch((err) => setError(err?.response?.data?.error?.message ?? 'Invalid invitation'))
      .finally(() => setLoading(false))
  }, [token])

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    try {
      const body: { token: string; password?: string; displayName?: string } = { token }
      if (preview?.isNewUser) {
        body.password = password
        if (displayName) body.displayName = displayName
      }
      const res = await api.post<{
        token: string
        user: { id: string; email: string; displayName?: string | null; systemRole: 'SUPER_ADMIN' | 'USER' }
        workspace: { slug: string; name: string }
      }>('/invitations/accept', body)
      setSession(res.data.token, res.data.user)
      await refreshMe()
      navigate(`/w/${res.data.workspace.slug}/projects`, { replace: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setSubmitError(msg ?? 'Failed to accept invitation')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading invitation…</div>
  }

  if (error || !preview) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
          <h1 className="text-xl font-bold text-red-700 mb-2">Invitation not available</h1>
          <p className="text-sm text-gray-600 mb-4">{error}</p>
          <Link to="/login" className="text-sm text-indigo-600">Back to sign in</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Join workspace</h1>
        <p className="text-sm text-gray-600 mb-1">
          You've been invited to join <span className="font-semibold">{preview.workspaceName}</span> as <span className="font-medium">{preview.role}</span>.
        </p>
        <p className="text-xs text-gray-400 mb-6">
          Invited as <span className="font-medium">{preview.email}</span> by {preview.inviterEmail}
        </p>
        <form onSubmit={handleAccept} className="flex flex-col gap-4">
          {preview.isNewUser && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Display name (optional)</label>
                <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Set a password</label>
                <input type="password" required minLength={12} placeholder="Min 12 characters" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </>
          )}
          {submitError && <p className="text-sm text-red-600">{submitError}</p>}
          <button type="submit" disabled={submitting}
            className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {submitting ? 'Joining…' : 'Accept & join'}
          </button>
        </form>
      </div>
    </div>
  )
}
