import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { PRODUCT } from "@/lib/product";

// Perplexity-style editorial serif for answer/reading text.
const serif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-read",
  display: "swap",
});

export const metadata: Metadata = {
  title: PRODUCT.name,
  description: "A multi-model workspace that plans, routes, builds, and verifies software.",
  applicationName: PRODUCT.name,
  icons: {
    icon: [{ url: "/hyzr-chat-mark.svg?v=4", type: "image/svg+xml" }],
    shortcut: "/hyzr-chat-mark.svg?v=4",
    apple: "/hyzr-chat-mark.svg?v=4",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${serif.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
