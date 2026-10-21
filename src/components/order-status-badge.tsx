import { Badge } from "@/components/ui/badge";
import type { OrderStatus } from "@/domain/orders";

const LABEL: Record<OrderStatus, string> = { PENDING: "Pending", PARTIAL: "Part delivered", COMPLETED: "Delivered", CANCELLED: "Cancelled", CLOSED: "Closed" };

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={status === "COMPLETED" || status === "CLOSED" ? "secondary" : status === "CANCELLED" ? "outline" : "default"}>{LABEL[status]}</Badge>;
}
