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

/**
 * FOUC prevention — runs synchronously BEFORE first paint so the user never
 * sees a flash of light theme when their preference is dark. Reads the same
 * localStorage key (wcr.theme) that ThemeToggle writes. "auto" mode falls
 * back to the OS preference via prefers-color-scheme.
 */
const themeBootScript = `
(function() {
  try {
    var pref = localStorage.getItem("wcr.theme") || "auto";
    var effective = pref;
    if (pref === "auto") {
      effective = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", effective);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full">
        {children}
        <PWARegister />
      </body>
    </html>
  );
}
