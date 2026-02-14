import type { Settings } from "../config";
import type { Job } from "../jobs";

export interface WebSnapshot {
  pid: number;
  startedAt: number;
  heartbeatNextAt: number;
  settings: Settings;
  jobs: Job[];
}

export interface WebServerHandle {
  stop: () => void;
  host: string;
  port: number;
}

export interface StartWebUiOptions {
  host: string;
  port: number;
  getSnapshot: () => WebSnapshot;
  onHeartbeatEnabledChanged?: (enabled: boolean) => void | Promise<void>;
}
