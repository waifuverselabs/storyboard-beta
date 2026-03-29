import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Video Stitcher",
  description:
    "Drag, drop, and stitch videos together — all in your browser. No uploads.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
