import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Atende | Conversas", description: "Central de mensagens conectada ao WhatsApp.", icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="pt-BR"><body>{children}</body></html>; }
