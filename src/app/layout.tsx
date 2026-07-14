import type { Metadata } from "next";
import { Theme } from "@radix-ui/themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portable Network Archive",
  description:
    "A desktop app for creating and browsing Portable Network Archives",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Theme appearance="light" accentColor="blue" grayColor="slate">
          {children}
        </Theme>
      </body>
    </html>
  );
}
