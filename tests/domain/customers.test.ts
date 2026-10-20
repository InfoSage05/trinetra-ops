import { describe, it, expect, beforeEach } from "vitest";
import { createCustomer, updateCustomer, searchCustomers } from "@/domain/customers";
import { ValidationError } from "@/lib/errors";
import { resetDb } from "../helpers/db";
import { makeUser, MAHARASHTRA_CUSTOMER_GSTIN } from "../helpers/factories";

describe("customers", () => {
  beforeEach(resetDb);

  it("creates a walk-in (B2C) customer without GSTIN", async () => {
    const owner = await makeUser("OWNER");
    const c = await createCustomer(owner, { name: "Walk-in", billingAddress: "Cuttack", stateCode: "21", phone: "" });
    expect(c.gstin).toBeNull();
    expect(c.phone).toBeNull();
  });

  it("requires the state to match the GSTIN", async () => {
    const owner = await makeUser("OWNER");
    await expect(
      createCustomer(owner, { name: "Pune Traders", billingAddress: "Pune", stateCode: "21", gstin: MAHARASHTRA_CUSTOMER_GSTIN })
    ).rejects.toThrow(ValidationError);
    const ok = await createCustomer(owner, { name: "Pune Traders", billingAddress: "Pune", stateCode: "27", gstin: MAHARASHTRA_CUSTOMER_GSTIN });
    expect(ok.stateCode).toBe("27");
    await expect(
      createCustomer(owner, { name: "Copy", billingAddress: "Pune", stateCode: "27", gstin: MAHARASHTRA_CUSTOMER_GSTIN })
    ).rejects.toMatchObject({ code: "DUPLICATE_GSTIN" });
  });

  it("updates and searches by name, phone or GSTIN", async () => {
    const owner = await makeUser("OWNER");
    const c = await createCustomer(owner, { name: "Ramesh Traders", billingAddress: "Cuttack", stateCode: "21", phone: "9876500001" });
    await updateCustomer(owner, { id: c.id, name: "Ramesh Traders & Sons", billingAddress: "Cuttack", stateCode: "21", phone: "9876500001" });
    expect((await searchCustomers(owner, { query: "sons" }))[0].id).toBe(c.id);
    expect((await searchCustomers(owner, { query: "98765" }))[0].id).toBe(c.id);
  });
});
