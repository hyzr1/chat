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

// Apply the saved theme before first paint so a dark-theme user isn't flashed
// with the light default while the app boots. Runs synchronously in <head>.
const THEME_INIT = `(function(){try{var r=localStorage.getItem('hyzr.chat.prefs')||localStorage.getItem('vmx.prefs');var t=r?JSON.parse(r).theme:null;if(t==='system'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}if(t!=='dark'&&t!=='light'){t='light';}var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t;}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${serif.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
