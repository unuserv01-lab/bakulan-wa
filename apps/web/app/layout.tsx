import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ThemeProvider } from "../lib/theme";
import BottomNav from "../components/BottomNav";
import ThemeToggle from "../components/ThemeToggle";

export const metadata: Metadata = {
  title: "Bakulan WA",
  description: "Dashboard PWA WhatsApp AI auto-reply untuk UMKM",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#16a34a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <div className="shell">
            <header className="topbar">
              <span className="brand">Bakulan WA</span>
              <ThemeToggle />
            </header>
            <main>{children}</main>
          </div>
          <BottomNav />
        </ThemeProvider>
      </body>
    </html>
  );
}
