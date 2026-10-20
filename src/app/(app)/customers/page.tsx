import { getSession } from "@/lib/session";
import { searchCustomers } from "@/domain/customers";
import { CustomersManager } from "@/components/customers-manager";

export default async function CustomersPage() {
  const customers = await searchCustomers(await getSession(), { limit: 500, includeInactive: true });
  return <CustomersManager customers={customers} />;
}
