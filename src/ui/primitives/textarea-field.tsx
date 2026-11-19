import type { TextareaHTMLAttributes } from "react";

import { Label } from "@/ui/primitives/label";
import { Textarea } from "@/ui/primitives/textarea";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & { id: string; label: string; error: string | undefined };

/** Label, textarea and error message, announced through `aria-invalid` + `aria-describedby`. */
export function TextareaField({ id, label, error, ...textareaProps }: Props) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        {...textareaProps}
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
