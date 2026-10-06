import type { Metadata } from "next";
import "./globals.css";
import "./accord-theme.css";

export const metadata: Metadata = {
  title: "Accord — Personal agents. Shared purpose.",
  description: "Personal agents. Shared purpose. Bring context together with people you trust, and choose what guidance carries forward.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased accord-neo">{children}</body>
    </html>
  );
}
