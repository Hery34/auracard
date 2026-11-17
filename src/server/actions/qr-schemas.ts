import { z } from "zod";

/** The colour rule itself belongs to the domain: any string reaches the use case. Checkbox `logo`: absent or "on". */
export const saveQrStyleSchema = z.object({
  fg: z.string(),
  bg: z.string(),
  logo: z
    .literal("on")
    .optional()
    .transform((value) => value === "on"),
});
