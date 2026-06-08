// Provider selection: demo-by-default (BYOC).
// With nothing configured, everyone sees the DemoProvider. When a local
// Robinhood snapshot (.rh-snapshot.local.json) is present, getProvider() returns
// the real RobinhoodProvider instead — the dashboard code never changes.
// Live OAuth (env tokens) is the next transport behind the same provider.

import type { BrokerProvider } from "./types";
import { DemoProvider } from "./demo";
import { RobinhoodProvider, loadSnapshot } from "./robinhood";

export function hasRobinhoodCredentials(): boolean {
  return Boolean(
    process.env.ROBINHOOD_ACCESS_TOKEN || process.env.ROBINHOOD_REFRESH_TOKEN,
  );
}

export function getProvider(): BrokerProvider {
  // Real data today: read the local snapshot if it exists.
  const snapshot = loadSnapshot();
  if (snapshot) return new RobinhoodProvider(snapshot);

  // Next: if (hasRobinhoodCredentials()) return new RobinhoodProvider(liveMcp(...))
  return new DemoProvider();
}

export * from "./types";
