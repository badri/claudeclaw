import { STATE_FILE } from "./paths";

// Write state.json so the statusline script can read fresh data
export interface StateData {
  heartbeat?: { nextAt: number };
  jobs: { name: string; nextAt: number }[];
  security: string;
  telegram: boolean;
  startedAt: number;
  web?: { enabled: boolean; host: string; port: number };
}

export async function writeState(state: StateData) {
  await Bun.write(STATE_FILE, JSON.stringify(state) + "\n");
}
