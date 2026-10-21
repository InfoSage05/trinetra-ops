/**
 * Pre-filled business details taken from the owner's invoice template ("new in voice.xlsx").
 * Used only to prefill the Settings form the first time; the owner reviews and saves them.
 * The GST number on the sheet had the letter "I" where the digit "1" belongs (it failed the official
 * checksum); the checksum-valid form is used here and must be confirmed against the registration certificate.
 */
export const TRINETRA_DEFAULTS = {
  legalName: "Trinetra Candles",
  gstin: "21ASKPD3583H1ZX",
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
