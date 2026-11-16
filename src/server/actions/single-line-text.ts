/** No control (Cc), format (Cf: bidi overrides, zero-width…), line (U+2028) nor paragraph (U+2029) separator: what `profiles_text_charset_check` refuses. */
export const SINGLE_LINE_TEXT = /^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*$/u;
