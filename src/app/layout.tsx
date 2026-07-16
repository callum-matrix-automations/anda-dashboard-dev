import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "ANDA Dashboard", description: "Argentine Neighborhood Development Association meeting operations dashboard" };
const themeScript = `(function(){try{var t=localStorage.getItem('board-theme');var d=t==='board-dark'||t==='board-light'?t:(matchMedia('(prefers-color-scheme: dark)').matches?'board-dark':'board-light');document.documentElement.dataset.theme=d}catch(e){document.documentElement.dataset.theme='board-light'}})()`;
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeScript}}/></head><body>{children}</body></html>; }
