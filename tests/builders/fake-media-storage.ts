import type { MediaStorage } from "@/domain/profile/ports";
import { ok, type Result } from "@/domain/shared/result";

import { makeCallLog, scriptedResults, type CallLog } from "./call-log";

export type MediaStorageResult = Result<void, "unexpected">;

export type FakeMediaStorageOptions = {
  log?: CallLog;
  /** Objects present in the bucket before the test. */
  objects?: Iterable<string>;
  /** Answers of `upload` in call order; the last one repeats. Defaults to success. */
  uploadResults?: readonly MediaStorageResult[];
  /** Answers of `remove` in call order; the last one repeats. Defaults to success. */
  removeResults?: readonly MediaStorageResult[];
};

export type FakeMediaStorage = MediaStorage & {
  /** Names of the objects currently in the bucket (successful uploads added, successful removals deleted). */
  readonly objects: ReadonlySet<string>;
};

/** Records `{ objectName, bytes, contentType }` for `upload` and the object name for `remove`. */
export function fakeMediaStorage(options: FakeMediaStorageOptions = {}): FakeMediaStorage {
  const log = options.log ?? makeCallLog();
  const objects = new Set(options.objects ?? []);
  const nextUpload = scriptedResults<MediaStorageResult>(options.uploadResults, ok(undefined));
  const nextRemove = scriptedResults<MediaStorageResult>(options.removeResults, ok(undefined));

  return {
    objects,
    async upload(input) {
      log.record("storage", "upload", input);
      const result = nextUpload();
      if (result.ok) {
        objects.add(input.objectName);
      }
      return result;
    },
    async remove(objectName) {
      log.record("storage", "remove", objectName);
      const result = nextRemove();
      if (result.ok) {
        objects.delete(objectName);
      }
      return result;
    },
  };
}
