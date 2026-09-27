import { navigateToLogin } from '../auth/auth-navigation'

export class ApiClientError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly message: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

interface RequestOptions extends RequestInit {
  params?: Record<string, unknown>
}

class ApiClient {
  private baseUrl = '/api/v1'
  private token: string | null = null
  private projectId: string | null = null
  private isRedirectingToLogin = false

  constructor() {
    if (typeof localStorage !== 'undefined') {
      this.token = localStorage.getItem('ap-token')
      this.projectId = localStorage.getItem('ap-project-id')
    }
  }

  resetRedirectState(): void {
    this.isRedirectingToLogin = false
  }

  handleUnauthorized(): void {
    if (this.isRedirectingToLogin) {
      return
    }

    const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
    if (currentPath.startsWith('/login')) {
      return
    }

    this.isRedirectingToLogin = true
    this.setToken(null)
    this.setProjectId(null)
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ap-user')
    }

    try {
      navigateToLogin()
    } finally {
      setTimeout(() => {
        this.isRedirectingToLogin = false
      }, 100)
    }
  }

  setToken(token: string | null) {
    this.token = token
    if (typeof localStorage !== 'undefined') {
      if (token) {
        localStorage.setItem('ap-token', token)
      } else {
        localStorage.removeItem('ap-token')
      }
    }
  }

  getToken(): string | null {
    return this.token
  }

  setProjectId(projectId: string | null) {
    this.projectId = projectId
    if (typeof localStorage !== 'undefined') {
      if (projectId) {
        localStorage.setItem('ap-project-id', projectId)
      } else {
        localStorage.removeItem('ap-project-id')
      }
    }
  }

  getProjectId(): string | null {
    return this.projectId
  }

  private buildUrl(path: string, params?: RequestOptions['params']): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
    const url = new URL(`${this.baseUrl}${cleanPath}`, baseOrigin)

    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          if (Array.isArray(val)) {
            val.forEach((item) => url.searchParams.append(key, String(item)))
          } else {
            url.searchParams.append(key, String(val))
          }
        }
      })
    }

    return url.toString()
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { params, headers: customHeaders, ...restOptions } = options

    const headers = new Headers(customHeaders)
    headers.set('Content-Type', 'application/json')
    headers.set('Accept', 'application/json')

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`)
    }

    if (this.projectId) {
      headers.set('x-project-id', this.projectId)
    }

    const url = this.buildUrl(path, params)

    const response = await fetch(url, {
      ...restOptions,
      headers,
    })

    if (response.status === 204) {
      return undefined as T
    }

    let responseData: unknown = null
    const contentType = response.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      try {
        responseData = await response.json()
      } catch {
        responseData = null
      }
    } else {
      responseData = await response.text()
    }

    if (!response.ok) {
      if (response.status === 401 && !path.includes('/authentication/sign-in')) {
        this.handleUnauthorized()
      }
      const errorMessage =
        (responseData as { message?: string })?.message ||
        `Request failed with status ${response.status}`
      throw new ApiClientError(response.status, errorMessage, responseData)
    }

    return responseData as T
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' })
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' })
  }
}

export const apiClient = new ApiClient()
