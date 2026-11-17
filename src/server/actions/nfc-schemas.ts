import { z } from "zod";

import { ACTIVATION_CODE_INPUT_MAX_LENGTH, NFC_TAG_UID_PATTERN } from "@/domain/nfc/nfc-tag";

/** The code is normalized and checked by the use case: a malformed code has the answer of a wrong one. */
export const activateNfcTagSchema = z.object({
  uid: z.string().regex(NFC_TAG_UID_PATTERN),
  code: z.string().max(ACTIVATION_CODE_INPUT_MAX_LENGTH),
});

const tagIdSchema = z.uuid();

export const setNfcTagEnabledSchema = z.object({
  tagId: tagIdSchema,
  enabled: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const releaseNfcTagSchema = z.object({ tagId: tagIdSchema });
