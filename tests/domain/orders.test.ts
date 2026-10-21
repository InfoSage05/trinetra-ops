import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import { createBill } from "@/domain/billing";
import { cancelOrder, closeOrder, createOrder, getOrder, getOrderReminders, getPendingRequirements, listOrders } from "@/domain/orders";
import { imageMimeType, proposeOrder, proposeOrderFromImage } from "@/domain/ai-orders";
import { setLlmClientForTests, setVisionClientForTests } from "@/lib/llm";
import { extractDueDate } from "@/lib/text-entry";
import { DomainError, ForbiddenError, ValidationError } from "@/lib/errors";
import { istDateParts } from "@/lib/time";
import { resetDb } from "../helpers/db";
import { addStock, makeBusinessProfile, makeCustomer, makeProduct, makeSeries, makeUser } from "../helpers/factories";

beforeEach(resetDb);
afterEach(() => { setLlmClientForTests(undefined); setVisionClientForTests(undefined); });

function isoIn(days: number): string {
  const { year, month, day } = istDateParts(new Date());
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}

async function world() {
  await makeBusinessProfile();
  await makeSeries("INVOICE");
  const owner = await makeUser("OWNER");
  const worker = await makeUser("WORKER");
  const customer = await makeCustomer({ name: "Sharma Traders" });
  const rose = await makeProduct({ name: "Rose Candle", qtyPerCarton: 24, unitPrice: "10.00" });
  const birthday = await makeProduct({ name: "Birthday Candle", qtyPerCarton: 12, unitPrice: "10.00" });
  await addStock(rose.id, "100.00");
  return { owner, worker, customer, rose, birthday };
}

