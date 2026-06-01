'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  TrendingDown,
  PackagePlus,
  Boxes,
  Search,
  Tags,
  Building2,
  Bell,
  CreditCard,
  Activity,
} from 'lucide-react';
import { cn } from '@retailer/ui';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/price-changes', label: 'Price changes', icon: TrendingDown },
  { href: '/new-products', label: 'New products', icon: PackagePlus },
  { href: '/inventory', label: 'Inventory alerts', icon: Boxes },
  { href: '/seo', label: 'SEO gaps', icon: Search },
  { href: '/brands', label: 'Brand trends', icon: Tags },
  { href: '/competitors', label: 'Competitors', icon: Building2 },
  { href: '/alerts', label: 'Alerts', icon: Bell },
  { href: '/status', label: 'System status', icon: Activity },
  { href: '/billing', label: 'Billing', icon: CreditCard },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--muted)] p-4">
      <div className="mb-6 px-2 text-lg font-bold">
        Ret<span className="text-brand-600">AI</span>ler
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-brand-600 text-white'
                  : 'text-[var(--muted-foreground)] hover:bg-[var(--background)]',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
