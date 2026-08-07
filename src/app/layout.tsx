import type { Metadata } from "next";
import "./globals.css";
import { AgentProvider } from "../context/AgentContext";

export const metadata: Metadata = {
  title: "AETHRA AI - The Autonomous AI Technology Analyst",
  description: "Continuous technology and systems architecture analytics driven by Dr. Nova.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col bg-[#050816] text-white">
        <AgentProvider>
          {children}
        </AgentProvider>
      </body>
    </html>
  );
}
