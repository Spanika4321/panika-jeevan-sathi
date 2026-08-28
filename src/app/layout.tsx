import type { Metadata, Viewport } from "next";
import "./globals.css";
import { APP_NAME, SITE_URL } from "@/lib/constants";
import { Footer, Header, WhatsAppFab } from "@/components/site-chrome";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${APP_NAME} — 100% Free Matrimonial Website`,
    template: `%s | ${APP_NAME}`,
  },
  description:
    "Find your life partner on PANIKA JEEVAN SATHI — India's trusted 100% free matrimonial platform. Genuine profiles, smart search, recommended matches and private messaging. No memberships, ever.",
  keywords: ["matrimony", "matrimonial", "free matrimony", "India matrimony", "marriage", "life partner", "jeevan sathi"],
  openGraph: {
    title: `${APP_NAME} — Find a life partner, 100% free`,
    description: "Genuine profiles, recommended matches and private messaging — completely free, forever.",
    url: SITE_URL,
    siteName: APP_NAME,
    locale: "en_IN",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#123530",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Manrope:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='20' cy='26' r='13' stroke='%231D5649' stroke-width='4' fill='none'/%3E%3Ccircle cx='29' cy='22' r='13' stroke='%23F7941D' stroke-width='4' fill='none'/%3E%3C/svg%3E"
        />
      </head>
      <body className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <WhatsAppFab />
      </body>
    </html>
  );
}
