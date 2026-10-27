import type { Metadata } from 'next';
import './globals.css';
import './motion.css';

export const metadata: Metadata = {
  title: { default: 'Oddhound — Find what you didn\'t test', template: '%s · Oddhound' },
  description: 'An exploratory testing agent that tries the unexpected things real users do, and proves what breaks.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
