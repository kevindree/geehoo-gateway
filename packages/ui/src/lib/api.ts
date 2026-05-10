import axios from 'axios'

const TOKEN_KEY = 'gh_token'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const path = window.location.pathname
      const publicPaths = ['/login', '/register', '/activate', '/forgot-password', '/reset-password', '/invitations/accept']
      if (!publicPaths.some((p) => path.startsWith(p))) {
        localStorage.removeItem(TOKEN_KEY)
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  },
)

export default api
