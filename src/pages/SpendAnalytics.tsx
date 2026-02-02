import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Analytics = {
  byVendor: Record<string, number>;
  byMonth: Record<string, number>;
  byCategory: Record<string, number>;
  forecastNextMonth: number;
};

export default function SpendAnalytics() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Analytics | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("spend-analytics", { method: "GET" as any });
    if (error) {
      toast({ variant: "destructive", title: "Failed to load analytics", description: error.message });
      setLoading(false);
      return;
    }
    setData(data as Analytics);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topEntries = (obj: Record<string, number>, n = 8) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold">Spend Analytics</h1>
            <p className="text-muted-foreground mt-1">Spend cube breakdown and simple forecasting.</p>
          </div>
          <Button variant="outline" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        <Card className="glass-card">
          <CardContent className="p-4">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : !data ? (
              <div className="text-center py-10 text-muted-foreground">No analytics data.</div>
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-2">Top Vendors</h3>
                  <div className="space-y-2">
                    {topEntries(data.byVendor).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between text-sm">
                        <span className="truncate mr-2">{k}</span>
                        <span className="tabular-nums">{v.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Top Categories</h3>
                  <div className="space-y-2">
                    {topEntries(data.byCategory).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between text-sm">
                        <span className="truncate mr-2">{k}</span>
                        <span className="tabular-nums">{v.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <h3 className="font-semibold mb-2">Monthly Spend</h3>
                  <div className="space-y-2">
                    {Object.entries(data.byMonth)
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between text-sm">
                          <span className="truncate mr-2">{k}</span>
                          <span className="tabular-nums">{v.toLocaleString()}</span>
                        </div>
                      ))}
                  </div>
                  <div className="mt-4 text-sm text-muted-foreground">
                    Forecast (next month): <span className="font-medium text-foreground">{data.forecastNextMonth.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
