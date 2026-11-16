import { signOutAction } from "@/server/actions/auth";
import { Button } from "@/ui/primitives/button";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant="outline">
        Se déconnecter
      </Button>
    </form>
  );
}
