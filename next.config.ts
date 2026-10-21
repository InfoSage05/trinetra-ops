import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Packages that must run as plain Node modules on the server (native-ish or large).
  serverExternalPackages: ["@react-pdf/renderer", "exceljs", "pg"],
  // Recordings and stock sheets are uploaded through server actions; the default limit is only 1MB.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  // Fonts are read from disk by the PDF route; make sure they ship with the deployment.
  outputFileTracingIncludes: {
    "/api/bills/[id]/pdf": ["./src/assets/fonts/**"],
  },
};

export default nextConfig;
