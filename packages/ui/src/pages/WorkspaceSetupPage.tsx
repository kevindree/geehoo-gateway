import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import api from '../lib/api'
import { useAuth } from '../hooks/useAuth'

export default function WorkspaceSetupPage() {
  const navigate = useNavigate()
  const { refreshMe } = useAuth()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Auto-derive slug from name until user edits slug manually
  useEffect(() => {
    if (slugTouched) return
    const derived = name.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
    setSlug(derived)
  }, [name, slugTouched])

  // Debounced slug availability check
  useEffect(() => {
    if (!slug || slug.length < 3) {
      setAvailable(null)
      return
    }
    setChecking(true)
    const timer = setTimeout(async () => {
      try {
        const res = await api.get<{ available: boolean }>('/workspaces/check-slug', { params: { slug } })
        setAvailable(res.data.available)
      } catch {
        setAvailable(null)
      } finally {
        setChecking(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [slug])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post('/workspaces', { name, slug })
      await refreshMe()
      navigate(`/w/${slug}/projects`, { replace: true })
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setError(msg ?? 'Failed to create workspace')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="px-6 py-8 max-w-md mx-auto">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Create a workspace</h1>
      <p className="text-sm text-gray-500 mb-6">
        Your workspace slug is unique across the platform and forms part of your API URLs.
      </p>

      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-6 flex flex-col gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ws-name">Workspace name</label>
          <input id="ws-name" type="text" required value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Acme Inc."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="ws-slug">Workspace slug</label>
          <input id="ws-slug" type="text" required minLength={3} maxLength={32}
            pattern="^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }}
            placeholder="acme"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
          <p className="text-xs text-gray-400 mt-1">
            Lowercase letters, numbers, and hyphens. 3–32 characters.
          </p>
          {slug.length >= 3 && (
            <p className={`text-xs mt-1 ${available === false ? 'text-red-600' : available === true ? 'text-green-600' : 'text-gray-400'}`}>
              {checking ? 'Checking…' : available === true ? `✓ /${slug} is available` : available === false ? `✗ /${slug} is not available` : ''}
            </p>
          )}
        </div>

        <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 font-mono">
          API URL preview: <span className="text-gray-700">/{slug || '«slug»'}/api/«project»/«route»</span>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button type="submit" disabled={submitting || available === false}
            className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {submitting ? 'Creating…' : 'Create workspace'}
          </button>
          <Link to="/workspaces" className="text-sm text-gray-500 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
