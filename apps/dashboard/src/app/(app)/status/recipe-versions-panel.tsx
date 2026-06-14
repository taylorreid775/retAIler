'use client';

import { useState, useTransition } from 'react';
import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@retailer/ui';
import {
  listRecipeVersions,
  rollbackToRecipeVersion,
  type RecipeVersionRow,
} from './recipe-actions';

export function RecipeVersionsPanel({
  retailerId,
  retailerName,
  crawlHealthScore,
}: {
  retailerId: string;
  retailerName: string;
  crawlHealthScore: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<RecipeVersionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const result = await listRecipeVersions(retailerId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setVersions(result.versions ?? []);
      setOpen(true);
      setError(null);
    });
  };

  const rollback = (version: number) => {
    if (!confirm(`Rollback ${retailerName} to recipe v${version}?`)) return;
    startTransition(async () => {
      const result = await rollbackToRecipeVersion(retailerId, version);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      load();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={pending}>
          Recipe versions
        </Button>
        {crawlHealthScore != null ? (
          <Badge variant={crawlHealthScore >= 0.7 ? 'success' : crawlHealthScore >= 0.4 ? 'warning' : 'danger'}>
            Health {crawlHealthScore.toFixed(2)}
          </Badge>
        ) : null}
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {open && versions.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ver</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>By</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v) => (
              <TableRow key={v.version}>
                <TableCell>v{v.version}</TableCell>
                <TableCell>{v.confidence.toFixed(2)}</TableCell>
                <TableCell className="max-w-[200px] truncate text-xs">{v.primaryEndpoint}</TableCell>
                <TableCell>{v.createdBy}</TableCell>
                <TableCell>
                  {v.version < versions[0]!.version ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => rollback(v.version)}
                    >
                      Rollback
                    </Button>
                  ) : (
                    <span className="text-xs text-[var(--muted-foreground)]">active</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  );
}
