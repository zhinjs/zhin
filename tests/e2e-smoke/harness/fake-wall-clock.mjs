// Plugins such as reminders and RSS read `Date.now()` directly. The smoke scenarios run in their own
// child process, so pointing `Date.now` at the testing kit's FakeClock is safe and fully deterministic.

/** @param {{ now(): number }} clock @returns {() => void} restores the real clock */
export function useFakeWallClock(clock) {
  const realNow = Date.now;
  Date.now = () => clock.now();
  return () => {
    Date.now = realNow;
  };
}
