const READ_TIMEOUT_MS = 30_000

export function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

export function shouldTimeoutRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = requestMethod(input, init)
  return method === 'GET' || method === 'HEAD'
}

export function readTimeoutMs(): number {
  return READ_TIMEOUT_MS
}
