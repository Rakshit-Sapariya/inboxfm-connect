import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LoginPage from './login'
import { apiClient } from '@/lib/api/client'
import { mount, waitFor } from '@/test/test-utils'

const mockSignIn = vi.fn()

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({
    signIn: mockSignIn,
    user: null,
    isAuthenticated: false,
    isLoading: false,
  }),
}))

describe('LoginPage return URL handling (#173)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockSignIn.mockClear()
  })

  it('redirects to return URL specified in router location state upon successful sign-in', async () => {
    function Destinations() {
      return (
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/automations/triggers"
            element={
              <div>
                <h1>Triggers Page</h1>
              </div>
            }
          />
        </Routes>
      )
    }

    vi.spyOn(apiClient, 'post').mockResolvedValue({
      id: 'usr_1',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      token: 'jwt_123',
      projectId: 'prj_123',
    })

    const container = mount(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/login',
            state: { from: { pathname: '/automations/triggers' } },
          },
        ]}
      >
        <Destinations />
      </MemoryRouter>
    )

    const devButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('dev@ap.com')
    )
    expect(devButton).toBeDefined()

    await act(async () => {
      devButton?.click()
    })

    await waitFor(() => container.textContent?.includes('Triggers Page') === true)
    expect(container.textContent).toContain('Triggers Page')
    expect(mockSignIn).toHaveBeenCalledWith('jwt_123', expect.any(Object), 'prj_123')
  })

  it('redirects to returnUrl search parameter if router state.from is not provided', async () => {
    function Destinations() {
      return (
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/settings"
            element={
              <div>
                <h1>Settings Page</h1>
              </div>
            }
          />
        </Routes>
      )
    }

    vi.spyOn(apiClient, 'post').mockResolvedValue({
      id: 'usr_1',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      token: 'jwt_123',
      projectId: 'prj_123',
    })

    const container = mount(
      <MemoryRouter initialEntries={['/login?returnUrl=%2Fsettings']}>
        <Destinations />
      </MemoryRouter>
    )

    const devButton = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('dev@ap.com')
    )
    expect(devButton).toBeDefined()

    await act(async () => {
      devButton?.click()
    })

    await waitFor(() => container.textContent?.includes('Settings Page') === true)
    expect(container.textContent).toContain('Settings Page')
  })
})
