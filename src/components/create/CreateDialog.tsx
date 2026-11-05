"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  describeWriteError,
  useConvertObjectType,
  useCreateObject,
  useDeleteObject,
  useGraph,
  useUpdateObject,
} from "@/client/hooks";
import type { ApiObject } from "@/domain/api-types";
import {
  CONVERTIBLE_TYPES,
  CREATABLE_TYPES,
  childTypesFor,
  isConvertible,
  relationForChild,
  type ConvertibleType,
  type CreatableType,
} from "@/domain/creation";
import { isEdgeAllowed } from "@/domain/edge-rules";
import { useI18n } from "@/i18n/I18nProvider";
import { usePeek } from "@/lib/url-state";
import { hrefKeepingState } from "../shell/nav";
import { useUi, type CreateRequest } from "../shell/ui-store";
import { Icon } from "../ui/Icon";
import { TypeGlyph } from "../ui/TypeGlyph";
import {
  buildObject,
  initialValues,
  parseTags,
  valuesFromObject,
  type FormErrors,
  type FormValues,
} from "./form-spec";
import { control, NEW_PLACE, NEW_PLACE_FIELD, ObjectForm } from "./ObjectForm";

const button =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[12px] border px-4 text-[14px] font-medium transition-[background-color,transform] duration-(--duration-hover) active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60";
const primary = `${button} border-fg bg-fg text-bg hover:bg-fg-muted hover:border-fg-muted`;
const secondary = `${button} border-border-strong bg-surface hover:bg-sunk`;

