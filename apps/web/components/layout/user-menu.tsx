'use client';

import { LogOut } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deconnexion } from '@/app/(auth)/login/actions';

export function UserMenu({
  nomComplet,
  email,
  libelleRole,
  avatarUrl,
}: {
  nomComplet: string;
  email: string;
  libelleRole: string;
  avatarUrl: string | null;
}) {
  const initiales =
    nomComplet
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((mot) => mot[0]?.toUpperCase() ?? '')
      .join('') || email[0]?.toUpperCase() || '?';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2">
          <Avatar className="h-7 w-7">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-xs">{initiales}</AvatarFallback>
          </Avatar>
          <span className="hidden text-sm sm:inline">{nomComplet}</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium">{nomComplet}</p>
            <p className="text-xs text-muted-foreground">{email}</p>
            <p className="text-xs text-muted-foreground">{libelleRole}</p>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <form action={deconnexion}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              Se déconnecter
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
