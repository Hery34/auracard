import type { CarnetClient } from "./clients";

export type GoTrueUser = { id: string; email: string };

export async function findUsersByEmail(admin: CarnetClient, emails: readonly string[]): Promise<GoTrueUser[]> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    throw error;
  }
  const wanted = new Set(emails.map((email) => email.toLowerCase()));
  return data.users
    .filter((user) => user.email !== undefined && wanted.has(user.email.toLowerCase()))
    .map((user) => ({ id: user.id, email: user.email as string }));
}

export async function findUserByEmail(admin: CarnetClient, email: string): Promise<GoTrueUser | undefined> {
  const [user] = await findUsersByEmail(admin, [email]);
  return user;
}

/**
 * Hard-deletes the accounts (`deleteUser(id, false)`) and reports the profiles that survived, so the
 * calling `afterEach` can assert the cascade `auth.users → carnet.profiles` (and `platform.project_members`,
 * not observable through PostgREST: covered by pgTAP in 0006).
 */
export async function deleteUsersByEmail(
  admin: CarnetClient,
  emails: readonly string[],
): Promise<{ deletedUserIds: string[]; survivingProfileIds: string[] }> {
  const users = await findUsersByEmail(admin, emails);

  for (const user of users) {
    const { error } = await admin.auth.admin.deleteUser(user.id, false);
    if (error) {
      throw error;
    }
  }

  const deletedUserIds = users.map((user) => user.id);
  if (deletedUserIds.length === 0) {
    return { deletedUserIds, survivingProfileIds: [] };
  }

  const { data, error } = await admin.from("profiles").select("id").in("owner_id", deletedUserIds);
  if (error) {
    throw error;
  }
  return { deletedUserIds, survivingProfileIds: data.map((row) => row.id) };
}
