import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Packages that must run as plain Node modules on the server (native-ish or large).
  serverExternalPackages: ["@react-pdf/renderer", "exceljs", "pg"],
  // Fonts are read from disk by the PDF route; make sure they ship with the deployment.
  outputFileTracingIncludes: {
    "/api/bills/[id]/pdf": ["./src/assets/fonts/**"],
  },
};

export default nextConfig;
