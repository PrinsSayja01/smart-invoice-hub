import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Row = {
  id: string;
  vendor_name: string | null;
  invoice_number: string | null;
  total_amount: number | null;
  currency: string | null;
  fraud_score: number | null;
  anomaly_flags: string[] | null;
  created_at: string;
};

export default function FraudCenter() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("invoices")
      .select("id,vendor_name,invoice_number,total_amount,currency,fraud_score,anomaly_flags,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      toast({ variant: "destructive", title: "Failed to load", description: error.message });
    } else {
      const filtered = (data as Row[]).filter((r) => (r.fraud_score ?? 0) >= 0.3 || (r.anomaly_flags?.length ?? 0) > 0);
      setRows(filtered);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const runRisk = async (invoiceId: string) => {
    const { error } = await supabase.functions.invoke("risk-check", { body: { invoiceId } });
    if (error) {
      toast({ variant: "destructive", title: "Risk check failed", description: error.message });
      return;
    }
    toast({ title: "Risk updated", description: "Recomputed fraud score and flags." });
    load();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold">Fraud Center</h1>
            <p className="text-muted-foreground mt-1">
              Duplicate, anomaly, and fraud signals across your documents.
            </p>
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
            ) : rows.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                No suspicious invoices yet.
              </div>
            ) : (
              <div className="space-y-3">
                {rows.map((r) => (
                  <div key={r.id} className="p-4 rounded-lg border bg-card flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-warning" />
                        <p className="font-medium">{r.vendor_name || "Unknown Vendor"}</p>
                        <Badge variant="secondary">
                          Fraud {((r.fraud_score ?? 0) * 100).toFixed(0)}%
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        #{r.invoice_number || "-"} • {(r.currency || "€")} {Number(r.total_amount ?? 0).toLocaleString()}
                      </p>
                      {!!(r.anomaly_flags?.length) && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Flags: {r.anomaly_flags!.join(", ")}
                        </p>
                      )}
                    </div>
                    <Button size="sm" onClick={() => runRisk(r.id)}>Re-check</Button>
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
