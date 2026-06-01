import { OrganizationSwitcher, UserButton } from '@clerk/nextjs';
import { Sidebar } from '@/components/sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-[var(--border)] px-6">
          <OrganizationSwitcher
            hidePersonal
            afterCreateOrganizationUrl="/"
            afterSelectOrganizationUrl="/"
          />
          <UserButton />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
