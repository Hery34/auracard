import type { InputHTMLAttributes, ReactNode } from "react";

import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "name"> & {
  label: string;
  error?: string | undefined;
  /** Permanent help text, announced after the error. */
  hint?: ReactNode;
} & (
    | {
        name: string;
        /** Defaults to `field-{name}`; required when the same name appears more than once on the page. */
        id?: string | undefined;
      }
    | { name?: undefined; id: string }
  );

/** Label, input and error message: the error is announced through `aria-invalid` + `aria-describedby`. */
export function Field({ name, label, error, id = `field-${name}`, hint, ...inputProps }: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error === undefined ? null : errorId, hint === undefined ? null : hintId].filter((value) => value !== null);
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy.length === 0 ? undefined : describedBy.join(" ")}
        {...inputProps}
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
      {hint !== undefined && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
