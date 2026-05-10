import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'
import api from '../lib/api'

export interface UserInfo {
  id: string
  email: string
  displayName?: string | null
  systemRole: 'SUPER_ADMIN' | 'USER'
}

export interface WorkspaceMembershipInfo {
  role: 'OWNER' | 'ADMIN' | 'MEMBER'
  joinedAt: string
  workspace: { id: string; slug: string; name: string; status: string }
}

interface AuthContextValue {
  token: string | null
  user: UserInfo | null
  memberships: WorkspaceMembershipInfo[]
  loadingMe: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refreshMe: () => Promise<void>
  setSession: (token: string, user: UserInfo) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const TOKEN_KEY = 'gh_token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<UserInfo | null>(null)
  const [memberships, setMemberships] = useState<WorkspaceMembershipInfo[]>([])
  const [loadingMe, setLoadingMe] = useState<boolean>(!!token)

  const refreshMe = useCallback(async () => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setUser(null)
      setMemberships([])
      setLoadingMe(false)
      return
    }
    try {
      setLoadingMe(true)
      const res = await api.get<{ data: UserInfo & { memberships: WorkspaceMembershipInfo[] } }>('/auth/me')
      const { memberships: m, ...u } = res.data.data
      setUser(u)
      setMemberships(m ?? [])
    } catch {
      setUser(null)
      setMemberships([])
    } finally {
      setLoadingMe(false)
    }
  }, [])

  useEffect(() => {
    if (token) refreshMe()
  }, [token, refreshMe])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: UserInfo }>('/auth/login', { email, password })
    localStorage.setItem(TOKEN_KEY, res.data.token)
    setToken(res.data.token)
    setUser(res.data.user)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setUser(null)
    setMemberships([])
  }, [])

  const setSession = useCallback((newToken: string, newUser: UserInfo) => {
    localStorage.setItem(TOKEN_KEY, newToken)
    setToken(newToken)
    setUser(newUser)
  }, [])

  return (
    <AuthContext.Provider value={{ token, user, memberships, loadingMe, login, logout, refreshMe, setSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
