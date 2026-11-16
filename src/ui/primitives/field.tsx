import type { InputHTMLAttributes } from "react";

import { Input } from "@/ui/primitives/input";
import { Label } from "@/ui/primitives/label";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "name"> & {
  name: string;
  label: string;
  error?: string | undefined;
};

/** Label, input and error message: the error is announced through `aria-invalid` + `aria-describedby`. */
export function Field({ name, label, error, ...inputProps }: FieldProps) {
  const id = `field-${name}`;
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        {...inputProps}
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
