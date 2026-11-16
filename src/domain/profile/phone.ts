import { err, ok, type Result } from "@/domain/shared/result";

export type Phone = string & { readonly __brand: "Phone" };

/** `profiles_phone_length_check`. */
export const PHONE_MAX_LENGTH = 32;

/** Digits, spaces, ".", "-", "(", ")", and one optional leading "+". */
const PHONE_PATTERN = /^\+?[0-9 .()-]+$/;
const DIGIT = /[0-9]/;

export function parsePhone(text: string): Result<Phone, "invalid_phone"> {
  if (text.length > PHONE_MAX_LENGTH || !PHONE_PATTERN.test(text) || !DIGIT.test(text)) {
    return err("invalid_phone");
  }
  return ok(text as Phone);
}
