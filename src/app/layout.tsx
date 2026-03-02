import type { Metadata } from "next";
import {
  Inter,
  Playfair_Display,
  Libre_Baskerville,
  Cormorant_Garamond,
  DM_Serif_Display,
  Space_Grotesk,
  Source_Serif_4,
  Lora,
  DM_Sans,
} from "next/font/google";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ToasterProvider } from "@/components/ui/ToasterProvider";
import { CommandPalette } from "@/components/command/CommandPalette";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
  weight: ["400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
});

const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  variable: "--font-libre-baskerville",
  display: "swap",
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

// Gallery typography fonts (loaded on demand via CSS variable)
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  variable: "--font-cormorant",
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const dmSerif = DM_Serif_Display({
  subsets: ["latin"],
  variable: "--font-dm-serif",
  display: "swap",
  weight: "400",
  style: ["normal", "italic"],
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Pixeltrunk — Intelligent Photo Archive",
  description:
    "AI-powered photo organization for professional photographers. Upload thousands of images and let AI organize them into smart stacks, searchable sections, and shareable galleries.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable} ${libreBaskerville.variable} ${cormorant.variable} ${dmSerif.variable} ${spaceGrotesk.variable} ${sourceSerif.variable} ${lora.variable} ${dmSans.variable}`}>
      <body className="min-h-screen bg-white font-sans text-stone-900 antialiased">
        <AuthProvider initialUser={user}>
          {children}
        </AuthProvider>
        <ToasterProvider />
        <CommandPalette />
      </body>
    </html>
  );
}
