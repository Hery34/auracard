"use client";

import { Button } from "@/ui/primitives/button";

/** Shown instead of the dashboard when rendering fails: no technical detail reaches the user. */
export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Une erreur est survenue</h1>
      <p role="alert">Votre tableau de bord n’a pas pu être affiché. Réessayez dans quelques instants.</p>
      <Button type="button" onClick={reset}>
        Réessayer
      </Button>
    </main>
  );
}
