"use client";

import { useRef } from "react";
import { useObjectDeletion } from "@/client/deletion";
import { describeWriteError, useImportDocuments } from "@/client/hooks";
import type { ApiObject } from "@/domain/api-types";
import { childTypesFor, isConvertible, isCreatable, quickChildren } from "@/domain/creation";
import { MAX_FILE_BYTES } from "@/domain/documents";
import { useI18n } from "@/i18n/I18nProvider";
import { usePeek } from "@/lib/url-state";
import { Icon } from "../ui/Icon";
import { useUi } from "./ui-store";

const chip =
  "inline-flex h-8 items-center gap-2 rounded-control border border-border px-3 text-sm transition-colors duration-(--duration-hover) hover:bg-hover";

/** A file picker that imports each chosen file as a real Document (bytes and all), related to
 *  this object — the same import path the Documents collection page uses, just one click away
 *  from a project/sub-project/plan instead of buried behind that separate page. */
function AddDocumentButton({ object }: { object: Pick<ApiObject, "id" | "type"> }) {
  const { t } = useI18n();
  const importer = useImportDocuments();
  const pushToast = useUi((s) => s.pushToast);
  const [, setPeek] = usePeek();
  const input = useRef<HTMLInputElement>(null);

  const choose = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = [...files];
    const tooBig = list.filter((f) => f.size > MAX_FILE_BYTES);
    const ok = list.filter((f) => f.size <= MAX_FILE_BYTES);
    for (const f of tooBig) pushToast(t("documents.import.tooBig", { name: f.name }));
    if (ok.length === 0) return;
    const results = await importer.mutateAsync({ files: ok, projectId: object.id });
    const done = results.filter((r) => r.id);
    const bad = results.filter((r) => r.error);
    for (const r of bad) pushToast(`${r.name}: ${describeWriteError(r.error, t)}`);
    if (done.length > 0) {
      pushToast(t("documents.import.done", { count: done.length }));
      if (done.length === 1 && done[0]?.id) setPeek(done[0].id);
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void choose(e.target.files);
          e.target.value = "";
        }}
      />
      <button type="button" className={chip} onClick={() => input.current?.click()}>
        <Icon name="upload" />
        {t("create.add.document")}
      </button>
    </>
  );
}

interface ObjectActionsProps {
  object: ApiObject;
}

/**
 * What a person can do to an object from where they are looking at it: add the things that
 * belong inside it (each is related to it automatically), edit it, delete it (the deletion flow, with its confirmation and undo, is in DeleteHost). It lives beside
 * the read-only view so the view itself stays free of the data layer.
 */
export function ObjectActions({ object }: ObjectActionsProps) {
  const { t } = useI18n();
  const openCreate = useUi((s) => s.openCreate);
  const openEdit = useUi((s) => s.openEdit);
  const deletion = useObjectDeletion();

  const parent = { id: object.id, type: object.type, title: object.title };
  const quick = quickChildren(object.type);
  const hasMore = childTypesFor(object.type).length > quick.length;
  const editable = isCreatable(object.type);

  return (
    <div className="flex flex-col gap-3" data-part="object-actions">
      {(quick.length > 0 || hasMore || isConvertible(object.type)) && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("obj.build")}>
          {quick.map((type) => (
            <button
              key={type}
              type="button"
              className={chip}
              onClick={() => openCreate({ type, parent })}
            >
              <Icon name="plus" />
              {t(`create.add.${type}`)}
            </button>
          ))}
          {isConvertible(object.type) && <AddDocumentButton object={object} />}
          {hasMore && (
            <button type="button" className={chip} onClick={() => openCreate({ parent })}>
              {t("create.more")}
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <button type="button" className={chip} onClick={() => openEdit(object)}>
            {t("edit.button")}
          </button>
        )}
        <button type="button" className={chip} onClick={() => void deletion.request(object.id)}>
          {t("common.delete")}
        </button>
      </div>
    </div>
  );
}
