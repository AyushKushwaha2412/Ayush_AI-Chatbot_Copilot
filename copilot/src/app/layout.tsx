import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Conversation Copilot — private reply assistant',
  description:
    'A private WhatsApp-style assistant that drafts natural replies in your own voice, with approval workflow and local-first AI.',
};

export const viewport = {
  themeColor: '#0b141a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <AppShell>{children}</AppShell>
        </ToastProvider>
      </body>
    </html>
  );
}
