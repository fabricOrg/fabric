"use client";

import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@app/ui/components/ui/tabs";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { getInlineTestKey } from "@/lib/mock-api";
import { REFERENCE_ENDPOINTS, type SampleLang } from "@/lib/reference-data";

const LANGS: readonly { id: SampleLang; label: string }[] = [
  { id: "curl", label: "cURL" },
  { id: "node", label: "Node" },
  { id: "python", label: "Python" },
];

export default function ReferencePage() {
  const [selectedId, setSelectedId] = useState(
    REFERENCE_ENDPOINTS[0]?.id ?? "",
  );
  const [lang, setLang] = useState<SampleLang>("curl");
  const [testKey, setTestKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    getInlineTestKey().then((k) => {
      if (live) setTestKey(k);
    });
    return () => {
      live = false;
    };
  }, []);

  const selected =
    REFERENCE_ENDPOINTS.find((e) => e.id === selectedId) ??
    REFERENCE_ENDPOINTS[0];
  if (!selected) return null;
  const sample = selected.samples[lang].replaceAll(
    "{{TEST_KEY}}",
    testKey ?? "sk_test_…",
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          API reference
        </h1>
        <p className="text-sm text-muted-foreground">
          Code samples use your own test key — copy-paste to a working call.
          Never charges or sends.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[190px_minmax(0,1fr)_minmax(0,380px)]">
        {/* nav */}
        <nav aria-label="Endpoints" className="flex flex-col gap-1">
          {REFERENCE_ENDPOINTS.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setSelectedId(e.id)}
              aria-current={e.id === selectedId}
              className={`flex flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm ${
                e.id === selectedId
                  ? "bg-muted font-medium"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              <span className="font-mono text-xs">{e.method}</span>
              <span className="font-mono text-xs break-all">{e.path}</span>
            </button>
          ))}
        </nav>

        {/* content */}
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {selected.method}
            </Badge>
            <code className="font-mono text-sm break-all">{selected.path}</code>
          </div>
          <p className="text-sm text-muted-foreground">{selected.summary}</p>

          {selected.params.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Required</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selected.params.map((p) => (
                    <TableRow key={p.name}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-mono text-sm">{p.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {p.description}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {p.type}
                      </TableCell>
                      <TableCell>
                        {p.required ? (
                          <Badge variant="secondary" className="text-xs">
                            Required
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Optional
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Response
            </span>
            <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
              {selected.response}
            </pre>
          </div>
        </section>

        {/* code samples */}
        <aside className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Tabs value={lang} onValueChange={(v) => setLang(v as SampleLang)}>
              <TabsList>
                {LANGS.map((l) => (
                  <TabsTrigger key={l.id} value={l.id}>
                    {l.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy code sample"
              onClick={() => {
                navigator.clipboard?.writeText(sample);
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
            {sample}
          </pre>
          <p className="text-xs text-muted-foreground">
            Your <span className="font-mono">sk_test_</span> key is inlined
            above, fetched per session — never stored in the page.
          </p>
        </aside>
      </div>
    </div>
  );
}
