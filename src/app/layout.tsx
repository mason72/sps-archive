import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SPS Archive",
  description: "AI-powered photo archive for professional photographers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white font-sans text-stone-900 antialiased">
        {children}
      </body>
    </html>
  );
}
