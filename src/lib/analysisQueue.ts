/** Serialize expensive analysis and share duplicate requests for the same song. */
export function createAnalysisQueue() {
  let tail = Promise.resolve()
  const jobs = new Map<string, { cancelled: boolean; running: boolean; promise: Promise<void> }>()
  return {
    enqueue(id: string, run: (cancelled: () => boolean) => Promise<void>) {
      const existing = jobs.get(id)
      if (existing) return existing.promise
      const job = { cancelled: false, running: false, promise: Promise.resolve() }
      job.promise = tail.then(async () => {
        job.running = true
        if (!job.cancelled) await run(() => job.cancelled)
      }).finally(() => { if (jobs.get(id) === job) jobs.delete(id) })
      jobs.set(id, job)
      tail = job.promise.catch(() => undefined)
      return job.promise
    },
    cancel(id: string) {
      const job = jobs.get(id)
      if (job) job.cancelled = true
      jobs.delete(id)
      return job?.running ? job.promise.catch(() => undefined) : Promise.resolve()
    },
    cancelAll() {
      for (const job of jobs.values()) job.cancelled = true
      jobs.clear()
    },
  }
}
