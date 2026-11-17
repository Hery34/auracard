import { z } from "zod";

import { isAccountDeletionConfirmed } from "@/domain/account/account-deletion";

export const deleteAccountSchema = z.object({ confirmation: z.string().refine(isAccountDeletionConfirmed) });
