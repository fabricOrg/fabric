"use client";

import { cn } from "@app/ui/lib/utils";
import * as React from "react";
import { ResponsiveContainer } from "recharts";

/**
 * Minimal chart primitive for the design system. `config` maps each series key to a label + a color;
 * the color is injected as a `--color-<key>` CSS variable on the container, so Recharts children
 * reference `var(--color-<key>)` and stay theme-aware (light/dark) via our --chart-* tokens.
 * Recharts-3 compatible. Give the container an explicit height class (e.g. `h-56`).
 */
export interface ChartSeries {
  readonly label?: string;
  readonly color?: string;
}
export type ChartConfig = Record<string, ChartSeries>;

const ChartContext = React.createContext<ChartConfig>({});

export function useChartConfig(): ChartConfig {
  return React.useContext(ChartContext);
}

export function ChartContainer({
  config,
  className,
  children,
}: {
  config: ChartConfig;
  className?: string;
  children: React.ReactElement;
}) {
  const style = React.useMemo(() => {
    const vars: Record<string, string> = {};
    for (const [key, series] of Object.entries(config)) {
      if (series.color) vars[`--color-${key}`] = series.color;
    }
    return vars as React.CSSProperties;
  }, [config]);

  return (
    <ChartContext.Provider value={config}>
      <div
        data-slot="chart"
        style={style}
        className={cn(
          "w-full text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/60 [&_.recharts-surface]:outline-none",
          className,
        )}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}
