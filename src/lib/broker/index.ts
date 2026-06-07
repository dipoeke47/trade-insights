// Provider selection: demo-by-default (BYOC).
// With no credentials present, everyone sees the DemoProvider. When Robinhood
// OAuth credentials are configured (Phase 2), getProvider() returns the real
// RobinhoodProvider instead — the dashboard code never changes.

import type { BrokerProvider } from "./types";
import { DemoProvider } from "./demo";

export function hasRobinhoodCredentials(): boolean {
  return Boolean(
    process.env.ROBINHOOD_ACCESS_TOKEN || process.env.ROBINHOOD_REFRESH_TOKEN,
  );
}

export function getProvider(): BrokerProvider {
  // Phase 2: if (hasRobinhoodCredentials()) return new RobinhoodProvider(...)
  return new DemoProvider();
}

export * from "./types";
