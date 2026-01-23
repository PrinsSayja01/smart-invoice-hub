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
  source: string | null; 
  file_url: string | null; 
}

export default function Invoices() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (user) fetchInvoices();
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
      toast({ variant: "destructive", title: "Error", description: "Could not load invoices." });
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
      toast({ title: "Invoice deleted", description: "The invoice has been removed." });
    } catch (error: any) {
      toast({ variant: "destructive", title: "Delete failed", description: error.message });
    } finally {
      setDeleting(null);
    }
  };

  // New function: handle file upload
  const handleUpload = async () => {
    if (!file || !user) return;
    setUploading(true);

    try {
      // 1️⃣ Upload file to Supabase storage
      const { data, error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(`files/${Date.now()}-${file.name}`, file);
      if (uploadError) throw uploadError;

      // 2️⃣ Call Edge Function for processing
      const fileUrl = `https://tkpogjvlepwrsswqzsdu.supabase.co/storage/v1/object/public/uploads/${data.path}`;
      const response = await fetch("/functions/process-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl, fileName: file.name, fileType: file.type }),
      });

      const result = await response.json();

      // 3️⃣ Insert record in Supabase table
      const { error: insertError } = await supabase
        .from("invoices")
        .insert([
          {
            user_id: user.id,
            file_name: result.file_name,
            file_url: result.file_url,
            source: "device",
            created_at: new Date().toISOString(),
          },
        ]);
      if (insertError) throw insertError;

      toast({ title: "Upload successful", description: `${file.name} uploaded.` });
      setFile(null);
      fetchInvoices();
    } catch (err: any) {
      console.error(err);
      toast({ variant: "destructive", title: "Upload failed", description: err.message });
    } finally {
      setUploading(false);
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
        return <Badge variant="outline" className="flex items-center gap-1 border-green-500 text-green-600"><CheckCircle2 className="h-3 w-3" />Low Risk</Badge>;
      case "medium":
        return <Badge variant="outline" className="flex items-center gap-1 border-yellow-500 text-yellow-600"><AlertTriangle className="h-3 w-3" />Medium Risk</Badge>;
      case "high":
        return <Badge variant="outline" className="flex items-center gap-1 border-red-500 text-red-600"><AlertTriangle className="h-3 w-3" />High Risk</Badge>;
      default:
        return <Badge variant="outline" className="flex items-center gap-1"><Clock className="h-3 w-3" />Unknown</Badge>;
    }
  };

  const getComplianceBadge = (status: string | null) => {
    switch (status) {
      case "compliant":
        return <Badge variant="outline" className="flex items-center gap-1 border-green-500 text-green-600"><CheckCircle2 className="h-3 w-3" />Compliant</Badge>;
      case "needs_review":
        return <Badge variant="outline" className="flex items-center gap-1 border-yellow-500 text-yellow-600"><AlertTriangle className="h-3 w-3" />Needs Review</Badge>;
      case "non_compliant":
        return <Badge variant="outline" className="flex items-center gap-1 border-red-500 text-red-600"><AlertTriangle className="h-3 w-3" />Non-Compliant</Badge>;
      default:
        return <Badge variant="outline" className="flex items-center gap-1"><Clock className="h-3 w-3" />Unknown</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle>Upload Invoice</CardTitle>
            <CardDescription>Upload PDF, PNG, or JPEG files.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2 items-center">
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <Button onClick={handleUpload} disabled={!file || uploading}>
              {uploading ? "Uploading..." : "Upload"}
            </Button>
          </CardContent>
        </Card>

        {/* Existing invoices table (same as your code) */}
        {/* ... all your table + dialog code remains unchanged ... */}
      </div>
    </DashboardLayout>
  );
}

import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
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
} from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

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
}

