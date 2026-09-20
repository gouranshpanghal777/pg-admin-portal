/** One logical submission. Only use replay with a server-idempotent write. */
export function confirmedSubmission<Input, Result>() {
  let inFlight: Promise<void> | undefined
  let submitted: string | undefined
  let confirmed = false
  let result: Result
  return {
    run(input: Input, write: (input: Input) => Promise<Result>, reconcile: (result: Result) => Promise<void>): Promise<void> {
      if (inFlight) return inFlight
      const fingerprint = JSON.stringify(input)
      if (submitted !== undefined && submitted !== fingerprint) {
        return Promise.reject(new Error('An earlier submission is unresolved. Restore its original values and retry before starting another transaction.'))
      }
      submitted = fingerprint
      // Defer execution until inFlight is assigned, including for synchronous failures.
      inFlight = Promise.resolve().then(async () => {
        if (!confirmed) {
          result = await write(input)
          confirmed = true
        }
        // A refresh failure must never repeat a confirmed write.
        await reconcile(result)
      }).finally(() => { inFlight = undefined })
      return inFlight
    },
    get confirmed() { return confirmed },
  }
}
