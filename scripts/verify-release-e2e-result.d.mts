export interface PlaywrightJsonReport {
  readonly stats: {
    readonly expected: number;
    readonly skipped: number;
    readonly unexpected: number;
    readonly flaky: number;
  };
  readonly errors: readonly unknown[];
}

export function verifyPlaywrightResult(report: PlaywrightJsonReport): {
  readonly passed: 1;
  readonly skipped: 0;
  readonly failed: 0;
};
