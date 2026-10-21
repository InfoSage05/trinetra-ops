/**
 * A plain description of every screen and the common jobs, written for the owner and the workers.
 * The helper uses it two ways: it is given to the AI so answers stay true to this app, and it is searched directly
 * when no AI is switched on. Nothing from the business (customers, prices, bills) is ever put in here.
 */

export type Role = "OWNER" | "WORKER";

export type GuidePage = { href: string; label: string; roles: Role[]; about: string };

export const GUIDE_PAGES: GuidePage[] = [
  { href: "/dashboard", label: "Home", roles: ["OWNER", "WORKER"], about: "Today's sales, money to collect, items running low, orders due soon and anything that needs attention." },
  { href: "/billing/new", label: "New bill", roles: ["OWNER"], about: "Make a bill. Choose the customer, add items with cartons, add carton, crate or freight charges, then save. A stock check shows beside the form. The switch at the top changes between Cards and an Excel sheet layout." },
  { href: "/bills", label: "Bills", roles: ["OWNER"], about: "All bills made so far. Search by bill number or customer. Open a bill to print it, share it on WhatsApp, record a payment or return items." },
  { href: "/inventory", label: "Stock", roles: ["OWNER", "WORKER"], about: "How much of each item is in stock. Press + Made to add what was made today. Owners can also press Correct to fix a wrong number, and set how many pieces make one carton for each item." },
  { href: "/inventory/counts", label: "Count stock", roles: ["OWNER", "WORKER"], about: "Count what is on the shelf and send the count. The owner approves it and stock is corrected." },
  { href: "/inventory/opening-import", label: "Opening stock import", roles: ["OWNER"], about: "Fill in the stock you already have, from an Excel file, when starting." },
  { href: "/assistant", label: "Smart entry", roles: ["OWNER", "WORKER"], about: "Type or say what was made (for example: rose candle 5 carton), or upload a stock sheet. Check what it understood, then approve." },
  { href: "/orders", label: "Orders", roles: ["OWNER"], about: "Customer orders still to be delivered, with what is still to be made. Open an order to make its bill, send a WhatsApp reminder, close or cancel it." },
  { href: "/orders/new", label: "New order", roles: ["OWNER"], about: "Add a customer order by typing, speaking, uploading a photo (Insert images) or filling it by hand." },
  { href: "/customers", label: "Customers", roles: ["OWNER"], about: "The customer list. Add or edit a customer with name, mobile, address and GST number. Open a customer to see their bills and what they still owe." },
  { href: "/products", label: "Products", roles: ["OWNER"], about: "All items. Add an item, import from Excel, or open Rates and names to change the rate of any item and rename it. The item code is optional." },
  { href: "/reports", label: "Reports", roles: ["OWNER"], about: "Sales for any dates, who owes money and for how long, stock movement, and Excel downloads for the CA." },
  { href: "/settings", label: "Settings", roles: ["OWNER"], about: "Business name, GST number, address, bank details, terms for the bill, and the bill number series." },
  { href: "/users", label: "Users", roles: ["OWNER"], about: "Add workers and reset their passwords." },
  { href: "/account/password", label: "Password", roles: ["OWNER", "WORKER"], about: "Change your own password." },
];

export type GuideTask = { keywords: string[]; title: string; steps: string[]; pages: string[] };

