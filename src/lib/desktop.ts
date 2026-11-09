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

/** The automatic backup settings kept on this device (see electron/data-location.cjs). */
export interface AutoBackupInfo {
  enabled: boolean;
  folder: string | null;
  lastDay: string | null;
  lastPath: string | null;
  lastError: "folder_unreachable" | "failed" | null;
}

/** Where the data lives and how the app was opened (see "Mes données" in Settings). */
export interface DataInfo {
  dataRoot: string;
  dbDir: string;
  defaultRoot: string;
  isCustom: boolean;
  /** Another PC has the data open: this window only reads, and nothing is saved. */
  readOnly: boolean;
  device: string;
  autoBackup: AutoBackupInfo;
  importNotice: { ok: boolean; reason?: string; safetyBackup?: string } | null;
}

export type LocationMode = "move" | "use" | "replace";
export type LocationResult =
  { ok: true; mode: LocationMode; hadData?: boolean } | { ok: false; code: string };

export interface AtlasData {
  info(): Promise<DataInfo>;
  importNotice(): Promise<DataInfo["importNotice"]>;
  chooseSavePath(): Promise<string | null>;
  chooseOpenPath(): Promise<string | null>;
  chooseFolder(title: string): Promise<string | null>;
  previewLocation(
    target: string,
  ): Promise<{ ok: true; hasData: boolean; empty: boolean } | { ok: false; code: string }>;
  applyLocation(target: string, mode: LocationMode): Promise<LocationResult>;
  restart(): Promise<boolean>;
  savePrefs(keys: Record<string, string>): Promise<string | null>;
  setAutoBackup(
    enabled: boolean,
    folder?: string | null,
  ): Promise<{ ok: true; info: DataInfo } | { ok: false; code: string }>;
  runAutoBackup(): Promise<{ ok: boolean; code?: string; path?: string; skipped?: boolean }>;
}

export interface AtlasDesktop {
  getInfo(): Promise<DesktopInfo>;
  openDataFolder(): Promise<string>;
  /** Absent from an older desktop shell. */
  updates?: AtlasUpdates;
  /** Absent from an older desktop shell. */
  data?: AtlasData;
}

declare global {
  interface Window {
    atlasDesktop?: AtlasDesktop;
  }
}

export const desktopBridge = (): AtlasDesktop | null =>
  typeof window === "undefined" ? null : (window.atlasDesktop ?? null);
