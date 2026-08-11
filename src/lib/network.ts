export type NetworkErrorLike = {
  name?: string
  message?: string
  code?: string
  details?: string
  hint?: string
}

type RequestResult<T, E extends NetworkErrorLike> = {
  data: T
  error: E | null
}

const TRANSIENT_NETWORK_ERROR = /failed to fetch|fetch failed|load failed|network\s*error|network request failed|aborterror|abort(?:ed)?|signal is aborted|time(?:d)?\s*out/i

export function isTransientNetworkError(error: NetworkErrorLike): boolean {
  if (error.code) return false
  const detail = [error.name, error.message, error.details, error.hint].filter(Boolean).join(' | ')
  return TRANSIENT_NETWORK_ERROR.test(detail)
}

export async function retryIdempotentRequest<T, E extends NetworkErrorLike>(
  request: () => PromiseLike<RequestResult<T, E>>,
  options: { maxAttempts?: number; retryDelayMs?: (failedAttempt: number) => number } = {},
): Promise<RequestResult<T, E>> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3)
  const retryDelayMs = options.retryDelayMs ?? ((failedAttempt: number) => 400 * failedAttempt)
  let response = await request()

  for (let attempt = 1; response.error && isTransientNetworkError(response.error) && attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)))
    response = await request()
  }

  return response
}
