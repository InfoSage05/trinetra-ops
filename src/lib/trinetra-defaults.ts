/**
 * Pre-filled business details taken from the owner's invoice template ("new in voice.xlsx").
 * Used only to prefill the Settings form the first time; the owner reviews and saves them.
 * The GSTIN is deliberately left empty: the number on the sheet (21ASKPD3583HIZX) fails the official checksum,
 * and a guessed number must never end up on a tax invoice. The owner types it from the registration certificate.
 */
export const TRINETRA_DEFAULTS = {
  legalName: "Trinetra Candles",
  gstin: "",
  addressLine1: "Kalayan Nagar, Angaragadia",
  city: "Balasore",
  pincode: "756001",
  invoiceTerms: [
    "Goods once sold cannot be returned or exchanged.",
    "Company is not responsible for any breakage.",
    "Extra charges will be added for packaging and transport.",
    "Material prices are subject to the market condition of paraffin wax.",
  ].join("\n"),
  bankDetails: ["Union Bank of India", "Trinetra Candles", "A/c no: 102213100012640", "IFSC code: UBIN0810223"].join("\n"),
} as const;
