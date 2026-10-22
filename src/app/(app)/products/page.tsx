import { toPlain } from "@/lib/action-result";
import { getSession } from "@/lib/session";
import { listProducts } from "@/domain/products";
import { listCategories } from "@/domain/categories";
import { ProductsManager } from "@/components/products-manager";

export default async function ProductsPage() {
  const session = await getSession();
  const [products, categories] = await Promise.all([listProducts(session, { includeInactive: true }).then(toPlain), listCategories(session)]);
  return <ProductsManager products={products} categories={categories} />;
}
