"use client";

import { Avatar, AvatarFallback } from "@app/ui/components/ui/avatar";
import { Button } from "@app/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@app/ui/components/ui/dropdown-menu";
import { LogOut, UserRound } from "lucide-react";

function initials(value?: string) {
  return value?.trim().charAt(0).toUpperCase() || "F";
}

export function UserMenu({
  email,
  name,
  role,
  profileHref = "/profile",
  logoutAction = "/auth/logout",
}: {
  email?: string;
  name?: string;
  role: string;
  profileHref?: string;
  logoutAction?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="Open account menu"
        >
          <Avatar>
            <AvatarFallback>{initials(name ?? email)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate">{name ?? email ?? "Fabric user"}</span>
          {name && email ? (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {email}
            </span>
          ) : null}
          <span className="text-xs font-normal capitalize text-muted-foreground">
            {role}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href={profileHref}>
            <UserRound />
            Profile
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={logoutAction} method="post">
          <DropdownMenuItem asChild variant="destructive">
            <button type="submit" className="w-full">
              <LogOut />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
