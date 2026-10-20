import { getSession } from "@/lib/session";
import { listUsers } from "@/domain/users";
import { UsersManager } from "@/components/users-manager";

export default async function UsersPage() {
  const session = await getSession();
  return <UsersManager users={await listUsers(session)} currentUserId={session!.userId} />;
}
