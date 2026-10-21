/** GST state/UT codes (as used in GSTINs and e-invoice place of supply). Verify against the GST portal list. */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
  "97": "Other Territory",
};

export function isValidStateCode(code: string): boolean {
  return Object.hasOwn(GST_STATES, code);
}

export function stateName(code: string): string {
  return GST_STATES[code] ?? code;
}

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Mod-36 check character over the first 14 characters (the algorithm the GST system uses). */
export function gstinCheckCharacter(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
}

export function isValidGstin(gstin: string): boolean {
  if (!GSTIN_PATTERN.test(gstin)) return false;
  if (!isValidStateCode(gstin.slice(0, 2))) return false;
  return gstinCheckCharacter(gstin.slice(0, 14)) === gstin[14];
}

/** Removes spaces, hyphens, invisible characters and other punctuation that sneak in when copying a GSTIN, and upper-cases it. */
export function cleanGstin(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** A plain-words reason a GSTIN is not accepted, or null when it is fine. */
export function gstinProblem(gstin: string): string | null {
  if (gstin.length !== 15) return `A GSTIN has 15 characters; this has ${gstin.length}.`;
  if (!GSTIN_PATTERN.test(gstin)) return "A GSTIN looks like 21ABCDE1234F1Z5: 2 digits, 5 letters, 4 digits, 1 letter, then a letter or digit, then Z, then a letter or digit. Check for the letter O instead of zero, or the letter I instead of the digit 1.";
  if (!isValidStateCode(gstin.slice(0, 2))) return `${gstin.slice(0, 2)} is not a state code.`;
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin[14]) return "The last character does not match the rest of the number, so there is a typo somewhere. Compare it with your registration certificate.";
  return null;
}

export function stateCodeFromGstin(gstin: string): string {
  return gstin.slice(0, 2);
}

export function isValidHsn(hsn: string): boolean {
  return /^\d{4}(\d{2}){0,2}$/.test(hsn);
}
