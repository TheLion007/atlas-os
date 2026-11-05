"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { Mascot } from "@/design/Mascot";
import { cn } from "@/lib/cn";
import { useFeedback } from "@/lib/feedback/celebrate";
import { usePrefs } from "@/lib/feedback/prefs";
import { Icon } from "../ui/Icon";
import { ObjectChip, type ChipObject } from "../ui/ObjectChip";

/** An answer is prose interleaved with object chips, so every claim points at an object. */
export type Segment = string | ChipObject;

export type ThreadMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      segments: readonly Segment[];
      citations: readonly ChipObject[];
    }
  | { id: string; role: "refusal"; text: string };

export type ThreadStatus = "idle" | "thinking";

interface AIThreadProps {
  messages: readonly ThreadMessage[];
  status?: ThreadStatus;
  /** When absent, the assistant is not connected: the composer is disabled and says why. */
  onAsk?: (question: string) => void;
  onPeek?: (id: string) => void;
  hrefFor?: (id: string) => string;
  className?: string;
}

/**
 * The assistant thread. Its one rule is grounding: an answer renders object chips inline and
 * names its sources; an answer with no cited object is not shown as an answer at all, it is
 * shown as a refusal. States: idle · thinking · cited-answer · no-grounding.
 */
export function AIThread({
  messages,
  status = "idle",
  onAsk,
  onPeek,
  hrefFor,
  className,
}: AIThreadProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const connected = onAsk !== undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q || !onAsk || status === "thinking") return;
    onAsk(q);
    setDraft("");
  };

  return (
    <div className={cn("flex min-h-0 grow flex-col", className)} data-state={status}>
      <div
        className="grow overflow-y-auto p-4"
        role="log"
        aria-label={t("assistant.conversation")}
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col gap-3" data-state={connected ? "idle" : "no-grounding"}>
            <p className="text-base font-medium">
              {connected ? t("assistant.headingConnected") : t("assistant.headingOffline")}
            </p>
            <p className="text-fg-muted">{t("assistant.body")}</p>
            {!connected && <p className="text-fg-muted">{t("assistant.offlineNote")}</p>}
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((m) => (
              <li key={m.id}>
                {m.role === "user" ? (
                  <p className="ml-6 rounded-card border border-border px-3 py-2">{m.text}</p>
                ) : m.role === "refusal" || m.citations.length === 0 ? (
                  <p
                    className="rounded-card border border-dashed border-border px-3 py-2 text-fg-muted"
                    data-state="no-grounding"
                  >
                    {m.role === "refusal" ? m.text : t("assistant.refusal")}
                  </p>
                ) : (
                  <div className="flex flex-col gap-3" data-state="cited-answer">
                    <p className="leading-loose">
                      {m.segments.map((seg, i) =>
                        typeof seg === "string" ? (
                          <span key={i}>{seg}</span>
                        ) : (
                          <span key={i} className="mx-1 inline-block align-middle">
                            <ObjectChip object={seg} onPeek={onPeek} href={hrefFor?.(seg.id)} />
                          </span>
                        ),
                      )}
                    </p>
                    <div className="flex flex-col gap-2 border-t border-border pt-3">
                      <p className="label">{t("assistant.sources")}</p>
                      <ul className="flex flex-wrap gap-2">
                        {m.citations.map((c) => (
                          <li key={c.id}>
                            <ObjectChip object={c} onPeek={onPeek} href={hrefFor?.(c.id)} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {status === "thinking" && (
          <p role="status" className="mt-4 text-fg-muted" data-state="thinking">
            {t("assistant.thinking")}
          </p>
        )}
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-border p-4">
        <label htmlFor="assistant-input" className="sr-only">
          {t("assistant.ask")}
        </label>
        <input
          id="assistant-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!connected}
          placeholder={
            connected ? t("assistant.askPlaceholder") : t("assistant.placeholderOffline")
          }
          className="h-10 min-w-0 grow rounded-control border border-border bg-transparent px-3 placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!connected || status === "thinking" || draft.trim() === ""}
          aria-label={t("assistant.send")}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-control border border-border transition-colors duration-(--duration-hover) hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="arrowUp" />
        </button>
      </form>
    </div>
  );
}

interface AssistantSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

/** The assistant as a right-hand sheet over the current lens (⌘J), dressed as in the design. */
export function AssistantSheet({ open, onOpenChange, children }: AssistantSheetProps) {
  const { t } = useI18n();
  const kind = usePrefs((s) => s.mascot);
  const stored = useFeedback((s) => s.mood);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fade-in fixed inset-0 z-40 backdrop-blur-[3px]"
          style={{ background: "rgb(20 16 12 / 0.22)" }}
        />
        <Dialog.Content
          aria-describedby={undefined}
          className="sheet-right fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-border-strong bg-bg shadow-pop focus:outline-none"
        >
          <div className="flex shrink-0 items-center gap-3 px-5 pt-5">
            <Mascot
              kind={kind}
              mood={stored === "sleep" ? "idle" : stored}
              size={44}
              track={false}
            />
            <div className="min-w-0 flex-1">
              <Dialog.Title className="font-display text-[19px] leading-tight font-bold">
                {t("assistant.title")}
              </Dialog.Title>
              <p className="text-[12.5px] text-fg-muted">{t("assistant.sub")}</p>
            </div>
            <Dialog.Close
              aria-label={t("assistant.close")}
              className="inline-flex size-8 items-center justify-center rounded-[10px] border border-border-strong bg-surface text-fg-muted transition-colors duration-(--duration-hover) hover:bg-sunk hover:text-fg"
            >
              <Icon name="close" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
