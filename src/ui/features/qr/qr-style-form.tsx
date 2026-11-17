"use client";

import { useActionState } from "react";

import type { QrStyle } from "@/domain/qr/qr-style";
import { saveQrStyleAction, type SaveQrStyleState } from "@/server/actions/qr";
import { LogoOption } from "@/ui/features/qr/logo-option";
import { QR_COLOR_ERROR_MESSAGES } from "@/ui/features/qr/messages";
import { QrSaveFeedback } from "@/ui/features/qr/qr-save-feedback";
import { useQrColors } from "@/ui/features/qr/use-qr-colors";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";

const INITIAL_STATE: SaveQrStyleState = { status: "idle" };
const COLOR_RULE_ID = "qr-color-rule";

/** Colours checked live by the domain rule; the save stays disabled while it is broken (the action checks again). */
export function QrStyleForm({ style, logoAvailable }: { style: QrStyle; logoAvailable: boolean }) {
  const [state, formAction, pending] = useActionState(saveQrStyleAction, INITIAL_STATE);
  const { fg, bg, setFg, setBg, colorError } = useQrColors(style);
  const invalid = colorError === null ? undefined : true;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        <Field
          name="fg"
          label="Couleur des modules"
          type="color"
          value={fg}
          onChange={(event) => setFg(event.target.value)}
          aria-invalid={invalid}
          aria-describedby={COLOR_RULE_ID}
          className="h-11 w-24 cursor-pointer p-1"
        />
        <Field
          name="bg"
          label="Couleur du fond"
          type="color"
          value={bg}
          onChange={(event) => setBg(event.target.value)}
          aria-invalid={invalid}
          aria-describedby={COLOR_RULE_ID}
          className="h-11 w-24 cursor-pointer p-1"
        />
      </div>
      <p id={COLOR_RULE_ID} aria-live="polite" className="text-sm text-destructive">
        {colorError === null ? "" : QR_COLOR_ERROR_MESSAGES[colorError]}
      </p>
      <LogoOption available={logoAvailable} defaultChecked={style.logo} />
      <Button type="submit" disabled={pending || colorError !== null}>
        Enregistrer le style
      </Button>
      <QrSaveFeedback state={state} />
    </form>
  );
}
