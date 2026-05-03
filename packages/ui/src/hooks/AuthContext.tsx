import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import api from '../lib/api'

interface AuthContextValue {
  token: string | null
  login: (username: string, password: string) => Promise<{ token: string; role: string; username: string }>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('admin_token'))

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.post<{ token: string; role: string; username: string }>('/auth/login', {
      username,
      password,
    })
    localStorage.setItem('admin_token', res.data.token)
    setToken(res.data.token)
    return res.data
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('admin_token')
    setToken(null)
  }, [])

  return (
    <AuthContext.Provider value={{ token, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
