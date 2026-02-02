import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Loader2, QrCode, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Payment = {
  id: string;
  invoice_id: string | null;
  status: string;
  amount: number | null;
  currency: string | null;
  created_at: string;
};

type Invoice = {
  id: string;
  vendor_name: string | null;
  invoice_number: string | null;
  total_amount: number | null;
  currency: string | null;
  payment_qr_string: string | null;
};

export default function Payments() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  const load = async () => {
    if (!user) return;
    setLoading(true);

    const p = await supabase
      .from("payments")
      .select("id,invoice_id,status,amount,currency,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    const i = await supabase
      .from("invoices")
      .select("id,vendor_name,invoice_number,total_amount,currency,payment_qr_string")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (p.error) toast({ variant: "destructive", title: "Failed to load payments", description: p.error.message });
    if (i.error) toast({ variant: "destructive", title: "Failed to load invoices", description: i.error.message });

    setPayments((p.data as Payment[]) || []);
    setInvoices((i.data as Invoice[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const generateQR = async (invoiceId: string) => {
    const { data, error } = await supabase.functions.invoke("generate-qr", {
      body: { invoiceId, method: "sepa" },
    });
    if (error) {
      toast({ variant: "destructive", title: "QR generation failed", description: error.message });
      return;
    }
    toast({ title: "QR generated", description: "Payment payload stored on invoice." });
    await load();
    return data;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold">Payments</h1>
            <p className="text-muted-foreground mt-1">QR payload generation and payment tracking.</p>
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
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-2">Invoices (Generate QR)</h3>
                  <div className="space-y-3">
                    {invoices.slice(0, 15).map((inv) => (
                      <div key={inv.id} className="p-4 rounded-lg border bg-card flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium">{inv.vendor_name || "Unknown Vendor"}</p>
                          <p className="text-sm text-muted-foreground">
                            #{inv.invoice_number || "-"} • {(inv.currency || "€")} {Number(inv.total_amount ?? 0).toLocaleString()}
                          </p>
                          {inv.payment_qr_string && (
                            <p className="text-xs text-muted-foreground break-all mt-2">{inv.payment_qr_string}</p>
                          )}
                        </div>
                        <Button size="sm" onClick={() => generateQR(inv.id)}>
                          <QrCode className="h-4 w-4 mr-2" /> QR
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Payment Records</h3>
                  <div className="space-y-3">
                    {payments.length === 0 ? (
                      <div className="text-muted-foreground">No payment records yet.</div>
                    ) : (
                      payments.slice(0, 15).map((p) => (
                        <div key={p.id} className="p-4 rounded-lg border bg-card flex items-start justify-between gap-4">
                          <div>
                            <p className="font-medium">Payment</p>
                            <p className="text-sm text-muted-foreground">
                              {(p.currency || "€")} {Number(p.amount ?? 0).toLocaleString()} • Invoice: {p.invoice_id || "—"}
                            </p>
                          </div>
                          <Badge variant="secondary" className="capitalize">{p.status}</Badge>
                        </div>
                      ))
                    )}
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
