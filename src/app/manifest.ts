import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trinetra Candles", short_name: "Trinetra", start_url: "/dashboard", display: "standalone",
    background_color: "#ffffff", theme_color: "#7c2d12",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
