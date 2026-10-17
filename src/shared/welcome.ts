export type WelcomeDecision = 'show' | 'hide' | 'mark-done';

/**
 * Whether the first-run welcome should be on screen. It waits until the folder list has loaded,
 * and only greets a library with no folders: someone who already has folders (an existing install
 * that has just updated) is marked done without ever seeing it.
 */
export function welcomeDecision(done: boolean, rootsLoaded: boolean, rootCount: number): WelcomeDecision {
  if (done || !rootsLoaded) return 'hide';
  return rootCount > 0 ? 'mark-done' : 'show';
}
