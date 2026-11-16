import { PROFILE_TEXT_MAX_LENGTH } from "@/domain/profile/profile";

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt ignores bytes beyond 72. */
export const PASSWORD_MAX_LENGTH = 72;
export const EMAIL_MAX_LENGTH = 254;
export const DISPLAY_NAME_MAX_LENGTH = PROFILE_TEXT_MAX_LENGTH.displayName;
