import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "White Collar Realty CRM",
    short_name: "WCR CRM",
    description: "Sales command center for White Collar Realty — Dubai & India teams",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b1a33",
    theme_color: "#0b1a33",
    categories: ["business", "productivity"],
    lang: "en",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "New Lead",   short_name: "New", url: "/leads/new", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Pipeline",   short_name: "Pipe", url: "/pipeline", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "AI Assistant", short_name: "AI",  url: "/ai",      icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
