import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

export const metadata: Metadata = { title: "ANDA Dashboard", description: "Argentine Neighborhood Development Association meeting operations dashboard" };
const themeScript = `(function(){try{var t=localStorage.getItem('board-theme');document.documentElement.dataset.theme=t==='board-dark'||t==='board-light'?t:'board-light'}catch(e){document.documentElement.dataset.theme='board-light'}})()`;
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" suppressHydrationWarning className={`${dmSans.variable} font-sans`}><head><script dangerouslySetInnerHTML={{__html:themeScript}}/></head><body>{children}</body></html>; }