export const GUIDE_TASKS: GuideTask[] = [
  { keywords: ["make bill", "new bill", "create bill", "billing", "invoice", "bill banana", "bill"], title: "Make a bill",
    steps: ["Open New bill.", "Choose the customer (or press + New to add one).", "Pick an item, then type the number of cartons. Add more items the same way.", "Add carton, crate or freight charges if any.", "Choose how it was paid, then press Save bill."], pages: ["/billing/new"] },
  { keywords: ["excel", "sheet", "layout", "spreadsheet"], title: "Use the Excel sheet layout for bills",
    steps: ["Open New bill.", "At the top, press Excel sheet. Press Cards to go back.", "Type part of an item name and press Enter, type the cartons, press Enter to go to the next row."], pages: ["/billing/new"] },
  { keywords: ["add stock", "made", "production", "produced", "stock add", "stock badhana"], title: "Add what was made today",
    steps: ["Open Stock.", "Find the item and press + Made.", "Type the cartons made and any extra pieces, then Save."], pages: ["/inventory", "/assistant"] },
  { keywords: ["carton", "cartoon", "pieces in", "per carton", "how many pieces"], title: "Set how many pieces are in one carton",
    steps: ["Open Stock.", "On the item's row, find '1 carton = ... pcs'.", "Type the number and press Save. Each item can have its own number."], pages: ["/inventory"] },
  { keywords: ["rate", "price", "change rate", "rate change", "daam"], title: "Change the rate of an item",
    steps: ["Open Products.", "Press Rates and names.", "Type the new rate next to the item and press Save. You can change the name there too."], pages: ["/products"] },
  { keywords: ["rename", "name", "change name", "naam"], title: "Change the name of an item",
    steps: ["Open Products and press Rates and names, then edit the name and press Save.", "Or open the item from Stock and press Rename."], pages: ["/products", "/inventory"] },
  { keywords: ["gst", "tax", "hsn"], title: "See or set GST",
    steps: ["On New bill, the GST rate shows for every item and in the box 'GST rates on this bill'.", "To change one item's GST rate, open Products, press Edit on the item, change GST % and Save.", "To give every item the same GST rate, open Products and press Set GST for all items. Ask your CA for the right rate."], pages: ["/billing/new", "/products"] },
  { keywords: ["order", "orders", "customer order"], title: "Add a customer order",
    steps: ["Open Orders and press + New order.", "Type or say the order, upload a photo, or fill it by hand.", "Check it, then press Save order. Later press 'Create bill from this order'."], pages: ["/orders/new", "/orders"] },
  { keywords: ["photo", "image", "picture", "insert image", "camera"], title: "Make an order from a photo",
    steps: ["Open New order.", "Press Take a photo, or Insert images to pick saved pictures (up to 5).", "Check every line it read, then press Save order."], pages: ["/orders/new"] },
  { keywords: ["payment", "paid", "received", "udhar", "credit", "due", "owe", "pending money"], title: "Record a payment or see who owes money",
    steps: ["To record a payment: open Bills, open the bill, press Record payment.", "To see who owes money: open Home or Reports."], pages: ["/bills", "/reports", "/dashboard"] },
  { keywords: ["return", "broken", "credit note"], title: "Take back items from a bill",
    steps: ["Open Bills and open the bill.", "Press Return items, choose how many came back and why, then press Create credit note."], pages: ["/bills"] },
  { keywords: ["customer", "customers", "add customer"], title: "Add a customer",
    steps: ["Open Customers and press Add customer.", "Fill the name, address and state. Mobile and GST number are optional."], pages: ["/customers"] },
  { keywords: ["product", "add item", "new item", "new product", "item code", "sku"], title: "Add a new item",
    steps: ["Open Products and press Add product.", "Type the name, rate, GST and pieces in one carton. The code is optional.", "Press Save."], pages: ["/products"] },
  { keywords: ["count", "counting", "shelf"], title: "Count the stock",
    steps: ["Open Count stock.", "Choose the item, type the cartons and loose pieces you counted, then Save count.", "The owner approves it on the same page."], pages: ["/inventory/counts"] },
  { keywords: ["report", "sales", "excel download", "csv", "ca", "accountant"], title: "See sales and download for the CA",
    steps: ["Open Reports.", "Choose the dates and press Show.", "Use Download sales register or Download HSN summary."], pages: ["/reports"] },
  { keywords: ["password", "login", "log in"], title: "Change the password",
    steps: ["Open Password at the top and type a new password."], pages: ["/account/password"] },
  { keywords: ["gstin", "business details", "settings", "bank", "terms", "series"], title: "Business details and bill number",
    steps: ["Open Settings.", "Fill the business name, GST number, address, bank details and terms.", "Set up the invoice number series before the first bill."], pages: ["/settings"] },
];

export function pagesFor(role: Role): GuidePage[] {
  return GUIDE_PAGES.filter((p) => p.roles.includes(role));
}

/** Keyword help used when no AI is switched on (and as a safety net when the AI does not answer). */
export function plainAnswer(question: string, role: Role): { answer: string; hrefs: string[] } {
  const q = question.toLowerCase();
  const allowed = new Set(pagesFor(role).map((p) => p.href));
  const scored = GUIDE_TASKS.map((t) => ({ t, score: t.keywords.filter((k) => q.includes(k)).length * 2 + (q.includes(t.title.toLowerCase()) ? 3 : 0) }))
    .filter((x) => x.score > 0 && x.t.pages.some((p) => allowed.has(p)))
    .sort((a, b) => b.score - a.score);
  const best = scored[0]?.t;
  if (!best) {
    const list = pagesFor(role).slice(0, 8).map((p) => p.label).join(", ");
    return { answer: `I did not understand that fully. You can ask things like "How do I make a bill?" or "How do I add stock?". The main pages are: ${list}.`, hrefs: [] };
  }
  return { answer: `${best.title}:\n${best.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`, hrefs: best.pages.filter((p) => allowed.has(p)) };
}

export const SUGGESTED_QUESTIONS: Record<Role, string[]> = {
  OWNER: ["How do I make a bill?", "How do I add stock?", "How do I change the rate of an item?", "How do I add an order from a photo?", "Who owes me money?"],
  WORKER: ["How do I add what was made today?", "How do I count the stock?"],
};
