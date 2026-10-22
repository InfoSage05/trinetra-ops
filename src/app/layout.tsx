import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Plus_Jakarta_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const interSans = Inter({ variable: "--font-app-sans", subsets: ["latin"], display: "swap" });
const jakartaDisplay = Plus_Jakarta_Sans({
  variable: "--font-app-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = { title: "Trinetra Candles", description: "Billing and stock", applicationName: "Trinetra" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#7c2d12" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${interSans.variable} ${jakartaDisplay.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
