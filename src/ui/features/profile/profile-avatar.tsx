const SIZE = 96;

/** Decorative (0021, decision 12): the name follows as the page title. */
export function ProfileAvatar({ avatarUrl, initials }: { avatarUrl: string | null; initials: string }) {
  if (avatarUrl !== null) {
    // eslint-disable-next-line @next/next/no-img-element -- `images.unoptimized: true` (docs/rules/nextjs.md): files are resized in the browser before upload (0021)
    return <img src={avatarUrl} alt="" width={SIZE} height={SIZE} className="size-24 rounded-full object-cover" />;
  }
  return (
    <div
      aria-hidden="true"
      className="flex size-24 items-center justify-center rounded-full bg-primary text-3xl font-semibold text-primary-foreground"
    >
      {initials}
    </div>
  );
}
