import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'

export default function ActivatePage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const navigate = useNavigate()
  const { setSession } = useAuth()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setError('Missing activation token')
      return
    }
    api
      .post<{ token: string; user: { id: string; email: string; displayName?: string | null; systemRole: 'SUPER_ADMIN' | 'USER' } }>(
        '/auth/activate',
        { token },
      )
      .then((res) => {
        setSession(res.data.token, res.data.user)
        setStatus('success')
        setTimeout(() => navigate('/workspaces/new', { replace: true }), 1200)
      })
      .catch((err) => {
        const msg = err?.response?.data?.error?.message ?? 'Activation failed'
        setError(msg)
        setStatus('error')
      })
  }, [token, navigate, setSession])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        {status === 'loading' && <p className="text-gray-600">Activating your account…</p>}
        {status === 'success' && (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Account activated</h1>
            <p className="text-sm text-gray-500">Redirecting to workspace setup…</p>
          </>
        )}
        {status === 'error' && (
          <>
            <h1 className="text-xl font-bold text-red-700 mb-2">Activation failed</h1>
            <p className="text-sm text-gray-600 mb-4">{error}</p>
            <Link to="/login" className="text-sm text-indigo-600 hover:text-indigo-800">Back to sign in</Link>
          </>
        )}
      </div>
    </div>
  )
}
