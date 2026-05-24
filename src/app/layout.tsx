import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import PWARegister from "@/components/PWARegister";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "White Collar Realty · CRM",
  description: "Sales command center for White Collar Realty — Dubai & India teams",
  applicationName: "WCR CRM",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "WCR CRM",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // viewportFit: "cover" is required for env(safe-area-inset-*) to return real values
  // on notched iPhones in standalone PWA mode — otherwise header/nav get hidden under
  // the status bar and home indicator.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0b1a33" },
    { media: "(prefers-color-scheme: dark)",  color: "#0b1a33" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <PWARegister />
      </body>
    </html>
  );
}
