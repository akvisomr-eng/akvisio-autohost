import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AKVISIO Autohost | AI Customer Host",
  description: "AI Host dan platform operasi pelanggan multi-tenant dari AKVISIO.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
