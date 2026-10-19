let tail: Promise<unknown> = Promise.resolve();

/**
 * Runs `fn` after every previously queued task settles. All read-modify-write
 * cycles on storage go through here so concurrent events can't clobber each other.
 */
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
}
