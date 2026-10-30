/** Ports for the e2e stack, separate from `pnpm dev` (4000 / 3000 / 3001). */
const apiPort = 4010;
const customerPort = 3010;
const consolePort = 3011;

export const E2E = {
  apiPort,
  customerPort,
  consolePort,
  api: `http://localhost:${apiPort}`,
  customer: `http://localhost:${customerPort}`,
  console: `http://localhost:${consolePort}`,
} as const;
