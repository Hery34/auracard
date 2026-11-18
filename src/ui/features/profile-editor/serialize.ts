import { TEXT_FIELDS, type EditorFields, type EditorLink } from "@/ui/features/profile-editor/editor-state";

/** Body of `updateProfileAction`: every text field, switches as `"on"` when set (checkbox convention). */
export function toProfileFormData(fields: EditorFields): FormData {
  const data = new FormData();
  for (const name of TEXT_FIELDS) {
    data.set(name, fields[name]);
  }
  if (fields.isPublished) {
    data.set("isPublished", "on");
  }
  if (fields.isIndexable) {
    data.set("isIndexable", "on");
  }
  if (fields.acceptsLeads) {
    data.set("acceptsLeads", "on");
  }
  return data;
}

/** Body of `replaceLinksAction`: field `links`, the full ordered list in JSON; `id` only for stored links. */
export function toLinksFormData(links: readonly EditorLink[]): FormData {
  const data = new FormData();
  data.set(
    "links",
    JSON.stringify(
      links.map(({ id, platform, url, label }) => (id === null ? { platform, url, label } : { id, platform, url, label })),
    ),
  );
  return data;
}
