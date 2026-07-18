"use client";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@app/ui/components/ui/input-group";
import { Label } from "@app/ui/components/ui/label";
import { Eye, EyeOff, Mail } from "lucide-react";
import { type ReactNode, useState } from "react";

/** ADR-0008 polished auth inputs: labelled, icon-adorned, with a password reveal toggle. */

export function EmailField({
  id = "email",
  label = "Email",
  value,
  onChange,
  disabled,
  autoFocus,
  placeholder = "you@company.com",
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <InputGroup className="h-11">
        <InputGroupAddon>
          <Mail aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          name={id}
          type="email"
          autoComplete="email"
          placeholder={placeholder}
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
      </InputGroup>
    </div>
  );
}

export function PasswordField({
  id = "password",
  label = "Password",
  value,
  onChange,
  disabled,
  autoComplete = "current-password",
  placeholder = "Enter your password",
  headerAction,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoComplete?: "current-password" | "new-password";
  placeholder?: string;
  /** Optional right-aligned control next to the label (e.g. "Forgot password?"). */
  headerAction?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {headerAction}
      </div>
      <InputGroup className="h-11">
        <InputGroupInput
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="button"
            size="icon-xs"
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
            disabled={disabled}
          >
            {visible ? (
              <EyeOff aria-hidden="true" />
            ) : (
              <Eye aria-hidden="true" />
            )}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
