/** What the desktop app tells the page about itself (see electron/preload.cjs). Absent on the web. */
export interface DesktopInfo {
  version: string;
  platform: string;
  /** The folder where everything the app keeps lives (the user's AppData folder on Windows). */
  dataDir: string;
  /** The database folder inside it (documents are stored in it too). */
  databaseDir: string;
  packaged: boolean;
}

/** Why an update step failed, as the desktop app reports it (the page words it in plain language). */
export type UpdateErrorCode = "offline" | "not_found" | "interrupted" | "corrupt" | "failed";

/** Where the update machinery stands (see electron/updater.cjs). */
export interface UpdateState {
  current: string;
  /** False when the app is not installed (development): there is nothing to update. */
  supported: boolean;
  /** Whether the automatic check (at launch, then every few hours) is on. */
  auto: boolean;
  status: "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready" | "error";
  latest: string | null;
  percent: number;
  error: UpdateErrorCode | null;
  errorWhile: "check" | "download" | null;
  checkedAt: string | null;
}

export interface AtlasUpdates {
  state(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<UpdateState>;
  setAuto(on: boolean): Promise<UpdateState>;
  /** Subscribes to changes; returns the function that stops listening. */
  onState(callback: (state: UpdateState) => void): () => void;
}

export interface AtlasDesktop {
  getInfo(): Promise<DesktopInfo>;
  openDataFolder(): Promise<string>;
  /** Absent from an older desktop shell. */
  updates?: AtlasUpdates;
}

declare global {
  interface Window {
    atlasDesktop?: AtlasDesktop;
  }
}

export const desktopBridge = (): AtlasDesktop | null =>
  typeof window === "undefined" ? null : (window.atlasDesktop ?? null);
