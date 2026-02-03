import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  Search,
  FileText,
  Download,
  Eye,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface Invoice {
  id: string;
  user_id?: string;
  file_name: string;
  file_url?: string | null;

  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;

  total_amount: number | null;
  tax_amount: number | null;
  currency: string | null;
  invoice_type: string | null;

  risk_score: string | null;
  compliance_status: string | null;

  is_flagged: boolean;
  flag_reason: string | null;

  created_at: string;

  // Advanced fields (may exist depending on migration)
  doc_class?: string | null;
  direction?: string | null;
  jurisdiction?: string | null;
  vat_rate?: number | null;
  approval?: string | null;
  payment_qr_string?: string | null;
  co2e_estimate?: number | null;
  fraud_score?: number | null;
  anomaly_flags?: string[] | null;
}

export default function Invoices() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [savingApproval, setSavingApproval] = useState(false);

  useEffect(() => {
    if (user) fetchInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setInvoices((data as Invoice[]) || []);
    } catch (error: any) {
      console.error("Error fetching invoices:", error);
      toast({
        variant: "destructive",
        title: "Failed to load invoices",
        description: error?.message || "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;

      setInvoices((prev) => prev.filter((inv) => inv.id !== id));
      toast({
        title: "Invoice deleted",
        description: "The invoice has been removed.",
      });

      if (selectedInvoice?.id === id) setSelectedInvoice(null);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: error?.message || "Unknown error",
      });
    } finally {
      setDeleting(null);
    }
  };

  const setApproval = async (
    invoiceId: string,
    status: "pass" | "fail" | "needs_info" | "pending"
  ) => {
    try {
      setSavingApproval(true);
      const reasons =
        status === "needs_info"
          ? ((selectedInvoice as any)?.needs_info_fields as string[] | undefined) ??
            ["missing_fields"]
          : [];

      const { data, error } = await supabase.functions.invoke("set-approval", {
        body: { invoiceId, status, reasons },
      });
      if (error) throw error;

      setInvoices((prev) =>
        prev.map((inv) =>
          inv.id === invoiceId ? ({ ...inv, approval: status } as any) : inv
        )
      );
      setSelectedInvoice((prev) =>
        prev && prev.id === invoiceId ? ({ ...prev, approval: status } as any) : prev
      );

      toast({
        title: "Approval updated",
        description: `Marked as ${status.replace("_", " ")}`,
      });
      return data;
    } catch (e: any) {
      console.error(e);
      toast({
        variant: "destructive",
        title: "Could not update approval",
        description: e?.message || "Unknown error",
      });
    } finally {
      setSavingApproval(false);
    }
  };

  const runRiskCheck = async (invoiceId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("risk-check", {
        body: { invoiceId },
      });
      if (error) throw error;

      toast({
        title: "Risk check complete",
        description: "Updated fraud score and anomaly flags.",
      });
      await fetchInvoices();
      return data;
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Risk check failed",
        description: e?.message || "Unknown error",
      });
    }
  };

  const filteredInvoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return invoices;

    return invoices.filter((inv) => {
      const vendor = (inv.vendor_name || "").toLowerCase();
      const number = (inv.invoice_number || "").toLowerCase();
      const name = (inv.file_name || "").toLowerCase();
      return vendor.includes(q) || number.includes(q) || name.includes(q);
    });
  }, [invoices, searchQuery]);

  const getRiskBadge = (risk: string | null) => {
    switch (risk) {
      case "low":
        return (
          <Badge className="bg-success/10 text-success hover:bg-success/20">
            Low Risk
          </Badge>
        );
      case "medium":
        return (
          <Badge className="bg-warning/10 text-warning hover:bg-warning/20">
            Medium Risk
          </Badge>
        );
      case "high":
        return (
          <Badge className="bg-destructive/10 text-destructive hover:bg-destructive/20">
            High Risk
          </Badge>
        );
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getComplianceBadge = (status: string | null) => {
    switch (status) {
      case "compliant":
        return (
          <Badge className="bg-success/10 text-success hover:bg-success/20">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Compliant
          </Badge>
        );
      case "needs_review":
        return (
          <Badge className="bg-warning/10 text-warning hover:bg-warning/20">
            <Clock className="h-3 w-3 mr-1" />
            Needs Review
          </Badge>
        );
      case "non_compliant":
        return (
          <Badge className="bg-destructive/10 text-destructive hover:bg-destructive/20">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Non-Compliant
          </Badge>
        );
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const openFile = (url?: string | null) => {
    if (!url) {
      toast({
        variant: "destructive",
        title: "No file link",
        description: "This invoice does not have a file_url saved.",
      });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const formatMoney = (amount: number | null, currency: string | null) => {
    if (amount == null) return "-";
    const cur = currency || "$";
    return `${cur} ${Number(amount).toLocaleString()}`;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold">Invoices</h1>
            <p className="text-muted-foreground mt-1">
              Manage and review all your processed invoices
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search invoices..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <Card className="glass-card">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                <p className="text-muted-foreground">
                  {searchQuery ? "No invoices match your search" : "No invoices yet"}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Doc</TableHead>
                      <TableHead>Direction</TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Approval</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Compliance</TableHead>
                      <TableHead>CO₂e</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {filteredInvoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-muted">
                              <FileText className="h-4 w-4 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium">
                                {invoice.vendor_name || "Unknown Vendor"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {invoice.file_name}
                              </p>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell>
                          <Badge variant="secondary" className="capitalize">
                            {String(invoice.doc_class || "other").replace("_", " ")}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {String(invoice.direction || "unknown")}
                          </Badge>
                        </TableCell>

                        <TableCell>{invoice.invoice_number || "-"}</TableCell>

                        <TableCell>
                          {invoice.invoice_date
                            ? format(new Date(invoice.invoice_date), "MMM d, yyyy")
                            : "-"}
                        </TableCell>

                        <TableCell>
                          {formatMoney(invoice.total_amount, invoice.currency)}
                        </TableCell>

                        <TableCell>
                          <Badge
                            variant={
                              invoice.approval === "pass"
                                ? "default"
                                : invoice.approval === "fail"
                                ? "destructive"
                                : "secondary"
                            }
                            className="capitalize"
                          >
                            {String(invoice.approval || "pending").replace("_", " ")}
                          </Badge>
                        </TableCell>

                        <TableCell>{getRiskBadge(invoice.risk_score)}</TableCell>

                        <TableCell>{getComplianceBadge(invoice.compliance_status)}</TableCell>

                        <TableCell className="text-sm tabular-nums">
                          {invoice.co2e_estimate != null
                            ? Number(invoice.co2e_estimate).toFixed(2)
                            : "—"}
                        </TableCell>

                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setSelectedInvoice(invoice)}
                              title="View details"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openFile(invoice.file_url)}
                              title={invoice.file_url ? "Open file" : "No file_url"}
                              disabled={!invoice.file_url}
                            >
                              <Download className="h-4 w-4" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => runRiskCheck(invoice.id)}
                              title="Run risk check"
                            >
                              <AlertTriangle className="h-4 w-4" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(invoice.id)}
                              disabled={deleting === invoice.id}
                              title="Delete"
                            >
                              {deleting === invoice.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4 text-destructive" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={!!selectedInvoice} onOpenChange={() => setSelectedInvoice(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Invoice Details</DialogTitle>
              <DialogDescription>Complete information about this invoice</DialogDescription>
            </DialogHeader>

            {selectedInvoice && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Vendor</p>
                    <p className="font-medium">{selectedInvoice.vendor_name || "-"}</p>
                  </div>

                  <div>
                    <p className="text-sm text-muted-foreground">Invoice Number</p>
                    <p className="font-medium">{selectedInvoice.invoice_number || "-"}</p>
                  </div>

                  <div>
                    <p className="text-sm text-muted-foreground">Date</p>
                    <p className="font-medium">
                      {selectedInvoice.invoice_date
                        ? format(new Date(selectedInvoice.invoice_date), "MMM d, yyyy")
                        : "-"}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-muted-foreground">Type</p>
                    <p className="font-medium capitalize">
                      {selectedInvoice.invoice_type || "-"}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-muted-foreground">Total Amount</p>
                    <p className="font-medium">
                      {formatMoney(selectedInvoice.total_amount, selectedInvoice.currency)}
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-muted-foreground">Tax Amount</p>
                    <p className="font-medium">
                      {formatMoney(selectedInvoice.tax_amount, selectedInvoice.currency)}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2 pt-2 flex-wrap">
                  {getRiskBadge(selectedInvoice.risk_score)}
                  {getComplianceBadge(selectedInvoice.compliance_status)}
                  {selectedInvoice.is_flagged && (
                    <Badge className="bg-destructive/10 text-destructive">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Flagged
                    </Badge>
                  )}
                  <Badge
                    variant={
                      selectedInvoice.approval === "pass"
                        ? "default"
                        : selectedInvoice.approval === "fail"
                        ? "destructive"
                        : "secondary"
                    }
                    className="capitalize"
                  >
                    Approval: {String(selectedInvoice.approval || "pending").replace("_", " ")}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Document class</p>
                    <p className="font-medium capitalize">
                      {String(selectedInvoice.doc_class || "other").replace("_", " ")}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Direction</p>
                    <p className="font-medium capitalize">
                      {String(selectedInvoice.direction || "unknown")}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Jurisdiction</p>
                    <p className="font-medium">{selectedInvoice.jurisdiction || "—"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">VAT rate</p>
                    <p className="font-medium">
                      {selectedInvoice.vat_rate != null
                        ? `${(Number(selectedInvoice.vat_rate) * 100).toFixed(2)}%`
                        : "—"}
                    </p>
                  </div>
                </div>

                <div className="pt-2 space-y-2">
                  <p className="text-sm text-muted-foreground">Approval actions</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={savingApproval}
                      onClick={() => setApproval(selectedInvoice.id, "pass")}
                    >
                      {savingApproval ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                      )}
                      Pass
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={savingApproval}
                      onClick={() => setApproval(selectedInvoice.id, "needs_info")}
                    >
                      {savingApproval ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Clock className="h-4 w-4 mr-2" />
                      )}
                      Needs info
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={savingApproval}
                      onClick={() => setApproval(selectedInvoice.id, "fail")}
                    >
                      {savingApproval ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 mr-2" />
                      )}
                      Fail
                    </Button>
                  </div>

                  {selectedInvoice.payment_qr_string && (
                    <div className="p-3 rounded-lg bg-muted/40 border">
                      <p className="text-sm font-medium mb-1">Payment payload</p>
                      <p className="text-xs text-muted-foreground break-all">
                        {String(selectedInvoice.payment_qr_string)}
                      </p>
                      <div className="pt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await navigator.clipboard.writeText(
                              String(selectedInvoice.payment_qr_string)
                            );
                            toast({
                              title: "Copied",
                              description: "Payment payload copied to clipboard.",
                            });
                          }}
                        >
                          Copy
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {selectedInvoice.flag_reason && (
                  <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                    <p className="text-sm text-destructive">{selectedInvoice.flag_reason}</p>
                  </div>
                )}

                {selectedInvoice.file_url ? (
                  <div className="pt-2">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => openFile(selectedInvoice.file_url)}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open uploaded file
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground pt-2">
                    No file_url stored for this invoice.
                  </p>
                )}

                <p className="text-xs text-muted-foreground">
                  Uploaded {format(new Date(selectedInvoice.created_at), "PPpp")}
                </p>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}

