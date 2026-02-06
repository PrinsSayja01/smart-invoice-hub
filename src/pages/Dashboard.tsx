import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Leaf,
  Loader2,
  ShieldAlert,
  Upload,
} from "lucide-react";

type InvoiceRow = {
  id: string;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total_amount: number | null;
  currency: string | null;
  is_flagged?: boolean | null;
  flag_reason?: string | null;
  approval?: string | null; // pass | fail | needs_info | human_approval
  approval_reasons?: string[] | null;
  co2e_estimate?: number | null;
};

type Stats = {
  total: number;
  thisMonth: number;
  pendingReview: number;
  flagged: number;
  approvalsPending: number;
  emissionsTotal: number;
};

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function toEUR(total: number, currency: string | null) {
  // NOTE: Without FX rates we treat EUR as EUR and others as-is.
  // For the €5000 rule we only enforce strictly when currency is EUR.
  if ((currency || "").toUpperCase() === "EUR") return total;
  return total;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [stats, setStats] = useState<Stats>({
    total: 0,
    thisMonth: 0,
    pendingReview: 0,
    flagged: 0,
    approvalsPending: 0,
    emissionsTotal: 0,
  });

  useEffect(() => {
    const loadDashboard = async () => {
      if (!user) return;
      setLoading(true);

      const res = await supabase
        .from("invoices")
        .select(
          "id,vendor_name,invoice_number,invoice_date,total_amount,currency,is_flagged,flag_reason,approval,approval_reasons,co2e_estimate,created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (res.error) {
        toast({
          variant: "destructive",
          title: "Failed to load dashboard",
          description: res.error.message,
        });
        setLoading(false);
        return;
      }

      const rows = (res.data as any[]) || [];
      const normalized: InvoiceRow[] = rows.map((r) => ({
        id: String(r.id),
        vendor_name: r.vendor_name ?? null,
        invoice_number: r.invoice_number ?? null,
        invoice_date: r.invoice_date ?? null,
        total_amount: typeof r.total_amount === "number" ? r.total_amount : r.total_amount ? Number(r.total_amount) : null,
        currency: r.currency ?? null,
        is_flagged: r.is_flagged ?? false,
        flag_reason: r.flag_reason ?? null,
        approval: r.approval ?? null,
        approval_reasons: Array.isArray(r.approval_reasons) ? r.approval_reasons : null,
        co2e_estimate: typeof r.co2e_estimate === "number" ? r.co2e_estimate : r.co2e_estimate ? Number(r.co2e_estimate) : null,
      }));

      setInvoices(normalized);

      const now = new Date();
      const thisMonthKey = monthKey(now);

      const total = normalized.length;
      const thisMonth = rows.filter((r) => {
        const dt = r.created_at ? new Date(r.created_at) : null;
        if (!dt || isNaN(dt.getTime())) return false;
        return monthKey(dt) === thisMonthKey;
      }).length;

      const flagged = normalized.filter((x) => !!x.is_flagged).length;
      const pendingReview = normalized.filter((x) => (x.approval || "").toLowerCase() === "needs_info").length;
      const approvalsPending = normalized.filter((x) => {
        const approval = (x.approval || "").toLowerCase();
        const totalAmt = x.total_amount ?? 0;
        const cur = (x.currency || "").toUpperCase();
        const over5kEUR = cur === "EUR" && toEUR(totalAmt, cur) > 5000;
        return approval === "human_approval" || over5kEUR;
      }).length;

      const emissionsTotal = normalized
        .map((x) => x.co2e_estimate ?? 0)
        .reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

      setStats({ total, thisMonth, pendingReview, flagged, approvalsPending, emissionsTotal });
      setLoading(false);
    };

    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const topFlagged = useMemo(() => invoices.filter((i) => !!i.is_flagged).slice(0, 6), [invoices]);
  const topNeedsAction = useMemo(
    () =>
      invoices
        .filter((i) => {
          const a = (i.approval || "").toLowerCase();
          const over5k = (i.currency || "").toUpperCase() === "EUR" && (i.total_amount ?? 0) > 5000;
          return a === "needs_info" || a === "fail" || a === "human_approval" || over5k;
        })
        .slice(0, 6),
    [invoices],
  );

  const goInvoices = (query: string) => {
    navigate(`/dashboard/invoices${query}`);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold">Dashboard</h1>
            <p className="text-muted-foreground mt-1">Overview, quick actions, and flagged invoices.</p>
          </div>
          <Button onClick={() => navigate("/dashboard/upload")}>
            <Upload className="h-4 w-4 mr-2" /> Upload Invoice
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" /> Total Invoices
              </CardTitle>
              <CardDescription>All time</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" /> This Month
              </CardTitle>
              <CardDescription>Invoices created this month</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.thisMonth}</div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-warning" /> Needs Info
              </CardTitle>
              <CardDescription>Low confidence / missing VAT / missing evidence</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.pendingReview}</div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-destructive" /> Flagged
              </CardTitle>
              <CardDescription>Fraud/policy signals</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.flagged}</div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">Human Approval</CardTitle>
              <CardDescription>Over €5000 or forced review</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.approvalsPending}</div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Leaf className="h-5 w-5 text-info" /> Estimated CO₂e
              </CardTitle>
              <CardDescription>Total estimate (kg CO₂e)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.emissionsTotal.toFixed(2)}</div>
            </CardContent>
          </Card>
        </div>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Jump directly to what needs attention</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => goInvoices("?flagged=1")}>Flagged Invoices</Button>
            <Button variant="outline" onClick={() => goInvoices("?approval=human")}>Human Approval</Button>
            <Button variant="outline" onClick={() => goInvoices("?needsInfo=1")}>Needs Info</Button>
            <Button variant="outline" onClick={() => goInvoices("")}>All Invoices</Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Flagged Invoices</CardTitle>
              <CardDescription>Quick access to risk items</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : topFlagged.length === 0 ? (
                <div className="text-muted-foreground">No flagged invoices.</div>
              ) : (
                <div className="space-y-3">
                  {topFlagged.map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => navigate(`/dashboard/invoices?open=${inv.id}`)}
                      className="w-full text-left p-3 rounded-lg border bg-card hover:bg-muted/40 transition"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{inv.vendor_name || "Unknown Vendor"}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            #{inv.invoice_number || "-"} • {(inv.currency || "").toUpperCase() || "—"} {Number(inv.total_amount ?? 0).toLocaleString()}
                          </div>
                          {inv.flag_reason && (
                            <div className="text-xs text-destructive mt-1 truncate">{inv.flag_reason}</div>
                          )}
                        </div>
                        <Badge variant="destructive">Flagged</Badge>
                      </div>
                    </button>
                  ))}
                  <Button variant="outline" onClick={() => goInvoices("?flagged=1")}>View all flagged</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Invoices Needing Action</CardTitle>
              <CardDescription>Needs info, fail, or human approval</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : topNeedsAction.length === 0 ? (
                <div className="text-muted-foreground">Nothing pending.</div>
              ) : (
                <div className="space-y-3">
                  {topNeedsAction.map((inv) => {
                    const approval = (inv.approval || "").toLowerCase();
                    const over5k = (inv.currency || "").toUpperCase() === "EUR" && (inv.total_amount ?? 0) > 5000;
                    const label = over5k ? "Human approval" : approval || "review";
                    return (
                      <button
                        key={inv.id}
                        onClick={() => navigate(`/dashboard/invoices?open=${inv.id}`)}
                        className="w-full text-left p-3 rounded-lg border bg-card hover:bg-muted/40 transition"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium truncate">{inv.vendor_name || "Unknown Vendor"}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              #{inv.invoice_number || "-"} • {(inv.currency || "").toUpperCase() || "—"} {Number(inv.total_amount ?? 0).toLocaleString()}
                            </div>
                            {Array.isArray(inv.approval_reasons) && inv.approval_reasons[0] && (
                              <div className="text-xs text-muted-foreground mt-1 truncate">{inv.approval_reasons[0]}</div>
                            )}
                          </div>
                          <Badge variant={label === "fail" ? "destructive" : "secondary"} className="capitalize">
                            {label}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                  <Button variant="outline" onClick={() => goInvoices("?needsInfo=1")}>View all</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
