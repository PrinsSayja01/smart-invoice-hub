import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Leaf, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

type Row = {
  id: string;
  vendor_name: string | null;
  total_amount: number | null;
  currency: string | null;
  esg_category: string | null;
  co2e_estimate: number | null;
};

export default function ESGDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("invoices")
      .select("id,vendor_name,total_amount,currency,esg_category,co2e_estimate")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      toast({ variant: "destructive", title: "Failed to load ESG", description: error.message });
    } else {
      setRows((data as Row[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const mapOne = async (invoiceId: string) => {
    const { error } = await supabase.functions.invoke("esg-map", { body: { invoiceId } });
    if (error) {
      toast({ variant: "destructive", title: "ESG mapping failed", description: error.message });
      return;
    }
    toast({ title: "ESG updated", description: "CO₂e estimate stored on invoice." });
    load();
  };

  const total = rows.reduce((s, r) => s + Number(r.co2e_estimate ?? 0), 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold">ESG & Emissions</h1>
            <p className="text-muted-foreground mt-1">Map invoices to estimated CO₂e emissions.</p>
          </div>
          <Button variant="outline" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-2" /> Refresh
          </Button>
        </div>

        <Card className="glass-card">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Leaf className="h-5 w-5 text-success" />
              <p className="font-medium">Total CO₂e</p>
            </div>
            <p className="text-lg font-semibold tabular-nums">{total.toFixed(2)} kg</p>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardContent className="p-4">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : rows.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">No invoices yet.</div>
            ) : (
              <div className="space-y-3">
                {rows.slice(0, 30).map((r) => (
                  <div key={r.id} className="p-4 rounded-lg border bg-card flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{r.vendor_name || "Unknown Vendor"}</p>
                      <p className="text-sm text-muted-foreground">
                        Category: {r.esg_category || "—"} • CO₂e: {r.co2e_estimate != null ? r.co2e_estimate.toFixed(2) : "—"} kg
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => mapOne(r.id)}>
                      Map
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
