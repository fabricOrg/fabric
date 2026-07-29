"use client";

import type { ProviderCostRateDto } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

const WILDCARD = "*";

export function ProviderCostManager({
  rates,
  canManage,
}: {
  rates: readonly ProviderCostRateDto[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [vendor, setVendor] = useState("arkesel-sms");
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [country, setCountry] = useState(WILDCARD);
  const [trafficClass, setTrafficClass] = useState(WILDCARD);
  const [currency, setCurrency] = useState<"GHS" | "NGN" | "USD">("GHS");
  const [numerator, setNumerator] = useState("");
  const [denominator, setDenominator] = useState("1");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const valid =
    vendor.trim().length > 0 &&
    /^[1-9]\d*$/.test(numerator) &&
    /^[1-9]\d*$/.test(denominator) &&
    source.trim().length > 0;

  async function publish() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/provider-costs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider_vendor: vendor.trim(),
          channel,
          destination_country: country === WILDCARD ? null : country,
          traffic_class: trafficClass === WILDCARD ? null : trafficClass,
          currency,
          numerator_minor: numerator,
          denominator,
          source_reference: source.trim(),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          payload?.error?.message ?? "Couldn't publish provider cost.",
        );
      }
      toast.success("Provider cost published");
      setNumerator("");
      setSource("");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't publish provider cost.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-lg font-semibold">Provider costs</h2>
        <p className="text-sm text-muted-foreground">
          Exact upstream cost ratios. Publishing closes the prior matching rate;
          live sends enforce the price book&apos;s margin floor.
        </p>
      </div>
      {canManage ? (
        <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-4">
          <Input
            aria-label="Provider slug"
            value={vendor}
            onChange={(event) => setVendor(event.target.value)}
            placeholder="Provider slug"
          />
          <Select
            value={channel}
            onValueChange={(value) => setChannel(value as "sms" | "email")}
          >
            <SelectTrigger aria-label="Channel">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sms">SMS / segment</SelectItem>
              <SelectItem value="email">Email / recipient</SelectItem>
            </SelectContent>
          </Select>
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger aria-label="Destination">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WILDCARD}>Any destination</SelectItem>
              <SelectItem value="GH">Ghana</SelectItem>
              <SelectItem value="NG">Nigeria</SelectItem>
            </SelectContent>
          </Select>
          <Select value={trafficClass} onValueChange={setTrafficClass}>
            <SelectTrigger aria-label="Traffic class">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WILDCARD}>Any class</SelectItem>
              <SelectItem value="transactional">Transactional</SelectItem>
              <SelectItem value="promotional">Promotional</SelectItem>
              <SelectItem value="otp">OTP</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={currency}
            onValueChange={(value) =>
              setCurrency(value as "GHS" | "NGN" | "USD")
            }
          >
            <SelectTrigger aria-label="Currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GHS">GHS</SelectItem>
              <SelectItem value="NGN">NGN</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
            </SelectContent>
          </Select>
          <Input
            aria-label="Cost numerator in minor units"
            inputMode="numeric"
            value={numerator}
            onChange={(event) => setNumerator(event.target.value)}
            placeholder="Numerator minor"
          />
          <Input
            aria-label="Cost denominator"
            inputMode="numeric"
            value={denominator}
            onChange={(event) => setDenominator(event.target.value)}
            placeholder="Denominator"
          />
          <Input
            aria-label="Source reference"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="Contract/rate-card reference"
          />
          <Button disabled={!valid} loading={busy} onClick={publish}>
            Publish cost
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left">
            <tr>
              <th className="p-3">Provider</th>
              <th className="p-3">Scope</th>
              <th className="p-3">Exact cost</th>
              <th className="p-3">Effective</th>
              <th className="p-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((rate) => (
              <tr key={rate.id} className="border-b last:border-0">
                <td className="p-3">{rate.provider_vendor}</td>
                <td className="p-3">
                  {rate.channel} · {rate.destination_country ?? "any"} ·{" "}
                  {rate.traffic_class ?? "any"}
                </td>
                <td className="p-3 font-mono">
                  {rate.numerator_minor}/{rate.denominator} {rate.currency}
                </td>
                <td className="p-3">
                  {new Date(rate.effective_from).toLocaleString()}
                  {rate.effective_to ? " · retired" : " · active"}
                </td>
                <td className="p-3">{rate.source_reference}</td>
              </tr>
            ))}
            {rates.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="p-6 text-center text-muted-foreground"
                >
                  No provider costs configured. Live sends fail closed.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
