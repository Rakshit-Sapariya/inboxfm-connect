import React, { createContext, useContext, useEffect, useState } from 'react'
import { apiClient } from '../api/client'
import { Project, User } from '../api/types'
import { navigateToLogin } from './auth-navigation'

interface AuthContextType {
  user: User | null
  currentProject: Project | null
  projects: Project[]
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  signIn: (token: string, user: User, projectId?: string) => void
  signOut: () => void
  setCurrentProject: (project: Project) => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => apiClient.getToken())
  const [user, setUser] = useState<User | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [currentProject, setCurrentProjectState] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const setCurrentProject = (project: Project) => {
    setCurrentProjectState(project)
    apiClient.setProjectId(project.id)
  }

  const signIn = (newToken: string, newUser: User, projectId?: string) => {
    apiClient.setToken(newToken)
    setToken(newToken)
    setUser(newUser)
    persistUser(newUser)
    if (projectId) {
      apiClient.setProjectId(projectId)
      const proj = projects.find((p) => p.id === projectId) || {
        id: projectId,
        displayName: 'Default Project',
        platformId: newUser.platformId ?? 'default',
      }
      setCurrentProjectState(proj)
    }
  }

  const resetAuthState = () => {
    apiClient.setToken(null)
    apiClient.setProjectId(null)
    clearPersistedUser()
    setToken(null)
    setUser(null)
    setProjects([])
    setCurrentProjectState(null)
  }

  const signOut = () => {
    resetAuthState()
    navigateToLogin()
  }

  useEffect(() => {
    const handleUnauthorized = () => {
      resetAuthState()
    }

    apiClient.setOnUnauthorized(handleUnauthorized)
    return () => {
      apiClient.setOnUnauthorized(null)
    }
  }, [])

  useEffect(() => {
    async function loadSession() {
      const storedToken = apiClient.getToken()
      if (!storedToken) {
        // In browser dev mode, automatically sign into the seeded dev account
        // so the developer console is immediately usable without manual sign-in
        if (import.meta.env.DEV && import.meta.env.MODE !== 'test') {
          try {
            const res = await apiClient.post<{
              id: string
              email: string
              firstName: string
              lastName: string
              platformRole?: string
              token: string
              projectId: string
            }>('/authentication/sign-in', {
              email: 'dev@ap.com',
              password: '12345678',
            })
            const { token: devToken, projectId: devProjectId, ...devUser } = res
            signIn(devToken, devUser, devProjectId)
            try {
              const projectsData = await apiClient.get<{ data: Project[] }>('/projects')
              if (projectsData?.data?.length) {
                setProjects(projectsData.data)
                const matched = projectsData.data.find((p) => p.id === devProjectId) || projectsData.data[0]
                if (matched) setCurrentProject(matched)
              }
            } catch {
              // Ignore projects fetch error in dev fallback
            }
            setIsLoading(false)
            return
          } catch {
            // Auto-login failed, fall through to unauthenticated state
          }
        }

        setUser(null)
        setProjects([])
        setCurrentProjectState(null)
        setIsLoading(false)
        return
      }

      try {
        const persistedUser = readPersistedUser()
        if (persistedUser) {
          setUser(persistedUser)
        }

        const projectsData = await apiClient.get<{ data: Project[] }>('/projects')
        const loadedProjects = projectsData.data || []
        setProjects(loadedProjects)

        const storedProjectId = apiClient.getProjectId()
        const matched = loadedProjects.find((p) => p.id === storedProjectId) || loadedProjects[0]
        if (matched) {
          setCurrentProject(matched)
        }

        if (!persistedUser) {
          setUser({
            id: 'session',
            email: '',
            firstName: '',
            lastName: '',
          })
        }
      } catch (err) {
        console.warn('Session load failed, clearing session', err)
        signOut()
      } finally {
        setIsLoading(false)
      }
    }

    void loadSession()
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        currentProject,
        projects,
        token,
        isAuthenticated: Boolean(user && token),
        isLoading,
        signIn,
        signOut,
        setCurrentProject,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

const PERSISTED_USER_KEY = 'ap-user'

function persistUser(user: User): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(PERSISTED_USER_KEY, JSON.stringify(user))
}

function readPersistedUser(): User | null {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(PERSISTED_USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

function clearPersistedUser(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(PERSISTED_USER_KEY)
}
