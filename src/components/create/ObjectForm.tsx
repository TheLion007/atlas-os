"use client";

import { useId } from "react";
import type { ApiObject } from "@/domain/api-types";
import { isExample, type CreatableType } from "@/domain/creation";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import {
  FIELDS,
  RELATIONS,
  type FieldSpec,
  type FormErrors,
  type FormValues,
  type RelationSpec,
} from "./form-spec";

export const NEW_PLACE = "__new__";
/** Where the new-place name is kept in the field values. */
export const NEW_PLACE_FIELD = "__newPlace";

export const control =
  "h-10 w-full min-w-0 rounded-[12px] border border-border-strong bg-surface px-3 text-[14px] transition-colors placeholder:text-fg-subtle focus-visible:border-accent focus-visible:outline-none! disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-critical";

interface ObjectFormProps {
  type: CreatableType;
  values: FormValues;
  onChange: (next: FormValues) => void;
  errors: FormErrors;
  /** Objects a relation can point at. */
  nodes: readonly ApiObject[];
  /** Editing an object changes its own fields only; its relations are edited on the object. */
  showRelations?: boolean;
  /** Called when Enter is pressed in a single-line field. */
  onSubmit?: () => void;
}

function Row({
  id,
  label,
  hint,
  error,
  required,
  children,
  half,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  half?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", half ? "col-span-1" : "col-span-2")}>
      <label htmlFor={id} className="text-xs text-fg-muted">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} className="text-xs text-fg" role="alert">
          <span
            aria-hidden="true"
            className="mr-2 inline-block size-2 rounded-full bg-critical align-baseline"
          />
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-msg`} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The form for one object type, driven by `form-spec`. It knows nothing about the API: it edits
 * `FormValues` and shows the errors it is given, so the same form serves create and edit.
 */
export function ObjectForm({
  type,
  values,
  onChange,
  errors,
  nodes,
  showRelations = true,
  onSubmit,
}: ObjectFormProps) {
  const { t, typeLabel } = useI18n();
  const base = useId();

  const setField = (name: string, value: string) =>
    onChange({ ...values, fields: { ...values.fields, [name]: value } });

  const renderField = (spec: FieldSpec, index: number) => {
    const id = `${base}-${spec.name}`;
    const err = errors[spec.name];
    const value = values.fields[spec.name] ?? "";
    const common = {
      id,
      value,
      "aria-invalid": err ? true : undefined,
      "aria-describedby": err || spec.hint ? `${id}-msg` : undefined,
      required: spec.required,
    } as const;
    let input: React.ReactNode;
    switch (spec.kind) {
      case "textarea":
        input = (
          <textarea
            {...common}
            rows={3}
            onChange={(e) => setField(spec.name, e.target.value)}
            className={cn(control, "h-auto min-h-20 py-2")}
          />
        );
        break;
      case "combo":
        input = (
          <>
            <input
              {...common}
              type="text"
              list={`${id}-list`}
              autoComplete="off"
              onChange={(e) => setField(spec.name, e.target.value)}
              className={control}
            />
            <datalist id={`${id}-list`}>
              {spec.suggestions?.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </>
        );
        break;
      case "object":
        input = (
          <select
            {...common}
            onChange={(e) => setField(spec.name, e.target.value)}
            className={control}
          >
            <option value="">{t("create.none")}</option>
            {nodes
              .filter((n) => spec.accepts?.includes(n.type))
              .sort((a, b) => a.title.localeCompare(b.title))
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
          </select>
        );
        break;
      case "select":
        input = (
          <select
            {...common}
            onChange={(e) => setField(spec.name, e.target.value)}
            className={control}
          >
            {spec.required && value === "" && <option value="">{t("common.choose")}</option>}
            {spec.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </select>
        );
        break;
      default:
        input = (
          <input
            {...common}
            type={
              spec.kind === "date" ? "date" : spec.kind === "datetime" ? "datetime-local" : "text"
            }
            inputMode={spec.kind === "number" ? "decimal" : undefined}
            autoFocus={index === 0}
            autoComplete="off"
            onChange={(e) => setField(spec.name, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && onSubmit) {
                e.preventDefault();
                onSubmit();
              }
            }}
            className={cn(control, spec.kind === "number" && "num")}
          />
        );
    }
    return (
      <Row
        key={spec.name}
        id={id}
        label={t(spec.label)}
        hint={spec.hint ? t(spec.hint) : undefined}
        error={err ? t(err) : undefined}
        required={spec.required}
        half={spec.half}
      >
        {input}
      </Row>
    );
  };

  const renderRelation = (spec: RelationSpec) => {
    const id = `${base}-rel-${spec.name}`;
    const chosen = values.relations[spec.name] ?? "";
    const options = nodes
      .filter((n) => spec.accepts.includes(n.type))
      .sort((a, b) => a.title.localeCompare(b.title));
    const multiType = spec.accepts.length > 1;
    const err = errors[spec.name];
    const setRel = (value: string) =>
      onChange({ ...values, relations: { ...values.relations, [spec.name]: value } });
    return (
      <Row
        key={spec.name}
        id={id}
        label={t(spec.label)}
        hint={spec.hint ? t(spec.hint) : undefined}
        error={err ? t(err) : undefined}
      >
        <select
          id={id}
          value={chosen}
          onChange={(e) => setRel(e.target.value)}
          aria-invalid={err ? true : undefined}
          aria-describedby={err || spec.hint ? `${id}-msg` : undefined}
          className={control}
        >
          <option value="">{t("create.none")}</option>
          {options.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
              {multiType ? ` · ${typeLabel(n.type)}` : ""}
              {isExample(n) ? ` · ${t("common.example")}` : ""}
            </option>
          ))}
          {spec.name === "location" && <option value={NEW_PLACE}>{t("create.newPlace")}</option>}
        </select>
        {spec.name === "location" && chosen === NEW_PLACE && (
          <>
            <input
              type="text"
              aria-label={t("create.newPlaceName")}
              placeholder={t("create.newPlaceName")}
              value={values.fields[NEW_PLACE_FIELD] ?? ""}
              onChange={(e) =>
                onChange({
                  ...values,
                  fields: { ...values.fields, [NEW_PLACE_FIELD]: e.target.value },
                })
              }
              className={cn(control, "mt-2")}
            />
            <p className="text-xs text-fg-muted">{t("create.newPlaceHint")}</p>
          </>
        )}
      </Row>
    );
  };

  const relations = showRelations ? RELATIONS[type] : [];
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
      {FIELDS[type].map(renderField)}
      {relations.length > 0 && (
        <div className="col-span-2 grid grid-cols-1 gap-4 border-t border-border pt-4">
          {relations.map(renderRelation)}
        </div>
      )}
    </div>
  );
}
