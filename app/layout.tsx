import type { Metadata } from "next";
import { Press_Start_2P } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const pixel = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
});

export const metadata: Metadata = {
  title: "Roundtable Melee",
  description: "Raid Guild multiplayer dungeon melee.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className={pixel.variable}>{children}</body>
    </html>
  );
}
