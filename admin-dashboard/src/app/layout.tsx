import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

// خطوط عربية محلية (بلا اعتماد على CDN خارجي)
const cairo = localFont({
  src: [{ path: "../../public/fonts/Cairo.ttf", weight: "200 900", style: "normal" }],
  variable: "--font-cairo",
  display: "swap",
});

const tajawal = localFont({
  src: [
    { path: "../../public/fonts/Tajawal-Regular.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/Tajawal-Medium.ttf", weight: "500", style: "normal" },
    { path: "../../public/fonts/Tajawal-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-tajawal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "نظام الأعمال المحاسبي — ERP مزدوج القيد",
  description:
    "نظام محاسبي وإداري مؤسسي بنظام القيد المزدوج: شجرة حسابات، قيود يومية، فواتير بضريبة، سندات قبض، خزائن وبنوك، مسيرات رواتب، وقوائم مالية كاملة.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body
        className={`${cairo.variable} ${tajawal.variable} antialiased bg-background text-foreground font-[family-name:var(--font-cairo)]`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
