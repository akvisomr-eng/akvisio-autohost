import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sans Rent Cars | Rental Operations",
  description: "Dashboard operasional rental mobil Sans Rent Cars.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
