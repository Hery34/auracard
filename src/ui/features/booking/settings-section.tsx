import { useId, type ReactNode } from "react";

/** A `region` named by its `h2`. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <h2 id={titleId} className="text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
