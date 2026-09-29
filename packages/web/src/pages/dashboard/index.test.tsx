import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import DashboardPage from './index'
import { apiClient } from '@/lib/api/client'
import { AuthProvider } from '@/lib/auth/auth-context'
import { ThemeProvider } from '@/lib/theme/theme-provider'
import { stubApi } from '@/test/api-stub'
import { seekPage } from '@/test/fixtures/integrations'
import { createTestQueryClient, mount, waitFor } from '@/test/test-utils'

const PROJECT = {
  id: 'proj_dash',
  displayName: 'Dash Project',
  platformId: 'plat_1',
}

const EXECUTIONS = '/api/v1/executions'
const CONNECTIONS = '/api/v1/connections'
const INTEGRATIONS = '/api/v1/integrations'
const TRIGGER_BINDINGS = '/api/v1/trigger-bindings'
const SCHEDULED_TASKS = '/api/v1/scheduled-tasks'

function signIn(): void {
  apiClient.setToken('test-token')
  apiClient.setProjectId(PROJECT.id)
  localStorage.setItem(
    'ap-user',
    JSON.stringify({ id: 'user_1', email: 'a@b.c', firstName: 'Ada', lastName: 'A' })
  )
}

function renderDashboard(): HTMLElement {
  return mount(
    <QueryClientProvider client={createTestQueryClient()}>
      <ThemeProvider defaultTheme="light">
        <AuthProvider>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

/**
 * Every dashboard query answers 500, which is the outage the issue is about:
 * the five hooks reject, and the page must not present the result as real data.
 */
function stubAllFailing(): void {
  const fail = (pathname: string) => ({
    match: (url: URL) => url.pathname === pathname,
    respond: () => ({ status: 500, body: { message: 'upstream unavailable' } }),
  })
  stubApi([
    fail(EXECUTIONS),
    fail(CONNECTIONS),
    fail(INTEGRATIONS),
    fail(TRIGGER_BINDINGS),
    fail(SCHEDULED_TASKS),
    { match: () => true, respond: () => ({ status: 200, body: { data: [] } }) },
  ])
}

function stubAllHealthy(): void {
  stubApi([
    {
      match: (url: URL) => url.pathname === EXECUTIONS,
      respond: () => ({ status: 200, body: seekPage([]) }),
    },
    {
      match: (url: URL) => url.pathname === CONNECTIONS,
      respond: () => ({
        status: 200,
        body: seekPage([{ id: 'conn_1', displayName: 'GitHub', pieceName: 'github', status: 'ACTIVE' }]),
      }),
    },
    {
      match: (url: URL) => url.pathname === INTEGRATIONS,
      respond: () => ({ status: 200, body: seekPage([{ name: 'github', actions: {} }]) }),
    },
    {
      match: (url: URL) => url.pathname === TRIGGER_BINDINGS,
      respond: () => ({ status: 200, body: seekPage([]) }),
    },
    {
      match: (url: URL) => url.pathname === SCHEDULED_TASKS,
      respond: () => ({ status: 200, body: seekPage([]) }),
    },
    { match: () => true, respond: () => ({ status: 200, body: { data: [] } }) },
  ])
}

describe('Dashboard query error states (Issue #172)', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
    signIn()
  })

  afterEach(() => {
    apiClient.setProjectId(null)
  })

  it('never presents a zeroed metric when the query failed', async () => {
    stubAllFailing()
    const container = renderDashboard()

    // The executions section is the reference implementation: on failure it
    // must show its error state, not "No executions recorded yet".
    await waitFor(() => container.textContent?.includes('Unable to load recent executions') === true, 6000)

    const text = container.textContent || ''

    // The empty state is only truthful when the request actually succeeded.
    expect(text).not.toContain('No executions recorded yet')

    // Each of the four metric queries gets its own inline error affordance.
    const retryButtons = Array.from(container.querySelectorAll('button')).filter((button) =>
      button.textContent?.trim() === 'Retry'
    )
    expect(retryButtons.length).toBe(4)
  }, 20000)

  it('surfaces a retry action for each failing metric query', async () => {
    stubAllFailing()
    const container = renderDashboard()

    await waitFor(() => {
      const retries = Array.from(container.querySelectorAll('button')).filter(
        (button) => button.textContent?.trim() === 'Retry'
      )
      return retries.length === 4
    }, 8000)

    // The metric cards are labelled, so assert each one reports its own failure
    // rather than a single shared banner.
    const text = container.textContent || ''
    for (const label of ['Available Tools', 'Active Connections', 'Trigger Bindings', 'Scheduled Tasks']) {
      expect(text).toContain(label)
    }
  }, 20000)

  it('still renders real counts once every query succeeds', async () => {
    stubAllHealthy()
    const container = renderDashboard()

    await waitFor(() => container.textContent?.includes('Across 1 integrations') === true, 6000)

    const text = container.textContent || ''
    expect(text).toContain('Across 1 integrations')
    expect(text).toContain('1 total credentials')
    // No error affordances on the happy path.
    const retryButtons = Array.from(container.querySelectorAll('button')).filter(
      (button) => button.textContent?.trim() === 'Retry'
    )
    expect(retryButtons).toHaveLength(0)
  }, 20000)
})
