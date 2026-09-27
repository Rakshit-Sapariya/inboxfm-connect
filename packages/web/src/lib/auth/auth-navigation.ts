export type NavigationHandler = (
  path: string,
  options?: { replace?: boolean; state?: unknown }
) => void

let navigateHandler: NavigationHandler | null = null

export function setAuthNavigator(handler: NavigationHandler | null): void {
  navigateHandler = handler
}

export function getAuthNavigator(): NavigationHandler | null {
  return navigateHandler
}

export function navigateToLogin(options?: {
  returnUrl?: string
  replace?: boolean
  state?: unknown
}): void {
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
  if (currentPath.startsWith('/login')) {
    return
  }

  const returnUrl =
    options?.returnUrl ??
    (typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : '')

  const search =
    returnUrl && returnUrl !== '/'
      ? `?returnUrl=${encodeURIComponent(returnUrl)}`
      : ''

  const target = `/login${search}`
  const navOptions = {
    replace: options?.replace ?? true,
    state:
      options?.state ??
      (returnUrl ? { from: { pathname: returnUrl } } : undefined),
  }

  if (navigateHandler) {
    navigateHandler(target, navOptions)
    return
  }

  if (typeof window !== 'undefined') {
    const isJsDom =
      typeof navigator !== 'undefined' &&
      navigator.userAgent &&
      navigator.userAgent.includes('jsdom')

    if (isJsDom) {
      try {
        window.history.pushState(navOptions.state, '', target)
      } catch {
        // ignore in mock environments
      }
      return
    }

    try {
      if (typeof window.location.assign === 'function') {
        window.location.assign(target)
      } else {
        window.location.href = target
      }
    } catch {
      // In non-browser or stubbed test environments, ignore assign errors
    }
  }
}