describe("orders", () => {
  it("saves lines in pieces using each item's carton size, and a repeated save returns the same order", async () => {
    const { owner, customer, rose, birthday } = await world();
    const input = {
      customerId: customer.id, dueDate: isoIn(3), idempotencyKey: "order-key-0001",
      lines: [{ productId: rose.id, cartons: "2" }, { productId: birthday.id, cartons: "1", loosePieces: "5" }],
    };
    const order = await createOrder(owner, input);
    expect(order.lines.map((l) => l.quantity.toString())).toEqual(["48", "17"]);
    expect((await createOrder(owner, input)).id).toBe(order.id);
    expect(await prisma.order.count()).toBe(1);
  });

  it("merges the same item written twice into one line, so delivery is not counted twice", async () => {
    const { owner, customer, rose } = await world();
    const order = await createOrder(owner, {
      customerId: customer.id, dueDate: isoIn(3), idempotencyKey: "order-key-0009",
      lines: [{ productId: rose.id, cartons: "5" }, { productId: rose.id, cartons: "5" }],
    });
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0].quantity.toString()).toBe("240");
    await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "order-bill-0009", orderId: order.id, lines: [{ productId: rose.id, cartons: "3" }] });
    const view = await getOrder(owner, order.id);
    expect(view.status).toBe("PARTIAL");
    expect(view.lines[0].outstanding.toString()).toBe("168"); // 240 ordered, 72 delivered
  });

  it("rejects past dates, empty orders and non-owners", async () => {
    const { owner, worker, customer, rose } = await world();
    const base = { customerId: customer.id, idempotencyKey: "order-key-0002", lines: [{ productId: rose.id, cartons: "1" }] };
    await expect(createOrder(owner, { ...base, dueDate: isoIn(-1) })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrder(owner, { ...base, dueDate: isoIn(1), lines: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createOrder(worker, { ...base, dueDate: isoIn(1) })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("works out delivered and outstanding from the bills raised against the order", async () => {
    const { owner, customer, rose } = await world();
    const order = await createOrder(owner, { customerId: customer.id, dueDate: isoIn(5), idempotencyKey: "order-key-0003", lines: [{ productId: rose.id, cartons: "3" }] });
    expect((await getOrder(owner, order.id)).status).toBe("PENDING");

    await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "order-bill-0001", orderId: order.id, lines: [{ productId: rose.id, cartons: "1" }] });
    const partial = await getOrder(owner, order.id);
    expect(partial.status).toBe("PARTIAL");
    expect(partial.lines[0].delivered.toString()).toBe("24");
    expect(partial.lines[0].outstanding.toString()).toBe("48");
    expect(partial.bills).toHaveLength(1);

    await createBill(owner, { customerId: customer.id, placeOfSupply: "21", idempotencyKey: "order-bill-0002", orderId: order.id, lines: [{ productId: rose.id, cartons: "2" }] });
    expect((await getOrder(owner, order.id)).status).toBe("COMPLETED");
    expect(await listOrders(owner, {})).toHaveLength(0); // completed orders leave the open list
    expect(await listOrders(owner, { show: "ALL" })).toHaveLength(1);
  });

  it("will not bill another customer's, cancelled or closed order", async () => {
    const { owner, customer, rose } = await world();
    const other = await makeCustomer({ name: "Other Shop" });
    const order = await createOrder(owner, { customerId: customer.id, dueDate: isoIn(2), idempotencyKey: "order-key-0004", lines: [{ productId: rose.id, cartons: "1" }] });
    const bill = (key: string, customerId: string) =>
      createBill(owner, { customerId, placeOfSupply: "21", idempotencyKey: key, orderId: order.id, lines: [{ productId: rose.id, cartons: "1" }] });
    await expect(bill("order-bill-0003", other.id)).rejects.toBeInstanceOf(ValidationError);
    await cancelOrder(owner, { orderId: order.id });
    await expect(bill("order-bill-0004", customer.id)).rejects.toMatchObject({ code: "ORDER_NOT_OPEN" });
    await expect(cancelOrder(owner, { orderId: order.id })).rejects.toBeInstanceOf(DomainError);
    await expect(closeOrder(owner, { orderId: order.id })).rejects.toBeInstanceOf(DomainError);
  });

  it("order lines can never be edited or deleted", async () => {
    const { owner, customer, rose } = await world();
    await createOrder(owner, { customerId: customer.id, dueDate: isoIn(2), idempotencyKey: "order-key-0005", lines: [{ productId: rose.id, cartons: "1" }] });
    await expect(prisma.orderLine.updateMany({ data: { quantity: "999.00" } })).rejects.toThrow();
    await expect(prisma.orderLine.deleteMany({})).rejects.toThrow();
  });

  it("lists what must be made (outstanding minus stock) and who is overdue or due soon", async () => {
    const { owner, customer, rose, birthday } = await world();
    await createOrder(owner, { customerId: customer.id, dueDate: isoIn(1), idempotencyKey: "order-key-0006", lines: [{ productId: rose.id, cartons: "5" }, { productId: birthday.id, cartons: "2" }] });
    await createOrder(owner, { customerId: customer.id, dueDate: isoIn(20), idempotencyKey: "order-key-0007", lines: [{ productId: rose.id, cartons: "1" }] });
    const need = await getPendingRequirements(owner);
    const roseNeed = need.find((n) => n.productId === rose.id)!;
    expect(roseNeed.outstanding.toString()).toBe("144"); // 6 cartons x 24
    expect(roseNeed.toMake.toString()).toBe("44"); // 100 in stock
    expect(need.find((n) => n.productId === birthday.id)!.toMake.toString()).toBe("24");

    const reminders = await getOrderReminders(owner);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].dueState).toBe("DUE_SOON");
  });
});

describe("extractDueDate", () => {
  const today = "2026-10-21";
  it("understands everyday phrases", () => {
    expect(extractDueDate("5 carton rose kal", today)).toEqual({ date: "2026-10-22", rest: "5 carton rose" });
    expect(extractDueDate("rose 5 carton parso tak", today).date).toBe("2026-10-23");
    expect(extractDueDate("by 5th Nov rose", today).date).toBe("2026-11-05");
    expect(extractDueDate("Nov 5 rose", today).date).toBe("2026-11-05");
    expect(extractDueDate("in 3 days", today).date).toBe("2026-10-24");
    expect(extractDueDate("rose 1 carton 2026-12-01", today).date).toBe("2026-12-01");
    expect(extractDueDate("a date in 5 Jan", today).date).toBe("2027-01-05");
    expect(extractDueDate("rose 3 carton", today).date).toBeNull();
  });
  it("only reads whole month words, never the start of an item name", () => {
    expect(extractDueDate("Sharma, 5 marble candle, 3 rose", today)).toEqual({ date: null, rest: "Sharma, 5 marble candle, 3 rose" });
    expect(extractDueDate("2 decorative, 4 novelty", today).date).toBeNull();
    expect(extractDueDate("5 march rose", today).date).toBe("2027-03-05");
    expect(extractDueDate("31 feb rose", today).date).toBeNull();
  });
});

