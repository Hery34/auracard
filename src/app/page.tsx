import { AppHeader } from "@/ui/features/app-shell/app-header";
import { ACCOUNT_DELETED_MESSAGE } from "@/ui/features/account/messages";

type Props = { searchParams: Promise<{ compte?: string | string[] }> };

export default async function HomePage({ searchParams }: Props) {
  const { compte } = await searchParams;

  return (
    <>
      <AppHeader />
      <main>
        {compte === "supprime" && <p role="status">{ACCOUNT_DELETED_MESSAGE}</p>}
        <h1>AuraCard</h1>
      </main>
    </>
  );
}
