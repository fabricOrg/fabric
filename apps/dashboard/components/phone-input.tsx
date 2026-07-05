"use client";

import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { useState } from "react";

interface Country {
  readonly code: string;
  readonly name: string;
  readonly dial: string;
  readonly flag: string;
}

// Launch markets first (see PI-3 vendor/region decisions), then common destinations.
const COUNTRIES: readonly Country[] = [
  { code: "GH", name: "Ghana", dial: "233", flag: "🇬🇭" },
  { code: "NG", name: "Nigeria", dial: "234", flag: "🇳🇬" },
  { code: "KE", name: "Kenya", dial: "254", flag: "🇰🇪" },
  { code: "ZA", name: "South Africa", dial: "27", flag: "🇿🇦" },
  { code: "CI", name: "Côte d'Ivoire", dial: "225", flag: "🇨🇮" },
  { code: "SN", name: "Senegal", dial: "221", flag: "🇸🇳" },
  { code: "EG", name: "Egypt", dial: "20", flag: "🇪🇬" },
  { code: "GB", name: "United Kingdom", dial: "44", flag: "🇬🇧" },
  { code: "US", name: "United States", dial: "1", flag: "🇺🇸" },
];

const DEFAULT_COUNTRY = "GH";

function dialOf(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.dial ?? "233";
}

/** national number → E.164: strip non-digits, drop the local trunk "0", prepend +dial. */
function toE164(dial: string, national: string): string {
  const digits = national.replace(/\D/g, "").replace(/^0+/, "");
  return digits ? `+${dial}${digits}` : "";
}

/** Pick the country whose dial code prefixes the given E.164 (longest match wins, e.g. 233 vs 27). */
function countryFromE164(value: string): Country | undefined {
  return [...COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => value.startsWith(`+${c.dial}`));
}

/**
 * Phone field with a country selector — the user types their LOCAL number and we assemble the E.164.
 * `value`/`onChange` speak E.164 so callers keep validating against one canonical shape.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  invalid,
  placeholder = "020 123 4567",
}: {
  id?: string;
  value: string;
  onChange: (e164: string) => void;
  invalid?: boolean;
  placeholder?: string;
}) {
  const initial = countryFromE164(value);
  const [country, setCountry] = useState(initial?.code ?? DEFAULT_COUNTRY);
  const [national, setNational] = useState(
    initial ? value.slice(initial.dial.length + 1) : "",
  );

  function onCountry(next: string) {
    setCountry(next);
    onChange(toE164(dialOf(next), national));
  }

  function onNational(next: string) {
    setNational(next);
    onChange(toE164(dialOf(country), next));
  }

  return (
    <div className="flex gap-2">
      <Select value={country} onValueChange={onCountry}>
        <SelectTrigger
          className="w-[6.5rem] shrink-0"
          aria-label="Country code"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COUNTRIES.map((c) => (
            <SelectItem
              key={c.code}
              value={c.code}
              textValue={`${c.name} +${c.dial}`}
            >
              <span className="mr-1.5">{c.flag}</span>
              <span className="font-mono">+{c.dial}</span>
              <span className="ml-2 text-muted-foreground">{c.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        id={id}
        inputMode="tel"
        autoComplete="tel-national"
        placeholder={placeholder}
        value={national}
        onChange={(e) => onNational(e.target.value)}
        aria-invalid={invalid || undefined}
        className="flex-1 font-mono tabular-nums"
      />
    </div>
  );
}
