import { findUserByEmail, findUsersByEmail, type GoTrueUser } from "../../integration/setup/cleanup";
import { adminClient, type CarnetClient } from "../../integration/setup/clients";
import ensureSupabaseEnv from "../../integration/setup/supabase-env";
import { E2E_EMAIL_PREFIX, type Account } from "./accounts";

export type ProfileRow = { slug: string; display_name: string; is_published: boolean };

const LIST_PAGE_SIZE = 1000;

let client: CarnetClient | undefined;

/**
 * `service_role` client of the local stack. The variables come from the environment or, when absent,
 * from `supabase status -o env` (same guard as the integration suite: local host only, no `.env*` read).
 */
function admin(): CarnetClient {
  if (client === undefined) {
    ensureSupabaseEnv();
    client = adminClient();
  }
  return client;
}

/** Account of the instance without any `carnet` membership (ADR 0002 scenario), confirmed, ready to sign in. */
export async function createAccount({ email, password }: Account): Promise<string> {
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error !== null || data.user === null) {
    throw error ?? new Error("createUser returned no user");
  }
  return data.user.id;
}

/** Account that already joined `carnet` (membership + unpublished profile through `register_member`). */
export async function createMember(account: Account): Promise<string> {
  const userId = await createAccount(account);
  const { error } = await admin().rpc("register_member", {
    p_user_id: userId,
    p_display_name: account.displayName,
    p_slug: account.slug,
  });
  if (error !== null) {
    throw error;
  }
  return userId;
}

export async function findUser(email: string): Promise<GoTrueUser | undefined> {
  return findUserByEmail(admin(), email);
}

export async function countUsers(email: string): Promise<number> {
  return (await findUsersByEmail(admin(), [email])).length;
}

export async function profilesOf(userId: string): Promise<ProfileRow[]> {
  const { data, error } = await admin()
    .from("profiles")
    .select("slug, display_name, is_published")
    .eq("owner_id", userId);
  if (error !== null) {
    throw error;
  }
  return data;
}

/** Hard-deletes every account whose e-mail starts with `e2e-`, whatever run created it (failed runs included). */
export async function deleteE2eAccounts(): Promise<number> {
  const ids: string[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin().auth.admin.listUsers({ page, perPage: LIST_PAGE_SIZE });
    if (error !== null) {
      throw error;
    }
    for (const user of data.users) {
      if (user.email !== undefined && user.email.toLowerCase().startsWith(E2E_EMAIL_PREFIX)) {
        ids.push(user.id);
      }
    }
    if (data.users.length < LIST_PAGE_SIZE) {
      break;
    }
  }
  for (const id of ids) {
    const { error } = await admin().auth.admin.deleteUser(id, false);
    if (error !== null) {
      throw error;
    }
  }
  return ids.length;
}
