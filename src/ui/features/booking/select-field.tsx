import type { ReactNode, SelectHTMLAttributes } from "react";

import { Label } from "@/ui/primitives/label";
import { Select } from "@/ui/primitives/select";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
  id: string;
  label: string;
  error?: string | undefined;
  children: ReactNode;
};

/** Label, native select and error message, announced like `Field`: `aria-invalid` + `aria-describedby`. */
export function SelectField({ id, label, error, children, ...selectProps }: Props) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        {...selectProps}
      >
        {children}
      </Select>
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
