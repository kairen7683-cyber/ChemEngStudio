import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Refund Policy — ChemPlant Studio',
  description: '14-Day Full Refund Policy for ChemPlant Studio paid subscriptions.',
};

export default function RefundPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', color: '#0F172A', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <header style={{ background: '#0F172A', color: '#F8FAFC', padding: '14px 24px', borderBottom: '1px solid #1E293B' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/" style={{ color: '#F8FAFC', textDecoration: 'none', fontWeight: 900, fontSize: 15 }}>
            ChemPlant Studio
          </Link>
          <Link href="/" style={{ color: '#93C5FD', textDecoration: 'none', fontSize: 12.5, fontWeight: 700 }}>
            ← Back to Home
          </Link>
        </div>
      </header>
      <main style={{ maxWidth: 820, margin: '0 auto', padding: '36px 24px 64px' }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, margin: '0 0 6px' }}>14-Day Refund Policy</h1>
        <p style={{ fontSize: 12.5, color: '#64748B', margin: '0 0 28px', fontFamily: 'JetBrains Mono, monospace' }}>
          Effective Date: November 2026 · https://chemplantstudio.com
        </p>

        <section style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 18, fontSize: 13.5, lineHeight: 1.7, color: '#334155' }}>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>1. 14-Day Full Refund Guarantee</h2>
            <p style={{ margin: 0 }}>
              All new paid subscriptions (Pro Engineer Monthly/Annual and Team / Enterprise plans) are covered by a <strong>14-day, no-questions-asked full refund guarantee</strong> from the date of initial purchase.
            </p>
          </div>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>2. How to Request a Refund</h2>
            <p style={{ margin: 0 }}>
              Email{' '}
              <a href="mailto:support@chemplantstudio.com" style={{ color: '#1E3A8A', fontWeight: 700 }}>
                support@chemplantstudio.com
              </a>{' '}
              with your order reference number and account email/username. Approved refunds are processed back to the original payment method within 2 business days.
            </p>
          </div>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: '#0F172A', margin: '0 0 6px' }}>3. Cancellation Anytime</h2>
            <p style={{ margin: 0 }}>
              After 14 days, you may cancel auto-renewal at any time to stop future billing while retaining full access through the end of your current paid billing period.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
