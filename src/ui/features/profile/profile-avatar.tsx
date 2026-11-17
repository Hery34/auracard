import Image from "next/image";

const SIZE = 96;

export function ProfileAvatar({ avatarUrl, initials, alt }: { avatarUrl: string | null; initials: string; alt: string }) {
  if (avatarUrl !== null) {
    return <Image src={avatarUrl} alt={alt} width={SIZE} height={SIZE} className="size-24 rounded-full object-cover" />;
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
