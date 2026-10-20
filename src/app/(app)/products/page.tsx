import { toPlain } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { listProducts } from "@/domain/products";
import { ProductsManager } from "@/components/products-manager";

export default async function ProductsPage() {
  const products = toPlain(await listProducts(await getSession(), { includeInactive: true }));
  return <ProductsManager products={products} />;
}
