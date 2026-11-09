"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
  collectPrefs,
  followJob,
  inspectBackupFile,
  startExportJob,
  startImportJob,
  type BackupCounts,
  type InspectResult,
  type JobView,
} from "@/client/backup";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { desktopBridge, type DataInfo, type LocationMode } from "@/lib/desktop";
import { playSound } from "@/lib/feedback/sound";
import { Row, Toggle, plainButton } from "./settings-parts";

const COUNT_ORDER = [
  "plans",
  "projects",
  "subProjects",
  "tasks",
  "milestones",
  "decisions",
  "risks",
  "notes",
  "documents",
  "budgets",
  "events",
  "others",
  "links",
  "workHistory",
  "preferences",
] as const satisfies readonly (keyof BackupCounts)[];

const itemTotal = (c: BackupCounts) =>
  c.plans +
  c.projects +
  c.subProjects +
  c.tasks +
  c.milestones +
  c.decisions +
  c.risks +
  c.notes +
  c.documents +
  c.budgets +
  c.events +
  c.others;

const primary =
  "h-10 rounded-[12px] bg-fg px-4 text-[13px] font-semibold text-bg transition-transform duration-300 ease-(--ease-spring) hover:-translate-y-px active:scale-[0.96] disabled:opacity-60";
const secondary =
  "h-10 rounded-[12px] border border-border-strong bg-surface px-4 text-[13px] font-medium transition-colors hover:bg-sunk disabled:opacity-60";

/** A determinate progress bar in the style of the app's ring and bars. */
function Progress({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="flex items-center gap-3"
    >
      <span className="block h-2 flex-1 overflow-hidden rounded-full bg-sunk">
        <span
          className="block h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${Math.max(3, Math.min(100, percent))}%` }}
        />
      </span>
      <span className="num w-10 text-right text-[12px] text-fg-muted">{Math.round(percent)} %</span>
    </div>
  );
}

/** A modal in the app's look (like the delete confirmation): a title, some words, the choices. */
function Modal({
  open,
  title,
  onClose,
  children,
  danger = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-[60] bg-bg/80" />
        <Dialog.Content
          role={danger ? "alertdialog" : "dialog"}
          aria-describedby={undefined}
          className="rise-in fixed top-1/2 left-1/2 z-[70] flex max-h-[88vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-card border border-border bg-surface p-6 focus:outline-none"
        >
          <Dialog.Title className="text-lg font-medium">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Choice({
  title,
  hint,
  onClick,
  tone = "normal",
  disabled,
}: {
  title: string;
  hint: string;
  onClick: () => void;
  tone?: "normal" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-1 rounded-[14px] border px-4 py-3 text-left transition-colors duration-200 hover:bg-sunk disabled:opacity-60",
        tone === "danger" ? "border-critical/60" : "border-border-strong",
      )}
    >
      <span className="flex items-center gap-2 text-[13.5px] font-semibold">
        {tone === "danger" && (
          <span aria-hidden="true" className="inline-block size-2 rounded-full bg-critical" />
        )}
        {title}
      </span>
      <span className="text-[12px] text-fg-muted">{hint}</span>
    </button>
  );
}

type ImportStep =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "review"; path: string; inspect: Extract<InspectResult, { ok: true }> }
  | { step: "confirmReplace"; path: string; inspect: Extract<InspectResult, { ok: true }> }
  | { step: "running"; percent: number; mode: "merge" | "replace" }
  | { step: "done"; job: JobView }
  | { step: "error"; code: string };

type LocStep =
  | { step: "idle" }
  | { step: "review"; target: string; hasData: boolean }
  | { step: "working" }
  | { step: "restarting" }
  | { step: "error"; code: string };

/**
 * "Mes données": export everything to one .atlasbackup, import one (merge or replace, always after a
 * safety copy), choose the folder the data lives in, and a daily automatic backup. Desktop only.
 */