function TypePicker({
  types,
  onPick,
}: {
  types: readonly CreatableType[];
  onPick: (type: CreatableType) => void;
}) {
  const { t } = useI18n();
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {types.map((type) => (
        <li key={type}>
          <button
            type="button"
            onClick={() => onPick(type)}
            className="flex h-full w-full items-start gap-3 rounded-[14px] border border-border bg-surface p-3 text-left transition-[background-color,transform] duration-(--duration-hover) hover:-translate-y-px hover:bg-sunk"
          >
            <TypeGlyph type={type} className="mt-1" />
            <span className="flex min-w-0 flex-col gap-1">
              <span>{t(`type.${type}`)}</span>
              <span className="text-xs text-fg-muted">{t(`create.hint.${type}`)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface FormBodyProps {
  request: CreateRequest;
  type: CreatableType;
  onClose: () => void;
  onChangeType?: () => void;
}

/** The create form for one type: validation, the write, the automatic relations, the follow-up. */
function CreateForm({ request, type, onClose, onChangeType }: FormBodyProps) {
  const { t } = useI18n();
  const graph = useGraph();
  const create = useCreateObject();
  const remove = useDeleteObject();
  const nodes = useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const params = useSearchParams();
  const [, setPeek] = usePeek();
  const pushToast = useUi((s) => s.pushToast);

  const [values, setValues] = useState<FormValues>(() =>
    initialValues(type, { parent: request.parent, coords: request.coords, preset: request.preset }),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = (id: string) => nodes.find((n) => n.id === id);
  const parent = request.parent ?? null;
  const rel = parent ? relationForChild(parent.type, type) : null;
  const pickedParent = values.relations.parent ? lookup(values.relations.parent) : undefined;
  const becomesSub =
    type === "project" &&
    (pickedParent?.type === "project" || pickedParent?.type === "sub_project");

  const submit = async () => {
    if (busy) return;
    setFailure(null);
    const built = buildObject(type, values, lookup);
    // A new place needs a name; it is created first, then related.
    const wantsNewPlace = values.relations.location === NEW_PLACE;
    const placeName = (values.fields[NEW_PLACE_FIELD] ?? "").trim();
    const errs: FormErrors = { ...built.errors };
    if (wantsNewPlace && placeName === "") errs.location = "form.error.required";
    if (!built.ok || !built.input || Object.keys(errs).length > 0) {
      setErrors(errs);
      if (errs.form) setFailure(t(errs.form));
      return;
    }
    setErrors({});
    setBusy(true);
    let place: ApiObject | null = null;
    try {
      const relations = [...(built.relations ?? [])];
      if (wantsNewPlace) {
        place = await create.mutateAsync({
          input: {
            type: "location",
            title: placeName,
            status: "active",
            tags: [],
            confidence: null,
            details: { level: "city" },
          },
        });
        relations.push({ kind: "located_at", direction: "out", other: place.id });
      }
      const created = await create.mutateAsync({ input: built.input, relations });
      pushToast(t("create.created", { title: created.title }), {
        label: t("common.open"),
        href: hrefKeepingState(`/objects/${created.id}`, params),
      });
      setPeek(created.id);
      onClose();
    } catch (e) {
      // Do not leave an orphaned place behind if the object itself was refused.
      if (place) await remove.mutateAsync(place.id).catch(() => undefined);
      setFailure(describeWriteError(e, t));
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex min-h-0 grow flex-col"
    >
      <div className="flex grow flex-col gap-4 overflow-y-auto px-6 py-4">
        {parent && rel && (
          <p className="rounded-control border border-border px-3 py-2 text-xs text-fg-muted">
            {t("create.autoRelation", {
              verb: t(`verb.${rel.kind}.${rel.direction}`).toLowerCase(),
              parent: parent.title,
            })}
          </p>
        )}
        <ObjectForm
          type={type}
          values={values}
          onChange={setValues}
          errors={errors}
          nodes={nodes}
          onSubmit={() => void submit()}
        />
        {becomesSub && <p className="text-xs text-fg-muted">{t("create.becomesSub")}</p>}
        {failure && (
          <p role="alert" className="flex items-center gap-2 text-fg">
            <span
              aria-hidden="true"
              className="inline-block size-2 shrink-0 rounded-full bg-critical"
            />
            {failure}
          </p>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-panel px-6 py-4">
        {onChangeType ? (
          <button type="button" onClick={onChangeType} className={secondary}>
            {t("create.changeType")}
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className={secondary}>
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={busy} className={primary}>
            {busy ? t("create.submitting") : t("create.submit")}
          </button>
        </div>
      </div>
    </form>
  );
}

function EditForm({ node, onClose }: { node: ApiObject; onClose: () => void }) {
  const { t, typeLabel } = useI18n();
  const graph = useGraph();
  const nodes = useMemo(() => graph.data?.nodes ?? [], [graph.data]);
  const update = useUpdateObject();
  const convertType = useConvertObjectType();
  const pushToast = useUi((s) => s.pushToast);
  const [, setPeek] = usePeek();
  const [values, setValues] = useState<FormValues>(() => valuesFromObject(node));
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const type = node.type as CreatableType;

  // "Change category" (project/sub_project/plan only): a distinct operation from Save, since
  // `type` is immutable — converting creates a new object and archives this one (see
  // useConvertObjectType). `category` is the pending pick; null means "unchanged".
  const [category, setCategory] = useState<ConvertibleType | null>(null);
  const [converting, setConverting] = useState(false);
  const preview = useMemo(() => {
    if (!category || category === node.type) return null;
    const edges = graph.data?.edges ?? [];
    const byId = new Map((graph.data?.nodes ?? []).map((n) => [n.id, n]));
    let droppedRelations = 0;
    for (const e of edges) {
      if (e.from !== node.id && e.to !== node.id) continue;
      const fromType = e.from === node.id ? category : byId.get(e.from)?.type;
      const toType = e.to === node.id ? category : byId.get(e.to)?.type;
      if (!fromType || !toType || !isEdgeAllowed(e.kind, fromType, toType)) droppedRelations++;
    }
    const sameTable =
      (node.type === "project" || node.type === "sub_project") &&
      (category === "project" || category === "sub_project");
    let droppedFields = 0;
    const d = node.details ?? {};
    if (sameTable) {
      if (category === "sub_project" && d.budgetAmount !== null && d.budgetAmount !== undefined)
        droppedFields = 2; // budgetAmount + budgetCurrency
    } else {
      droppedFields = Object.keys(d).filter((k) => k !== "description").length;
    }
    return { droppedRelations, droppedFields };
  }, [category, graph.data, node]);

  const submitConvert = async () => {
    if (!category || converting) return;
    setFailure(null);
    setConverting(true);
    try {
      const result = await convertType.mutateAsync({ id: node.id, type: category });
      pushToast(t("edit.converted", { type: typeLabel(category), title: result.object.title }));
      setPeek(result.object.id);
      onClose();
    } catch (e) {
      setFailure(describeWriteError(e, t));
      setConverting(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    setFailure(null);
    const built = buildObject(type, values, () => undefined);
    if (!built.ok || !built.input) {
      setErrors(built.errors);
      if (built.errors.form) setFailure(t(built.errors.form));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const reserved = node.tags.filter((tag) => tag.startsWith("atlas:"));
      await update.mutateAsync({
        id: node.id,
        patch: {
          title: built.input.title,
          status: built.input.status,
          tags: [...parseTags(values.fields.tags ?? ""), ...reserved].filter(
            (tag, i, all) => all.indexOf(tag) === i,
          ),
          confidence: built.input.confidence,
          details: built.input.details as Record<string, unknown>,
        },
      });
      pushToast(t("edit.saved", { title: built.input.title }));
      onClose();
    } catch (e) {
      setFailure(describeWriteError(e, t));
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex min-h-0 grow flex-col"
    >
      <div className="flex grow flex-col gap-4 overflow-y-auto px-6 py-4">
        <ObjectForm
          type={type}
          values={values}
          onChange={setValues}
          errors={errors}
          nodes={nodes}
          showRelations={false}
          onSubmit={() => void submit()}
        />
        {isConvertible(node.type) && (
          <div className="flex flex-col gap-2 rounded-control border border-border p-3">
            <label htmlFor="edit-category" className="text-xs text-fg-muted">
              {t("edit.category")}
            </label>
            <div className="flex items-center gap-2">
              <select
                id="edit-category"
                value={category ?? node.type}
                onChange={(e) => {
                  const picked = e.target.value as ConvertibleType;
                  setCategory(picked === node.type ? null : picked);
                }}
                className={control}
              >
                {CONVERTIBLE_TYPES.map((ct) => (
                  <option key={ct} value={ct}>
                    {typeLabel(ct)}
                  </option>
                ))}
              </select>
              {category && (
                <button
                  type="button"
                  disabled={converting}
                  onClick={() => void submitConvert()}
                  className={secondary}
                >
                  {converting ? t("edit.converting") : t("edit.convert")}
                </button>
              )}
            </div>
            {category && preview && (
              <div className="flex flex-col gap-1 text-xs text-fg-muted">
                <p>{t("edit.convertIntro", { type: typeLabel(category) })}</p>
                {preview.droppedRelations > 0 && (
                  <p>
                    {t("edit.convertDropRelations", {
                      count: preview.droppedRelations,
                      type: typeLabel(category),
                    })}
                  </p>
                )}
                {preview.droppedFields > 0 && (
                  <p>
                    {t("edit.convertDropFields", {
                      count: preview.droppedFields,
                      type: typeLabel(category),
                    })}
                  </p>
                )}
                <p>{t("edit.convertNoUndo")}</p>
              </div>
            )}
          </div>
        )}
        {failure && (
          <p role="alert" className="flex items-center gap-2 text-fg">
            <span
              aria-hidden="true"
              className="inline-block size-2 shrink-0 rounded-full bg-critical"
            />
            {failure}
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border bg-panel px-6 py-4">
        <button type="button" onClick={onClose} className={secondary}>
          {t("common.cancel")}
        </button>
        <button type="submit" disabled={busy} className={primary}>
          {busy ? t("edit.saving") : t("edit.save")}
        </button>
      </div>
    </form>
  );
}

/**
 * Creating and editing, from anywhere. A create request may carry a type (open on the form) and
 * a parent (the new object is related to it automatically). Without a type it opens on the type
 * picker. It is a dialog over the current lens, so nobody loses their place.
 */
export function CreateDialog() {
  const { t, typeLabel } = useI18n();
  const request = useUi((s) => s.create);
  const closeCreate = useUi((s) => s.closeCreate);
  const editing = useUi((s) => s.edit);
  const closeEdit = useUi((s) => s.closeEdit);

  // The picked type lives here so "Change type" can return to the picker without closing.
  // A choice belongs to the request it was made for: a new request starts from its own type.
  const [choice, setChoice] = useState<{
    request: CreateRequest;
    type: CreatableType | null;
  } | null>(null);
  const picked = choice && choice.request === request ? choice.type : (request?.type ?? null);
  const setPicked = (type: CreatableType | null) => {
    if (request) setChoice({ request, type });
  };

  if (editing) {
    return (
      <Dialog.Root open onOpenChange={(open) => !open && closeEdit()}>
        <DialogFrame title={t("edit.title", { type: typeLabel(editing.type) })} type={editing.type}>
          <EditForm node={editing} onClose={closeEdit} />
        </DialogFrame>
      </Dialog.Root>
    );
  }
  if (!request) return null;

  const type = picked ?? request.type ?? null;
  const parent = request.parent ?? null;
  const choices = parent ? childTypesFor(parent.type) : [...CREATABLE_TYPES];

  return (
    <Dialog.Root open onOpenChange={(open) => !open && closeCreate()}>
      <DialogFrame
        title={
          type
            ? request.titleKey && type === request.type
              ? t(request.titleKey)
              : t(`create.new.${type}`)
            : t("create.title")
        }
        type={type ?? undefined}
        subtitle={
          type
            ? undefined
            : parent
              ? t("create.inContext", { parent: parent.title })
              : t("create.pickBody")
        }
      >
        {type ? (
          <CreateForm
            key={`${type}`}
            request={request}
            type={type}
            onClose={closeCreate}
            onChangeType={request.type && !parent ? undefined : () => setPicked(null)}
          />
        ) : (
          <div className="overflow-y-auto px-6 py-4">
            <TypePicker types={choices} onPick={setPicked} />
          </div>
        )}
      </DialogFrame>
    </Dialog.Root>
  );
}

function DialogFrame({
  title,
  subtitle,
  type,
  children,
}: {
  title: string;
  subtitle?: string;
  type?: CreatableType | ApiObject["type"];
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Dialog.Portal>
      <Dialog.Overlay
        className="fade-in fixed inset-0 z-40 backdrop-blur-[6px]"
        style={{ background: "rgb(20 16 12 / 0.34)" }}
      />
      <Dialog.Content
        aria-describedby={undefined}
        className="pop-in fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[22px] border border-border-strong bg-surface shadow-pop focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div className="flex min-w-0 flex-col gap-1">
            <Dialog.Title className="flex items-center gap-3 text-[19px] font-semibold tracking-[-0.01em]">
              {type && <TypeGlyph type={type} />}
              {title}
            </Dialog.Title>
            {subtitle && <p className="text-fg-muted">{subtitle}</p>}
          </div>
          <Dialog.Close
            aria-label={t("common.close")}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] text-fg-muted transition-colors duration-(--duration-hover) hover:bg-sunk hover:text-fg"
          >
            <Icon name="close" />
          </Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
