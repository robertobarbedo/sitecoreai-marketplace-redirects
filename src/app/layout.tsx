import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Latin variable fonts from Google Fonts, committed in ./fonts so the build
// never fetches from Google (a bad Google response broke a Vercel build with
// "Cannot read properties of null (reading '1')" in next/font/google).
const inter = localFont({
  src: "./fonts/inter-latin-var.woff2",
  weight: "400 800",
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-var.woff2",
  weight: "400 500",
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Redirect Manager",
  description:
    "SitecoreAI Marketplace app: create, edit and test the redirect items of your SXA sites",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans text-sm antialiased overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
