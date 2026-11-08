export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${timeoutMs} ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
