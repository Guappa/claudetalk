// A fixed seed: a case that fails does so on every run and every machine, and never first on a pull request that changed nothing near it.
export const SAME_CASES_EVERY_RUN = { seed: 4711, numRuns: 1000 };
