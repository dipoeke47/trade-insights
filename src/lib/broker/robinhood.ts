// RobinhoodProvider — serves your REAL Robinhood data.
//
// Today it reads a local, git-ignored snapshot (`.rh-snapshot.local.json`)
// captured from Robinhood's official agent MCP. The snapshot already matches the
// dashboard's domain shape, so swapping in a live MCP transport later is a drop-in
// replacement behind this same class — the UI never changes.
//
// The file holds real personal financial data and is matched by `*.local.json`
// in .gitignore. It must never be committed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AccountSummary,
  BrokerProvider,
  DashboardData,
  DailyTrades,
  Order,
  PnlPoint,
  Portfolio,
  Position,
  RealizedEvent,
  Transaction,
} from "./types";

const SNAPSHOT_PATH = join(process.cwd(), ".rh-snapshot.local.json");

interface SnapshotAccount {
  id: string;
  name: string;
  type: "individual" | "agentic";
  currency: string;
  portfolio: Portfolio;
  positions: Position[];
  orders: Order[];
  pnlSeries: PnlPoint[];
  dailyTrades: DailyTrades[];
  /** Full executed/attempted transaction history (stock + option legs). */
  transactions?: Transaction[];
  /** Full realized-P&L event history. */
  realizedEvents?: RealizedEvent[];
}

interface Snapshot {
  generatedAt: string;
  accounts: SnapshotAccount[];
}

/** Read + parse the snapshot, or return null if it isn't present. */
export function loadSnapshot(): Snapshot | null {
  try {
    return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
  } catch {
    return null;
  }
}

export class RobinhoodProvider implements BrokerProvider {
  readonly source = "robinhood" as const;
  private readonly snapshot: Snapshot;

  constructor(snapshot: Snapshot) {
    if (!snapshot.accounts.length) {
      throw new Error("Robinhood snapshot contains no accounts");
    }
    this.snapshot = snapshot;
  }

  async listAccounts(): Promise<AccountSummary[]> {
    return this.snapshot.accounts.map(({ id, name, type }) => ({ id, name, type }));
  }

  async getDashboard(accountId?: string): Promise<DashboardData> {
    const accounts = this.snapshot.accounts;
    const acct =
      (accountId && accounts.find((a) => a.id === accountId)) || accounts[0];

    return {
      source: this.source,
      generatedAt: this.snapshot.generatedAt,
      account: {
        id: acct.id,
        name: acct.name,
        type: acct.type,
        currency: acct.currency,
      },
      portfolio: acct.portfolio,
      positions: acct.positions,
      orders: acct.orders,
      pnlSeries: acct.pnlSeries,
      dailyTrades: acct.dailyTrades,
      transactions: acct.transactions,
      realizedEvents: acct.realizedEvents,
    };
  }
}
