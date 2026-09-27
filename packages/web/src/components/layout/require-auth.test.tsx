import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation, type Location } from 'react-router-dom'
import { RequireAuth } from './require-auth'
import { mount } from '@/test/test-utils'

const mockUseAuth = vi.fn()

vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => mockUseAuth(),
}))

describe('RequireAuth', () => {
  it('renders loading state while session restore is in progress (isLoading = true)', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    })

    const container = mount(
      <MemoryRouter initialEntries={['/dashboard']}>
        <RequireAuth>
          <div>Protected Content</div>
        </RequireAuth>
      </MemoryRouter>
    )

    expect(container.querySelector('[data-testid="auth-loading"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Protected Content')
  })

  it('redirects unauthenticated user to /login preserving return location', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    })

    let capturedLocation: Location | null = null

    function LoginProbe() {
      capturedLocation = useLocation()
      return <div>Login Page</div>
    }

    const container = mount(
      <MemoryRouter initialEntries={['/connections']}>
        <Routes>
          <Route
            path="/connections"
            element={
              <RequireAuth>
                <div>Protected Content</div>
              </RequireAuth>
            }
          />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    )

    expect(container.textContent).toContain('Login Page')
    expect(container.textContent).not.toContain('Protected Content')
    expect(capturedLocation).not.toBeNull()
    const probeLocation = capturedLocation as unknown as {
      pathname: string
      state: { from?: { pathname: string } } | null
    }
    expect(probeLocation.pathname).toBe('/login')
    expect(probeLocation.state?.from?.pathname).toBe('/connections')
  })

  it('renders children when user is authenticated', () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    })

    const container = mount(
      <MemoryRouter initialEntries={['/dashboard']}>
        <RequireAuth>
          <div>Protected Content</div>
        </RequireAuth>
      </MemoryRouter>
    )

    expect(container.textContent).toContain('Protected Content')
  })
})
