import type { Metadata } from "next";
import { connection } from "next/server";
import { Hanken_Grotesk, Story_Script, Ibarra_Real_Nova } from "next/font/google";
import "./globals.css";
import { KeyboardGuard } from "@/components/KeyboardGuard";

// next/font/google self-hosts at build time (no runtime request to Google's CDN,
// unlike the original's <link> tag) — same fonts, better for a self-hosted tool.
const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken-grotesk",
  subsets: ["latin"],
});

const storyScript = Story_Script({
  variable: "--font-story-script",
  weight: "400",
  subsets: ["latin"],
});

const ibarraRealNova = Ibarra_Real_Nova({
  variable: "--font-ibarra-real-nova",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AwayAgent",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Rendered per request so Next can stamp proxy.ts's CSP nonce on its scripts.
  await connection();
  return (
    <html
      lang="en"
      className={`${hankenGrotesk.variable} ${storyScript.variable} ${ibarraRealNova.variable} h-full`}
      style={{ colorScheme: "dark" }}
    >
      <body className="h-full m-0 p-2 flex">
        <KeyboardGuard />
        {children}
      </body>
    </html>
  );
}
