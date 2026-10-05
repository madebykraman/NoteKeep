import type { Metadata } from "next";
import { GeistSans, GeistMono } from "geist/font/sans";
import "geist/dist/geist.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "NoteKeep",
  description: "A local-first knowledge base with visual notes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
