import { useQuery } from '@tanstack/react-query';

import { fetchMe } from './api';

// One source of truth for the name the user gave their sidekick (the server
// profile's `sidekickName`). Every surface that shows the character's name
// should read it from here so renaming propagates everywhere. Falls back to the
// brand name until the user has set one.
export function useSidekickName(): string {
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  return me.data?.sidekickName?.trim() || 'Sidekick';
}

// DIAGNOSTIC (2026-07, Cade's audit): the name wrapped in brackets, e.g.
// "[Mochi]". Every surface that shows the sidekick's name renders THIS, so an
// unbracketed "Sidekick" you spot in the running app is a hardcoded string that
// was never wired to the name. To ship without the visible brackets later, just
// drop them from the two helpers below — every call site updates at once.
export function useSidekickDisplayName(): string {
  return `[${useSidekickName()}]`;
}

// Non-hook variant for code that already holds the raw name (e.g. the Screen
// Time shield copy, which is built outside React from a passed-in name).
export function sidekickDisplayName(raw: string | null | undefined): string {
  return `[${raw?.trim() || 'Sidekick'}]`;
}
