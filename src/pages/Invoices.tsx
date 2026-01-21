import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface Invoice {
  id: string;
  file_name: string;
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
  source: string | null;    // new column in DB (device | drive | email)
  file_url: string | null;  // Supabase Storage public URL or Drive link
}

export default function Invoices() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchInvoices();
    }
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
    } catch (error) {
      console.error("Error fetching invoices:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Could not load invoices.",
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
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: error.message,
      });
    } finally {
      setDeleting(null);
    }
  };

  const filteredInvoices = invoices.filter((inv) => {
    const q = searchQuery.toLowerCase();
    return (
      inv.vendor_name?.toLowerCase().includes(q) ||
      inv.invoice_number?.toLowerCase().includes(q) ||
      inv.file_name.toLowerCase().includes(q)
    );
  });

  const getRiskBadge = (risk: string | null) => {
    switch (risk) {
      case "low":
        return (
          <Badge variant="outline" className="flex items-center gap-1 border-green-500 text-green-600">
            <CheckCircle2 className="h-3 w-3" />
            Low Risk
          </Badge>
        );
      case "medium":
        return (
          <Badge variant="outline" className="flex items-center gap-1 border-yellow-500 text-yellow-600">
            <AlertTriangle className="h-3 w-3" />
            Medium Risk
          </Badge>
        );
      case "high":
        return (
          <Badge variant="outline" className="flex items-center gap-1 border-red-500 text-red-600">
            <AlertTriangle className="h-3 w-3" />
            High Risk
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Unknown
          </Badge>
        );
    }
  };

  const getComplianceBadge = (status: string | null) => {
    switch (status) {
      case "compliant":
        return (
          <Badge variant="outline" className="flex items-center gap-1 border-green-500 text-green-600">
            <CheckCircle2 className="h-3 w-3" />
            Compliant
          </Badge>
        );
      case "needs_review":
        return (
          <Badge variant="outline" className="flex items-center gap-1 border-yellow-500 text-yellow-600">
            <AlertTriangle className="h-3 w-3" />
            Needs Review
          </Badge>
        );
      case "non_compliant":
        return (
          <Badge variant="outline" className="flex items-center gap-1 border-red-500 text-red-600">
            <AlertTriangle className="h-3 w-3" />
            Non-Compliant
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Unknown
          </Badge>
        );
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Invoices
            </CardTitle>
            <CardDescription>
              Manage and review all your processed invoices.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by vendor, invoice number, or file name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredInvoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
                <FileText className="h-8 w-8 mb-2" />
                <p>{searchQuery ? "No invoices match your search" : "No invoices yet"}</p>
              </div>
            ) : (
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Compliance</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInvoices.map((invoice) => (
                      <TableRow key={invoice.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {invoice.vendor_name || "Unknown Vendor"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {invoice.file_name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{invoice.invoice_number || "-"}</TableCell>
                        <TableCell>
                          {invoice.invoice_date
                            ? format(new Date(invoice.invoice_date), "MMM d, yyyy")
                            : "-"}
                        </TableCell>
                        <TableCell>
                          {invoice.total_amount
                            ? `${invoice.currency || "$"} ${Number(
                                invoice.total_amount
                              ).toLocaleString()}`
                            : "-"}
                        </TableCell>
                        <TableCell>{getRiskBadge(invoice.risk_score)}</TableCell>
                        <TableCell>{getComplianceBadge(invoice.compliance_status)}</TableCell>
                        <TableCell className="capitalize text-xs">
                          {invoice.source || "device"}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          {invoice.file_url && (
                            <Button variant="ghost" size="icon" asChild>
                              <a
                                href={invoice.file_url}
                                target="_blank"
                                rel="noreferrer"
                                title="View file"
                              >
                                <Eye className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedInvoice(invoice)}
                            title="Details"
                          >
                            <FileText className="h-4 w-4" />
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
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invoice Detail Dialog */}
        <Dialog open={!!selectedInvoice} onOpenChange={() => setSelectedInvoice(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invoice Details</DialogTitle>
              <DialogDescription>
                Complete information about this invoice.
              </DialogDescription>
            </DialogHeader>
            {selectedInvoice && (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Vendor</p>
                    <p className="font-medium">{selectedInvoice.vendor_name || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Invoice Number</p>
                    <p className="font-medium">{selectedInvoice.invoice_number || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Date</p>
                    <p className="font-medium">
                      {selectedInvoice.invoice_date
                        ? format(new Date(selectedInvoice.invoice_date), "MMM d, yyyy")
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Type</p>
                    <p className="font-medium">{selectedInvoice.invoice_type || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Amount</p>
                    <p className="font-medium">
                      {selectedInvoice.total_amount
                        ? `${selectedInvoice.currency || "$"} ${Number(
                            selectedInvoice.total_amount
                          ).toLocaleString()}`
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tax Amount</p>
                    <p className="font-medium">
                      {selectedInvoice.tax_amount
                        ? `${selectedInvoice.currency || "$"} ${Number(
                            selectedInvoice.tax_amount
                          ).toLocaleString()}`
                        : "-"}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {getRiskBadge(selectedInvoice.risk_score)}
                  {getComplianceBadge(selectedInvoice.compliance_status)}
                  {selectedInvoice.is_flagged && (
                    <Badge variant="destructive" className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Flagged
                    </Badge>
                  )}
                </div>

                {selectedInvoice.flag_reason && (
                  <div>
                    <p className="text-xs text-muted-foreground">Flag reason</p>
                    <p className="text-sm">{selectedInvoice.flag_reason}</p>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Uploaded {format(new Date(selectedInvoice.created_at), "PPpp")} via{" "}
                  <span className="font-medium capitalize">
                    {selectedInvoice.source || "device"}
                  </span>
                </p>

                {selectedInvoice.file_url && (
                  <div className="flex gap-2 mt-2">
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={selectedInvoice.file_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Eye className="mr-2 h-4 w-4" />
                        View file
                      </a>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={selectedInvoice.file_url}
                        target="_blank"
                        rel="noreferrer"
                        download
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </a>
                    </Button>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
