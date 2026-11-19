import type { EventType } from "@/domain/booking/event-type";
import type { EventTypeRepository, EventTypeWriteError } from "@/domain/booking/ports";
import { ok, type Result } from "@/domain/shared/result";

import { anEventType } from "./booking-settings";
import { makeCallLog, scriptedResults, type CallLog } from "./call-log";

type ListResult = Result<EventType[], "unexpected">;
type WriteResult = Result<EventType, EventTypeWriteError>;
type UpdateResult = Result<EventType, "not_found" | "invalid_input" | "unexpected">;
type SetActiveResult = Result<EventType, "not_found" | "unexpected">;
type ReorderResult = Result<EventType[], "not_found" | "invalid_input" | "unexpected">;
type RemoveResult = Result<void, "has_bookings" | "unexpected">;

export type FakeEventTypeRepositoryOptions = {
  log?: CallLog;
  /** Answers of `listOwn` in call order; the last one repeats. Defaults to `[]`. */
  list?: readonly ListResult[];
  /** Answers of `create`; defaults to the created type echoed back as stored (active). */
  create?: readonly WriteResult[];
  update?: readonly UpdateResult[];
  setActive?: readonly SetActiveResult[];
  reorder?: readonly ReorderResult[];
  /** Defaults to `ok(undefined)`. */
  remove?: readonly RemoveResult[];
};

/** Records every call as `eventTypes.<method>` with its arguments. */
export function fakeEventTypeRepository(options: FakeEventTypeRepositoryOptions = {}): EventTypeRepository {
  const log = options.log ?? makeCallLog();
  const nextList = scriptedResults<ListResult>(options.list, ok([]));
  const nextCreate = options.create === undefined ? null : scriptedResults<WriteResult>(options.create, ok(anEventType()));
  const nextUpdate = scriptedResults<UpdateResult>(options.update, ok(anEventType()));
  const nextSetActive = scriptedResults<SetActiveResult>(options.setActive, ok(anEventType()));
  const nextReorder = scriptedResults<ReorderResult>(options.reorder, ok([anEventType()]));
  const nextRemove = scriptedResults<RemoveResult>(options.remove, ok(undefined));

  return {
    async listOwn(profileId) {
      log.record("eventTypes", "listOwn", { profileId });
      return nextList();
    },
    async create(profileId, eventType) {
      log.record("eventTypes", "create", { profileId, eventType });
      return nextCreate === null ? ok({ ...eventType, isActive: true }) : nextCreate();
    },
    async update(profileId, id, draft) {
      log.record("eventTypes", "update", { profileId, id, draft });
      return nextUpdate();
    },
    async setActive(profileId, id, isActive) {
      log.record("eventTypes", "setActive", { profileId, id, isActive });
      return nextSetActive();
    },
    async reorder(profileId, ids) {
      log.record("eventTypes", "reorder", { profileId, ids });
      return nextReorder();
    },
    async remove(profileId, id) {
      log.record("eventTypes", "remove", { profileId, id });
      return nextRemove();
    },
  };
}
