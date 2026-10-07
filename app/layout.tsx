import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Busflow — Bus Movement Simulator",
  description: "Live bus movement, disruption controls, and a shared position API for testing scheduling planners.",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