export function MyDataCard() {
  const { t, f } = useI18n();
  const queryClient = useQueryClient();
  const data = typeof window === "undefined" ? undefined : desktopBridge()?.data;
  const [info, setInfo] = useState<DataInfo | null>(null);
  const [exp, setExp] = useState<
    | { phase: "idle" }
    | { phase: "running"; percent: number }
    | { phase: "done"; path: string; size: string; items: number }
    | { phase: "error"; code: string }
  >({ phase: "idle" });
  const [imp, setImp] = useState<ImportStep>({ step: "idle" });
  const [loc, setLoc] = useState<LocStep>({ step: "idle" });
  const [auto, setAuto] = useState<{ busy: boolean; note?: string; error?: string }>({
    busy: false,
  });

  const reload = useCallback(async () => {
    if (data) setInfo(await data.info());
  }, [data]);
  useEffect(() => {
    let live = true;
    void data?.info().then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [data]);

  if (!data || !info) return null;
  const ro = info.readOnly;
  const errText = (code: string) =>
    t(
      `md.err.${["not_a_backup", "corrupt", "newer_version", "unreadable_file", "unreadable_database", "read_only"].includes(code) ? code : "failed"}` as MessageKey,
    );
  const size = (bytes: number) =>
    bytes >= 1048576
      ? t("md.mb", { size: (bytes / 1048576).toFixed(1) })
      : t("md.kb", { size: Math.max(1, Math.round(bytes / 1024)).toString() });

  // ---- export ----
  const doExport = async () => {
    const path = await data.chooseSavePath();
    if (!path) return;
    playSound("click");
    setExp({ phase: "running", percent: 0 });
    try {
      await startExportJob(path, collectPrefs());
      const job = await followJob((j) => setExp({ phase: "running", percent: j.percent }));
      if (job.status === "error")
        throw Object.assign(new Error(job.error?.message), { code: job.error?.code });
      playSound("create");
      setExp({
        phase: "done",
        path: job.result?.path ?? path,
        size: size(job.result?.bytes ?? 0),
        items: job.result?.manifest ? itemTotal(job.result.manifest.counts) : 0,
      });
    } catch (e) {
      playSound("error");
      setExp({ phase: "error", code: (e as { code?: string }).code ?? "failed" });
    }
  };

  // ---- import ----
  const pickImport = async () => {
    const path = await data.chooseOpenPath();
    if (!path) return;
    playSound("click");
    setImp({ step: "checking" });
    try {
      const r = await inspectBackupFile(path);
      if (!r.ok) {
        playSound("error");
        setImp({ step: "error", code: r.code });
      } else setImp({ step: "review", path, inspect: r });
    } catch {
      setImp({ step: "error", code: "failed" });
    }
  };
  const runImport = async (path: string, mode: "merge" | "replace") => {
    setImp({ step: "running", percent: 0, mode });
    try {
      await startImportJob(path, mode, collectPrefs());
      const job = await followJob((j) => setImp({ step: "running", percent: j.percent, mode }));
      if (job.status === "error")
        throw Object.assign(new Error(job.error?.message), { code: job.error?.code });
      playSound("create");
      setImp({ step: "done", job });
      if (mode === "merge") await queryClient.invalidateQueries({ queryKey: [] });
      else setTimeout(() => void data.restart(), 1800);
    } catch (e) {
      playSound("error");
      setImp({ step: "error", code: (e as { code?: string }).code ?? "failed" });
    }
  };

  // ---- location ----
  const pickFolder = async (to?: string) => {
    const target = to ?? (await data.chooseFolder(t("md.loc.title")));
    if (!target) return;
    playSound("click");
    const p = await data.previewLocation(target);
    if (!p.ok) {
      playSound("error");
      setLoc({ step: "error", code: p.code });
    } else setLoc({ step: "review", target, hasData: p.hasData });
  };
  const applyLoc = async (target: string, mode: LocationMode) => {
    setLoc({ step: "working" });
    const r = await data.applyLocation(target, mode);
    if (!r.ok) {
      playSound("error");
      setLoc({ step: "error", code: r.code });
    } else {
      playSound("create");
      setLoc({ step: "restarting" });
    }
  };

  // ---- automatic backup ----
  const setAutoBackup = async (enabled: boolean, folder?: string | null) => {
    const r = await data.setAutoBackup(enabled, folder);
    if (!r.ok) {
      playSound("error");
      setAuto({ busy: false, error: `md.auto.err.${r.code}` });
    } else {
      setInfo(r.info);
      setAuto({ busy: false });
    }
  };
  const toggleAuto = async (on: boolean) => {
    if (on && !info.autoBackup.folder) {
      const folder = await data.chooseFolder(t("md.auto.folder"));
      if (!folder) return;
      await setAutoBackup(true, folder);
    } else await setAutoBackup(on);
  };
  const chooseAutoFolder = async () => {
    const folder = await data.chooseFolder(t("md.auto.folder"));
    if (folder) await setAutoBackup(info.autoBackup.enabled, folder);
  };
  const backupNow = async () => {
    setAuto({ busy: true });
    const r = await data.runAutoBackup();
    await reload();
    setAuto(
      r.ok
        ? { busy: false, note: "md.auto.done" }
        : { busy: false, error: `md.auto.err.${r.code ?? "failed"}` },
    );
  };

  const counts = (c: BackupCounts) => (
    <ul className="grid gap-x-6 gap-y-[2px] text-[13px] sm:grid-cols-2">
      {COUNT_ORDER.filter((k) => c[k] > 0).map((k) => (
        <li key={k} className="num text-fg-muted">
          {t(`md.c.${k}` as MessageKey, { count: c[k] })}
        </li>
      ))}
    </ul>
  );
  const when = (iso: string) => f.date(iso.slice(0, 10));

  return (
    <div className="flex flex-col">
      {ro && (
        <p
          role="status"
          className="mb-3 rounded-[12px] bg-sunk px-4 py-3 text-[12.5px] text-fg-muted"
        >
          {t("md.ro.banner")}
        </p>
      )}

      {/* ---- export ---- */}
      <Row title={t("md.export.title")} sub={t("md.export.sub")}>
        <button
          type="button"
          className={primary}
          onClick={() => void doExport()}
          disabled={exp.phase === "running"}
        >
          {exp.phase === "running" ? t("md.export.working") : t("md.export.button")}
        </button>
      </Row>
      {exp.phase === "running" && <Progress percent={exp.percent} label={t("md.progress")} />}
      {exp.phase === "done" && (
        <div
          role="status"
          className="mt-1 mb-2 flex flex-col gap-[2px] rounded-[12px] bg-sunk px-4 py-3 text-[12.5px]"
        >
          <span className="font-semibold">{t("md.export.done")}</span>
          <span className="num break-all text-fg-muted select-all">
            {t("md.export.where", { path: exp.path })}
          </span>
          <span className="text-fg-subtle">
            {t("md.export.size", { size: exp.size, items: exp.items })}
          </span>
        </div>
      )}
      {exp.phase === "error" && (
        <p
          role="alert"
          className="mt-1 mb-2 rounded-[12px] bg-sunk px-4 py-3 text-[12.5px] text-fg-muted"
        >
          {errText(exp.code)}
        </p>
      )}

      {/* ---- import ---- */}
      <Row title={t("md.import.title")} sub={t("md.import.sub")}>
        <button
          type="button"
          className={secondary}
          disabled={ro || imp.step === "checking" || imp.step === "running"}
          onClick={() => void pickImport()}
        >
          {imp.step === "checking" ? t("md.import.checking") : t("md.import.button")}
        </button>
      </Row>
      {imp.step === "running" && <Progress percent={imp.percent} label={t("md.import.working")} />}
      {imp.step === "done" && (
        <div
          role="status"
          className="mt-1 mb-2 flex flex-col gap-[2px] rounded-[12px] bg-sunk px-4 py-3 text-[12.5px]"
        >
          {imp.job.result?.mode === "merge" ? (
            <span className="font-semibold">
              {t("md.import.mergeDone", {
                added: imp.job.result.summary?.itemsAdded ?? 0,
                updated: imp.job.result.summary?.itemsUpdated ?? 0,
                kept: imp.job.result.summary?.itemsKept ?? 0,
              })}
            </span>
          ) : (
            <span className="font-semibold">{t("md.import.replaceDone")}</span>
          )}
          {(imp.job.result?.summary?.skipped ?? 0) > 0 && (
            <span className="text-fg-muted">
              {t("md.import.mergeSkipped", { count: imp.job.result!.summary!.skipped })}
            </span>
          )}
          {imp.job.result?.safetyBackup && (
            <span className="num break-all text-fg-muted select-all">
              {t("md.import.safety", { path: imp.job.result.safetyBackup })}
            </span>
          )}
        </div>
      )}
      {imp.step === "error" && (
        <p
          role="alert"
          className="mt-1 mb-2 rounded-[12px] bg-sunk px-4 py-3 text-[12.5px] text-fg-muted"
        >
          {errText(imp.code)}
        </p>
      )}

      {/* ---- the data folder ---- */}
      <Row title={t("md.loc.title")} sub={t("md.loc.sub")}>
        <span className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={plainButton}
            disabled={ro}
            onClick={() => void pickFolder()}
          >
            {t("md.loc.change")}
          </button>
          {info.isCustom && (
            <button
              type="button"
              className={plainButton}
              disabled={ro}
              onClick={() => void pickFolder(info.defaultRoot)}
            >
              {t("md.loc.back")}
            </button>
          )}
        </span>
      </Row>
      <div className="mb-2 flex flex-col gap-[2px] rounded-[12px] bg-sunk px-4 py-3 text-[13px]">
        <span className="text-fg-muted">
          {info.isCustom ? t("md.loc.current") : t("md.loc.default")}
        </span>
        <span className="num break-all select-all">{info.dataRoot}</span>
      </div>
      {loc.step === "working" && <Progress percent={50} label={t("md.loc.working")} />}
      {loc.step === "restarting" && (
        <p
          role="status"
          className="mb-2 rounded-[12px] bg-sunk px-4 py-3 text-[12.5px] font-semibold"
        >
          {t("md.loc.restarting")}
        </p>
      )}
      {loc.step === "error" && (
        <p
          role="alert"
          className="mb-2 rounded-[12px] bg-sunk px-4 py-3 text-[12.5px] text-fg-muted"
        >
          {t(
            `md.loc.err.${["not_writable", "same", "nested", "not_absolute", "target_has_data", "copy_failed", "read_only"].includes(loc.code) ? loc.code : "failed"}` as MessageKey,
          )}
        </p>
      )}

      {/* ---- the automatic backup ---- */}
      <Row title={t("md.auto.title")} sub={t("md.auto.sub")}>
        <Toggle
          on={info.autoBackup.enabled}
          onChange={(on) => void toggleAuto(on)}
          label={t("md.auto.switch")}
        />
      </Row>
      <div className="flex flex-col gap-2 rounded-[12px] bg-sunk px-4 py-3 text-[13px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex min-w-0 flex-col gap-[2px]">
            <span className="text-fg-muted">{t("md.auto.folder")}</span>
            <span className="num break-all select-all">
              {info.autoBackup.folder ?? t("md.auto.none")}
            </span>
          </span>
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              className={plainButton}
              disabled={ro}
              onClick={() => void chooseAutoFolder()}
            >
              {t("md.auto.choose")}
            </button>
            <button
              type="button"
              className={plainButton}
              disabled={ro || !info.autoBackup.folder || auto.busy}
              onClick={() => void backupNow()}
            >
              {auto.busy ? t("md.auto.running") : t("md.auto.now")}
            </button>
          </span>
        </div>
        <span className="text-[12px] text-fg-muted" role="status">
          {info.autoBackup.lastError
            ? t(`md.auto.err.${info.autoBackup.lastError}` as MessageKey)
            : info.autoBackup.lastPath
              ? t("md.auto.last", { path: info.autoBackup.lastPath })
              : t("md.auto.never")}
        </span>
        {auto.error && (
          <span role="alert" className="text-[12px] text-fg-muted">
            {t(auto.error as MessageKey)}
          </span>
        )}
        {auto.note && (
          <span className="text-[12px] text-fg-muted">{t(auto.note as MessageKey)}</span>
        )}
      </div>

      {/* ---- import: what is in the backup, and how ---- */}
      <Modal
        open={imp.step === "review"}
        title={t("md.import.summary")}
        onClose={() => setImp({ step: "idle" })}
      >
        {imp.step === "review" && (
          <>
            <p className="text-[13px] text-fg-muted">
              {t("md.import.from", {
                date: when(imp.inspect.manifest.exportedAt),
                device: imp.inspect.manifest.device,
                version: imp.inspect.manifest.appVersion,
              })}
            </p>
            <div className="rounded-[12px] bg-sunk px-4 py-3">{counts(imp.inspect.counts)}</div>
            {imp.inspect.migrated && (
              <p className="text-[12.5px] text-fg-muted">{t("md.import.migrated")}</p>
            )}
            <p className="text-[13px] font-semibold">{t("md.import.mode")}</p>
            <Choice
              title={t("md.import.merge")}
              hint={t("md.import.mergeHint")}
              onClick={() => void runImport(imp.path, "merge")}
            />
            <Choice
              title={t("md.import.replace")}
              hint={t("md.import.replaceHint")}
              tone="danger"
              onClick={() =>
                setImp({ step: "confirmReplace", path: imp.path, inspect: imp.inspect })
              }
            />
            <div className="flex justify-end">
              <button type="button" className={secondary} onClick={() => setImp({ step: "idle" })}>
                {t("md.import.cancel")}
              </button>
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={imp.step === "confirmReplace"}
        title={t("md.import.replaceTitle")}
        danger
        onClose={() => setImp({ step: "idle" })}
      >
        {imp.step === "confirmReplace" && (
          <>
            <p className="text-fg-muted">{t("md.import.replaceBody")}</p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                autoFocus
                className={secondary}
                onClick={() => setImp({ step: "idle" })}
              >
                {t("md.import.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void runImport(imp.path, "replace")}
                className="inline-flex h-10 items-center gap-2 rounded-control border border-fg px-4 text-[13px] transition-colors duration-(--duration-hover) hover:bg-hover"
              >
                <span aria-hidden="true" className="inline-block size-2 rounded-full bg-critical" />
                {t("md.import.replaceConfirm")}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ---- location: what to do with the existing data ---- */}
      <Modal
        open={loc.step === "review"}
        title={t("md.loc.dialogTitle")}
        onClose={() => setLoc({ step: "idle" })}
      >
        {loc.step === "review" && (
          <>
            <p className="num text-[12.5px] break-all text-fg-muted">
              {t("md.loc.target", { path: loc.target })}
            </p>
            <p className="text-[13px]">{loc.hasData ? t("md.loc.hasData") : t("md.loc.empty")}</p>
            {loc.hasData ? (
              <>
                <Choice
                  title={t("md.loc.use")}
                  hint={t("md.loc.useHint")}
                  onClick={() => void applyLoc(loc.target, "use")}
                />
                <Choice
                  title={t("md.loc.replace")}
                  hint={t("md.loc.replaceHint")}
                  tone="danger"
                  onClick={() => void applyLoc(loc.target, "replace")}
                />
              </>
            ) : (
              <>
                <Choice
                  title={t("md.loc.move")}
                  hint={t("md.loc.moveHint")}
                  onClick={() => void applyLoc(loc.target, "move")}
                />
                <Choice
                  title={t("md.loc.useEmpty")}
                  hint={t("md.loc.useEmptyHint")}
                  onClick={() => void applyLoc(loc.target, "use")}
                />
              </>
            )}
            <div className="flex justify-end">
              <button type="button" className={secondary} onClick={() => setLoc({ step: "idle" })}>
                {t("md.loc.cancel")}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