describe("proposeOrder", () => {
  it("reads customer, date and items with no AI configured", async () => {
    const { owner, customer, rose, birthday } = await world();
    setLlmClientForTests(null);
    const p = await proposeOrder(owner, { text: "Sharma Traders ko 5 carton rose aur 2 carton birthday chahiye kal" });
    expect(p.extractor).toBe("RULES");
    expect(p.customer).toMatchObject({ status: "MATCHED", id: customer.id });
    expect(p.dueDate).toBe(isoIn(1));
    expect(p.lines.map((l) => [l.productId, l.pieces])).toEqual([[rose.id, "120"], [birthday.id, "24"]]);
  });

  it("uses the model's answer when available, ignores a date in the past, and still needs a real customer", async () => {
    const { owner, rose } = await world();
    setLlmClientForTests({
      model: "test-model",
      complete: async () => JSON.stringify({ customer: "Unknown Person", dueDate: "2020-01-01", items: [{ name: "rose", quantity: 1, unit: "carton" }] }),
    });
    const p = await proposeOrder(owner, { text: "anything" });
    expect(p.extractor).toBe("LLM");
    expect(p.dueDate).toBeNull();
    expect(p.customer.status).toBe("UNMATCHED");
    expect(p.lines[0]).toMatchObject({ productId: rose.id, pieces: "24" });
  });

  it("is for the owner only", async () => {
    const { worker } = await world();
    await expect(proposeOrder(worker, { text: "rose 1 carton" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("proposeOrderFromImage", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0]);

  it("turns a photo into a proposal for the chosen customer, never saving anything", async () => {
    const { owner, customer, rose } = await world();
    let sentImage = "";
    setVisionClientForTests({
      model: "vision-test",
      describe: async ({ imageDataUrl }) => {
        sentImage = imageDataUrl;
        return JSON.stringify({ customer: "someone else", dueDate: isoIn(4), items: [{ name: "rose", quantity: 2, unit: "carton" }] });
      },
    });
    const p = await proposeOrderFromImage(owner, { image: png, customerId: customer.id });
    expect(sentImage.startsWith("data:image/png;base64,")).toBe(true);
    expect(p.extractor).toBe("LLM");
    expect(p.model).toBe("vision-test");
    expect(p.customer).toMatchObject({ status: "MATCHED", id: customer.id }); // the owner's choice wins over the photo
    expect(p.dueDate).toBe(isoIn(4));
    expect(p.lines[0]).toMatchObject({ productId: rose.id, pieces: "48" });
    expect(await prisma.order.count()).toBe(0);
  });

  it("reads the customer from the photo when none is chosen", async () => {
    const { owner, customer } = await world();
    setVisionClientForTests({ model: "v", describe: async () => JSON.stringify({ customer: "Sharma Traders", items: [] }) });
    const p = await proposeOrderFromImage(owner, { image: png });
    expect(p.customer).toMatchObject({ status: "MATCHED", id: customer.id });
    expect(p.notes.join(" ")).toMatch(/No items/);
  });

  it("refuses non-pictures, huge files, a missing vision model, unreadable answers and non-owners", async () => {
    const { owner, worker } = await world();
    setVisionClientForTests({ model: "v", describe: async () => "{}" });
    await expect(proposeOrderFromImage(owner, { image: new TextEncoder().encode("MZ-not-a-picture-at-all") })).rejects.toBeInstanceOf(ValidationError);
    await expect(proposeOrderFromImage(owner, { image: new Uint8Array(5 * 1024 * 1024).fill(0xff) })).rejects.toBeInstanceOf(ValidationError);
    await expect(proposeOrderFromImage(owner, { image: png, customerId: "nope" })).rejects.toThrow();
    setVisionClientForTests({ model: "v", describe: async () => "I cannot read this." });
    await expect(proposeOrderFromImage(owner, { image: png })).rejects.toMatchObject({ code: "AI_BAD_OUTPUT" });
    setVisionClientForTests(null);
    await expect(proposeOrderFromImage(owner, { image: png })).rejects.toMatchObject({ code: "VISION_OFF" });
    await expect(proposeOrderFromImage(worker, { image: png })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an order made from a photo is saved as coming from a photo", async () => {
    const { owner, customer, rose } = await world();
    const order = await createOrder(owner, { customerId: customer.id, dueDate: isoIn(2), idempotencyKey: "order-key-img1", source: "IMAGE", lines: [{ productId: rose.id, cartons: "1" }] });
    expect(order.source).toBe("IMAGE");
    expect(order.actorType).toBe("AGENT");
  });

  it("only accepts real picture formats", () => {
    expect(imageMimeType(png)).toBe("image/png");
    expect(imageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(imageMimeType(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(imageMimeType(new TextEncoder().encode("GIF89a......."))).toBeNull();
  });
});
