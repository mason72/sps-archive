import type { Metadata } from "next";
import { Inter, Playfair_Display, Libre_Baskerville } from "next/font/google";
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
    <html lang="en" className={`${inter.variable} ${playfair.variable} ${libreBaskerville.variable}`}>
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
