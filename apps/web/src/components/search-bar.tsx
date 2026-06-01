'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Search } from 'lucide-react';

export function SearchBar({ initial = '' }: { initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
      className="flex w-full max-w-2xl items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--background)] px-4 py-2 shadow-sm"
    >
      <Search className="h-5 w-5 text-[var(--muted-foreground)]" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search for a product, e.g. hockey stick"
        className="flex-1 bg-transparent text-sm outline-none"
      />
      <button
        type="submit"
        className="rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white"
      >
        Search
      </button>
    </form>
  );
}
