import { randomUUID } from "node:crypto";

import type { IdGenerator } from "@/domain/shared/ports/id-generator";

export const cryptoIdGenerator: IdGenerator = {
  uuid: () => randomUUID(),
};
