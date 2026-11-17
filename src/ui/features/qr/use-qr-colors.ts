import { useState } from "react";

import { checkQrColors, type QrColorError } from "@/domain/qr/qr-style";

export type QrColors = {
  fg: string;
  bg: string;
  setFg: (value: string) => void;
  setBg: (value: string) => void;
  colorError: QrColorError | null;
};

/** Colours being edited, checked live by the domain rule (decision 4) before any save. */
export function useQrColors(initial: { fg: string; bg: string }): QrColors {
  const [fg, setFg] = useState(initial.fg);
  const [bg, setBg] = useState(initial.bg);
  return { fg, bg, setFg, setBg, colorError: checkQrColors(fg, bg) };
}
