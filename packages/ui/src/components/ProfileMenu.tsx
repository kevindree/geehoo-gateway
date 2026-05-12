import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'

export default function ProfileMenu({ onLogout }: { onLogout: () => void }) {
  const { user, refreshMe } = useAuth()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(user?.displayName ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setName(user?.displayName ?? '')
  }, [user?.displayName])

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  if (!user) return null

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Display name cannot be empty')
      return
    }
    setSaving(true)
    try {
      await api.patch('/auth/me', { displayName: trimmed })
      await refreshMe()
      setOpen(false)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message
      setError(msg ?? 'Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  const label = user.displayName || user.email
  const initials = label.split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase() || '?'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-gray-100 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-semibold">
          {initials}
        </span>
        <span className="text-sm text-gray-700 font-medium max-w-[120px] truncate">{label}</span>
        <svg className="w-3 h-3 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-lg z-50 p-4">
          <p className="text-xs text-gray-400 mb-0.5">Signed in as</p>
          <p className="text-sm font-medium text-gray-900 mb-3 truncate">{user.email}</p>

          <form onSubmit={handleSave} className="space-y-2">
            <label className="block text-xs text-gray-500">Display name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Your name"
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-gray-500 px-3 py-1.5 rounded-md hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>

          <div className="mt-3 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => { setOpen(false); onLogout() }}
              className="w-full text-left text-sm text-red-600 hover:text-red-700 px-1 py-0.5 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
