import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, ApiClientError } from './client'
import { setAuthNavigator } from '../auth/auth-navigation'

describe('ApiClient', () => {
  const mockNavigator = vi.fn()

  beforeEach(() => {
    localStorage.clear()
    apiClient.setToken(null)
    apiClient.setProjectId(null)
    apiClient.resetRedirectState()
    mockNavigator.mockClear()
    setAuthNavigator(mockNavigator)
    vi.restoreAllMocks()
    window.history.pushState({}, '', '/dashboard')
  })

  it('should initialize with null token and project', () => {
    expect(apiClient.getToken()).toBeNull()
    expect(apiClient.getProjectId()).toBeNull()
  })

  it('should store and retrieve auth token and project id', () => {
    apiClient.setToken('test_token_123')
    apiClient.setProjectId('proj_abc')

    expect(apiClient.getToken()).toBe('test_token_123')
    expect(apiClient.getProjectId()).toBe('proj_abc')
    expect(localStorage.getItem('ap-token')).toBe('test_token_123')
    expect(localStorage.getItem('ap-project-id')).toBe('proj_abc')
  })

  it('should throw ApiClientError on non-200 responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ message: 'Resource not found' }),
    })

    await expect(apiClient.get('/test')).rejects.toThrow(ApiClientError)
  })

  it('should return parsed JSON data on 200 responses', async () => {
    const mockData = { id: '123', status: 'ACTIVE' }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockData,
    })

    const result = await apiClient.get('/test')
    expect(result).toEqual(mockData)
  })

  describe('401 Unauthorized handling (#173)', () => {
    it('redirects to /login and clears stored auth state on 401 response', async () => {
      apiClient.setToken('expired_token')
      apiClient.setProjectId('proj_123')
      localStorage.setItem('ap-user', JSON.stringify({ email: 'test@ap.com' }))

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Token expired' }),
      })

      await expect(apiClient.get('/projects')).rejects.toThrow(ApiClientError)

      expect(apiClient.getToken()).toBeNull()
      expect(apiClient.getProjectId()).toBeNull()
      expect(localStorage.getItem('ap-user')).toBeNull()
      expect(mockNavigator).toHaveBeenCalledTimes(1)
      expect(mockNavigator).toHaveBeenCalledWith(
        expect.stringContaining('/login'),
        expect.objectContaining({ replace: true })
      )
    })

    it('notifies onUnauthorized listener when 401 response is handled', async () => {
      const mockUnauthorizedListener = vi.fn()
      apiClient.setOnUnauthorized(mockUnauthorizedListener)

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Session revoked' }),
      })

      await expect(apiClient.get('/projects')).rejects.toThrow(ApiClientError)

      expect(mockUnauthorizedListener).toHaveBeenCalledTimes(1)
      apiClient.setOnUnauthorized(null)
    })

    it('does not trigger redirect on 401 from sign-in endpoint (invalid credentials)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Invalid credentials' }),
      })

      await expect(
        apiClient.post('/authentication/sign-in', { email: 'bad@ap.com', password: 'wrong' })
      ).rejects.toThrow(ApiClientError)

      expect(mockNavigator).not.toHaveBeenCalled()
    })

    it('handles concurrent 401 responses and triggers navigation exactly once without loops', async () => {
      apiClient.setToken('expired_token')

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Unauthorized' }),
      })

      const requests = [
        apiClient.get('/projects').catch(() => null),
        apiClient.get('/connections').catch(() => null),
        apiClient.get('/executions').catch(() => null),
      ]

      await Promise.all(requests)

      expect(mockNavigator).toHaveBeenCalledTimes(1)
    })

    it('does not trigger redirect if already on /login', async () => {
      window.history.pushState({}, '', '/login')

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'Unauthorized' }),
      })

      await expect(apiClient.get('/some-route')).rejects.toThrow(ApiClientError)

      expect(mockNavigator).not.toHaveBeenCalled()
    })
  })
})
