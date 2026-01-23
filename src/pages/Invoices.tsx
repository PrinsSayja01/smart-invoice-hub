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
