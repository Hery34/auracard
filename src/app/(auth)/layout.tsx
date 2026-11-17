import { AppHeader } from "@/ui/features/app-shell/app-header";
import { PrivacyNotice } from "@/ui/features/auth/privacy-notice";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
        {children}
        <PrivacyNotice />
      </main>
    </>
  );
}
