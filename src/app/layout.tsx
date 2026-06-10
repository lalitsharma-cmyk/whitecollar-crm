import type { Metadata, Viewport } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import PWARegister from "@/components/PWARegister";
import WhatsAppDeepLink from "@/components/WhatsAppDeepLink";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Serif display face for the "luxury real estate" voice — used ONLY on the login
// + dashboard hero headings via the .font-display utility. Body stays Inter.
const playfair = Playfair_Display({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-serif", display: "swap" });

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
    <html lang="en" className={`${inter.variable} ${playfair.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full">
        {children}
        <WhatsAppDeepLink />
        <PWARegister />
      </body>
    </html>
  );
}
