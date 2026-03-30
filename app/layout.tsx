import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Storyboard — Browser Video Editor",
  description:
    "Client-side video editor. Import clips, arrange on timeline, add audio, export to MP4. No uploads.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