export default function Invoices() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      fetchInvoices();
    }
  }, [user]);

  const fetchInvoices = async () => {
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setInvoices(data || []);
    } catch (error) {
      console.error('Error fetching invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const { error } = await supabase.from('invoices').delete().eq('id', id);
      if (error) throw error;
      setInvoices(invoices.filter((inv) => inv.id !== id));
      toast({
        title: 'Invoice deleted',
        description: 'The invoice has been removed.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: error.message,
      });
    } finally {
      setDeleting(null);
    }
  };

  const filteredInvoices = invoices.filter(
    (inv) =>
      inv.vendor_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.invoice_number?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.file_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getRiskBadge = (risk: string | null) => {
    switch (risk) {
      case 'low':
        return <Badge className="bg-success/10 text-success hover:bg-success/20">Low Risk</Badge>;
      case 'medium':
        return <Badge className="bg-warning/10 text-warning hover:bg-warning/20">Medium Risk</Badge>;
      case 'high':
        return <Badge className="bg-destructive/10 text-destructive hover:bg-destructive/20">High Risk</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getComplianceBadge = (status: string | null) => {
    switch (status) {
      case 'compliant':
        return (
          <Badge className="bg-success/10 text-success hover:bg-success/20">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Compliant
          </Badge>
        );
      case 'needs_review':
        return (
          <Badge className="bg-warning/10 text-warning hover:bg-warning/20">
            <Clock className="h-3 w-3 mr-1" />
            Needs Review
          </Badge>
        );
      case 'non_compliant':
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
                  {searchQuery ? 'No invoices match your search' : 'No invoices yet'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Compliance</TableHead>
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
                                {invoice.vendor_name || 'Unknown Vendor'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {invoice.file_name}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{invoice.invoice_number || '-'}</TableCell>
                        <TableCell>
                          {invoice.invoice_date
                            ? format(new Date(invoice.invoice_date), 'MMM d, yyyy')
                            : '-'}
                        </TableCell>
                        <TableCell>
                          {invoice.total_amount
                            ? `${invoice.currency || '$'} ${Number(invoice.total_amount).toLocaleString()}`
                            : '-'}
                        </TableCell>
                        <TableCell>{getRiskBadge(invoice.risk_score)}</TableCell>
                        <TableCell>{getComplianceBadge(invoice.compliance_status)}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setSelectedInvoice(invoice)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(invoice.id)}
                              disabled={deleting === invoice.id}
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

        {/* Invoice Detail Dialog */}
        <Dialog open={!!selectedInvoice} onOpenChange={() => setSelectedInvoice(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Invoice Details</DialogTitle>
              <DialogDescription>
                Complete information about this invoice
              </DialogDescription>
            </DialogHeader>
            {selectedInvoice && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Vendor</p>
                    <p className="font-medium">{selectedInvoice.vendor_name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Invoice Number</p>
                    <p className="font-medium">{selectedInvoice.invoice_number || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Date</p>
                    <p className="font-medium">
                      {selectedInvoice.invoice_date
                        ? format(new Date(selectedInvoice.invoice_date), 'MMM d, yyyy')
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Type</p>
                    <p className="font-medium capitalize">{selectedInvoice.invoice_type || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Amount</p>
                    <p className="font-medium">
                      {selectedInvoice.total_amount
                        ? `${selectedInvoice.currency} ${Number(selectedInvoice.total_amount).toLocaleString()}`
                        : '-'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Tax Amount</p>
                    <p className="font-medium">
                      {selectedInvoice.tax_amount
                        ? `${selectedInvoice.currency} ${Number(selectedInvoice.tax_amount).toLocaleString()}`
                        : '-'}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  {getRiskBadge(selectedInvoice.risk_score)}
                  {getComplianceBadge(selectedInvoice.compliance_status)}
                  {selectedInvoice.is_flagged && (
                    <Badge className="bg-destructive/10 text-destructive">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      Flagged
                    </Badge>
                  )}
                </div>

                {selectedInvoice.flag_reason && (
                  <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                    <p className="text-sm text-destructive">{selectedInvoice.flag_reason}</p>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Uploaded {format(new Date(selectedInvoice.created_at), 'PPpp')}
                </p>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
