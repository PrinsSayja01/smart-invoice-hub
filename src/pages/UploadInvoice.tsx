import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { 
  Upload, FileText, Image, X, Loader2, CheckCircle2, AlertCircle, 
  Mail, HardDrive, Copy, Eye, AlertTriangle, Shield, Scan
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExtractedData {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: string;
  tax_amount: string;
  currency: string;
  invoice_type: string;
  line_items: Array<{ description: string; quantity: number; unit_price: number; amount: number }>;
  payment_terms: string;
  due_date: string;
}

interface AgentResults {
  risk_score: string;
  compliance_status: string;
  is_flagged: boolean;
  flag_reason: string | null;
  agents?: {
    fraud_detection?: { anomalies: string[] };
    compliance?: { issues: string[] };
  };
}

export default function UploadInvoice() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [agentResults, setAgentResults] = useState<AgentResults | null>(null);
  const [processingSteps, setProcessingSteps] = useState<{
    step: string;
    status: 'pending' | 'processing' | 'complete' | 'error';
    detail?: string;
  }[]>([]);
  const [googleDriveUrl, setGoogleDriveUrl] = useState('');
  const [uploadMethod, setUploadMethod] = useState<'file' | 'drive' | 'email'>('file');

  const emailAddress = `invoices+${user?.id?.slice(0, 8) || 'user'}@invoiceai.app`;

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && isValidFileType(droppedFile)) {
      handleFileSelection(droppedFile);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && isValidFileType(selectedFile)) {
      handleFileSelection(selectedFile);
    }
  };

  const handleFileSelection = async (selectedFile: File) => {
    setFile(selectedFile);
    setExtractedData(null);
    setAgentResults(null);
    
    // Create preview for images
    if (selectedFile.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => setFilePreview(e.target?.result as string);
      reader.readAsDataURL(selectedFile);
    } else {
      setFilePreview(null);
    }
  };

  const isValidFileType = (file: File) => {
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    return validTypes.includes(file.type);
  };

  const copyEmailToClipboard = () => {
    navigator.clipboard.writeText(emailAddress);
    toast({
      title: 'Email copied!',
      description: 'Forward invoices to this email address.',
    });
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
    });
  };

  const processInvoice = async () => {
    if (!file || !user) return;

    setUploading(true);
    setProcessingSteps([
      { step: 'Uploading document...', status: 'processing' },
      { step: 'AI Vision OCR extraction...', status: 'pending' },
      { step: 'Classifying invoice type...', status: 'pending' },
      { step: 'Fraud & anomaly detection...', status: 'pending' },
      { step: 'Tax compliance check...', status: 'pending' },
    ]);

    try {
      // Step 1: Upload file
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('invoices')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('invoices')
        .getPublicUrl(fileName);

      setProcessingSteps(prev => prev.map((s, i) => 
        i === 0 ? { ...s, status: 'complete', detail: 'File uploaded successfully' } 
        : i === 1 ? { ...s, status: 'processing' } : s
      ));

      setProcessing(true);

      // Convert file to base64 for AI Vision processing
      const fileBase64 = await fileToBase64(file);

      // Step 2-5: Process with multi-agent AI
      const { data: processedData, error: processError } = await supabase.functions.invoke('process-invoice', {
        body: {
          fileUrl: urlData.publicUrl,
          fileName: file.name,
          fileType: file.type,
          fileBase64: fileBase64,
        },
      });

      if (processError) throw processError;

      // Update all steps to complete
      setProcessingSteps(prev => prev.map((s, i) => ({
        ...s,
        status: 'complete',
        detail: i === 1 ? 'Data extracted with AI Vision' :
                i === 2 ? `Type: ${processedData.invoice_type || 'other'}` :
                i === 3 ? `Risk: ${processedData.risk_score || 'low'}` :
                i === 4 ? `Status: ${processedData.compliance_status || 'compliant'}` : s.detail
      })));

      // Set extracted data
      setExtractedData({
        vendor_name: processedData.vendor_name || '',
        invoice_number: processedData.invoice_number || '',
        invoice_date: processedData.invoice_date || '',
        total_amount: processedData.total_amount?.toString() || '',
        tax_amount: processedData.tax_amount?.toString() || '',
        currency: processedData.currency || 'USD',
        invoice_type: processedData.invoice_type || 'other',
        line_items: processedData.line_items || [],
        payment_terms: processedData.payment_terms || '',
        due_date: processedData.due_date || '',
      });

      // Set agent results
      setAgentResults({
        risk_score: processedData.risk_score,
        compliance_status: processedData.compliance_status,
        is_flagged: processedData.is_flagged,
        flag_reason: processedData.flag_reason,
        agents: processedData.agents,
      });

      toast({
        title: 'Invoice processed successfully!',
        description: 'Review the extracted data and AI analysis below.',
      });
    } catch (error: any) {
      console.error('Error processing invoice:', error);
      setProcessingSteps(prev => prev.map((s) => 
        s.status === 'processing' ? { ...s, status: 'error', detail: error.message } : s
      ));
      toast({
        variant: 'destructive',
        title: 'Processing failed',
        description: error.message || 'Failed to process invoice',
      });
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const processGoogleDriveFile = async () => {
    if (!googleDriveUrl || !user) return;

    setUploading(true);
    setProcessingSteps([
      { step: 'Fetching from Google Drive...', status: 'processing' },
      { step: 'AI Vision OCR extraction...', status: 'pending' },
      { step: 'Classifying invoice type...', status: 'pending' },
      { step: 'Fraud & anomaly detection...', status: 'pending' },
      { step: 'Tax compliance check...', status: 'pending' },
    ]);

    try {
      const fileIdMatch = googleDriveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
      const fileId = fileIdMatch ? fileIdMatch[1] : null;

      if (!fileId) {
        throw new Error('Invalid Google Drive URL');
      }

      setProcessingSteps(prev => prev.map((s, i) => 
        i === 0 ? { ...s, status: 'complete' } : i === 1 ? { ...s, status: 'processing' } : s
      ));

      setProcessing(true);

      const { data: processedData, error: processError } = await supabase.functions.invoke('process-invoice', {
        body: {
          fileUrl: googleDriveUrl,
          fileName: `google-drive-${fileId}.pdf`,
          fileType: 'application/pdf',
          source: 'google-drive',
        },
      });

      if (processError) throw processError;

      setProcessingSteps(prev => prev.map(s => ({ ...s, status: 'complete' })));

      setExtractedData({
        vendor_name: processedData.vendor_name || '',
        invoice_number: processedData.invoice_number || '',
        invoice_date: processedData.invoice_date || '',
        total_amount: processedData.total_amount?.toString() || '',
        tax_amount: processedData.tax_amount?.toString() || '',
        currency: processedData.currency || 'USD',
        invoice_type: processedData.invoice_type || 'other',
        line_items: processedData.line_items || [],
        payment_terms: processedData.payment_terms || '',
        due_date: processedData.due_date || '',
      });

      setAgentResults({
        risk_score: processedData.risk_score,
        compliance_status: processedData.compliance_status,
        is_flagged: processedData.is_flagged,
        flag_reason: processedData.flag_reason,
        agents: processedData.agents,
      });

      toast({
        title: 'Invoice processed!',
        description: 'Review the extracted data below.',
      });
    } catch (error: any) {
      console.error('Error:', error);
      setProcessingSteps(prev => prev.map((s) => 
        s.status === 'processing' ? { ...s, status: 'error' } : s
      ));
      toast({
        variant: 'destructive',
        title: 'Processing failed',
        description: error.message,
      });
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const saveInvoice = async () => {
    if (!extractedData || !user) return;

    setUploading(true);

    try {
      const fileName = file?.name || `google-drive-invoice-${Date.now()}`;
      const fileType = file?.type || 'application/pdf';

      const { error: insertError } = await supabase.from('invoices').insert({
        user_id: user.id,
        file_url: googleDriveUrl || 'uploaded-file',
        file_name: fileName,
        file_type: fileType,
        vendor_name: extractedData.vendor_name,
        invoice_number: extractedData.invoice_number,
        invoice_date: extractedData.invoice_date || null,
        total_amount: parseFloat(extractedData.total_amount) || null,
        tax_amount: parseFloat(extractedData.tax_amount) || null,
        currency: extractedData.currency,
        invoice_type: extractedData.invoice_type as any,
        compliance_status: agentResults?.compliance_status as any || 'needs_review',
        risk_score: agentResults?.risk_score as any || 'low',
        is_flagged: agentResults?.is_flagged || false,
        flag_reason: agentResults?.flag_reason || null,
      });

      if (insertError) throw insertError;

      toast({
        title: 'Invoice saved!',
        description: 'Your invoice has been saved successfully.',
      });

      navigate('/dashboard/invoices');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: error.message,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (field: keyof ExtractedData, value: string) => {
    if (extractedData) {
      setExtractedData({ ...extractedData, [field]: value });
    }
  };

  const resetForm = () => {
    setFile(null);
    setFilePreview(null);
    setExtractedData(null);
    setAgentResults(null);
    setProcessingSteps([]);
    setGoogleDriveUrl('');
  };

  const getRiskBadge = (risk: string) => {
    switch (risk) {
      case 'low': return <Badge className="bg-success/10 text-success">Low Risk</Badge>;
      case 'medium': return <Badge className="bg-warning/10 text-warning">Medium Risk</Badge>;
      case 'high': return <Badge className="bg-destructive/10 text-destructive">High Risk</Badge>;
      default: return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  const getComplianceBadge = (status: string) => {
    switch (status) {
      case 'compliant': return <Badge className="bg-success/10 text-success"><CheckCircle2 className="h-3 w-3 mr-1" />Compliant</Badge>;
      case 'needs_review': return <Badge className="bg-warning/10 text-warning"><AlertTriangle className="h-3 w-3 mr-1" />Needs Review</Badge>;
      case 'non_compliant': return <Badge className="bg-destructive/10 text-destructive"><AlertCircle className="h-3 w-3 mr-1" />Non-Compliant</Badge>;
      default: return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Upload Invoice</h1>
          <p className="text-muted-foreground mt-1">
            AI-powered OCR extraction with multi-agent analysis
          </p>
        </div>

        {/* Upload Methods */}
        <Tabs value={uploadMethod} onValueChange={(v) => setUploadMethod(v as any)} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="file" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              File Upload
            </TabsTrigger>
            <TabsTrigger value="drive" className="flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Google Drive
            </TabsTrigger>
            <TabsTrigger value="email" className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Email
            </TabsTrigger>
          </TabsList>

          {/* File Upload Tab */}
          <TabsContent value="file">
            <Card className="glass-card">
              <CardContent className="p-6">
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={cn(
                    'border-2 border-dashed rounded-xl p-8 text-center transition-all',
                    isDragging && 'dropzone-active border-primary',
                    file ? 'border-success bg-success/5' : 'border-border hover:border-primary/50'
                  )}
                >
                  {file ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-center gap-4">
                        {filePreview ? (
                          <img src={filePreview} alt="Preview" className="max-h-32 rounded-lg shadow-md" />
                        ) : file.type === 'application/pdf' ? (
                          <FileText className="h-16 w-16 text-primary" />
                        ) : (
                          <Image className="h-16 w-16 text-primary" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{file.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={resetForm}>
                        <X className="h-4 w-4 mr-2" />
                        Remove
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-4 rounded-full bg-primary/10 w-fit mx-auto">
                        <Scan className="h-8 w-8 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">Drop your invoice here</p>
                        <p className="text-sm text-muted-foreground">
                          PDF, JPG, PNG, WebP up to 10MB • AI Vision OCR enabled
                        </p>
                      </div>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="file-upload"
                      />
                      <Button asChild variant="outline">
                        <label htmlFor="file-upload" className="cursor-pointer">
                          Select File
                        </label>
                      </Button>
                    </div>
                  )}
                </div>

                {file && !extractedData && (
                  <div className="mt-6">
                    <Button
                      className="w-full gradient-primary"
                      onClick={processInvoice}
                      disabled={uploading || processing}
                    >
                      {uploading || processing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Processing with AI Vision...
                        </>
                      ) : (
                        <>
                          <Scan className="h-4 w-4 mr-2" />
                          Process Invoice
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Google Drive Tab */}
          <TabsContent value="drive">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <HardDrive className="h-5 w-5 text-primary" />
                  Import from Google Drive
                </CardTitle>
                <CardDescription>
                  Paste a Google Drive sharing link
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="drive-url">Google Drive Link</Label>
                  <Input
                    id="drive-url"
                    placeholder="https://drive.google.com/file/d/..."
                    value={googleDriveUrl}
                    onChange={(e) => setGoogleDriveUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Ensure file is set to "Anyone with the link can view"
                  </p>
                </div>

                <Button
                  className="w-full gradient-primary"
                  onClick={processGoogleDriveFile}
                  disabled={!googleDriveUrl || uploading || processing}
                >
                  {uploading || processing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <HardDrive className="h-4 w-4 mr-2" />
                      Import & Process
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Email Tab */}
          <TabsContent value="email">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5 text-primary" />
                  Email Invoices
                </CardTitle>
                <CardDescription>
                  Forward invoices to your unique email address
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="p-4 rounded-xl bg-muted/50 border border-border">
                  <p className="text-sm text-muted-foreground mb-2">Your email address:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-background rounded-lg text-sm font-mono">
                      {emailAddress}
                    </code>
                    <Button variant="outline" size="icon" onClick={copyEmailToClipboard}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="font-medium">How it works:</h4>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>1. Forward invoice emails to your unique address</p>
                    <p>2. AI automatically extracts and processes attachments</p>
                    <p>3. View processed invoices in your dashboard</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Processing Steps */}
        {processingSteps.length > 0 && !extractedData && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Scan className="h-5 w-5 text-primary" />
                AI Processing Pipeline
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {processingSteps.map((step, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  {step.status === 'pending' && (
                    <div className="h-5 w-5 rounded-full border-2 border-muted mt-0.5" />
                  )}
                  {step.status === 'processing' && (
                    <Loader2 className="h-5 w-5 text-primary animate-spin mt-0.5" />
                  )}
                  {step.status === 'complete' && (
                    <CheckCircle2 className="h-5 w-5 text-success mt-0.5" />
                  )}
                  {step.status === 'error' && (
                    <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                  )}
                  <div className="flex-1">
                    <span className={cn(
                      'text-sm font-medium',
                      step.status === 'pending' && 'text-muted-foreground',
                      step.status === 'processing' && 'text-foreground',
                      step.status === 'complete' && 'text-success',
                      step.status === 'error' && 'text-destructive'
                    )}>
                      {step.step}
                    </span>
                    {step.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5">{step.detail}</p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* AI Analysis Results */}
        {agentResults && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                AI Analysis Results
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 mb-4">
                {getRiskBadge(agentResults.risk_score)}
                {getComplianceBadge(agentResults.compliance_status)}
                {agentResults.is_flagged && (
                  <Badge className="bg-destructive/10 text-destructive">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Flagged
                  </Badge>
                )}
              </div>

              {agentResults.flag_reason && (
                <div className="p-3 rounded-lg bg-warning/10 border border-warning/20 mb-4">
                  <p className="text-sm text-warning font-medium">Issues detected:</p>
                  <p className="text-sm text-warning/80">{agentResults.flag_reason}</p>
                </div>
              )}

              {agentResults.agents?.compliance?.issues && agentResults.agents.compliance.issues.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium mb-1">Compliance notes:</p>
                  <ul className="list-disc list-inside">
                    {agentResults.agents.compliance.issues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Extracted Data Form */}
        {extractedData && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Eye className="h-5 w-5 text-primary" />
                Review Extracted Data
              </CardTitle>
              <CardDescription>
                Verify and correct the AI-extracted data before saving
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="vendor_name">Vendor Name</Label>
                  <Input
                    id="vendor_name"
                    value={extractedData.vendor_name}
                    onChange={(e) => handleInputChange('vendor_name', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice_number">Invoice Number</Label>
                  <Input
                    id="invoice_number"
                    value={extractedData.invoice_number}
                    onChange={(e) => handleInputChange('invoice_number', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice_date">Invoice Date</Label>
                  <Input
                    id="invoice_date"
                    type="date"
                    value={extractedData.invoice_date}
                    onChange={(e) => handleInputChange('invoice_date', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="due_date">Due Date</Label>
                  <Input
                    id="due_date"
                    type="date"
                    value={extractedData.due_date}
                    onChange={(e) => handleInputChange('due_date', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Input
                    id="currency"
                    value={extractedData.currency}
                    onChange={(e) => handleInputChange('currency', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice_type">Invoice Type</Label>
                  <Input
                    id="invoice_type"
                    value={extractedData.invoice_type}
                    onChange={(e) => handleInputChange('invoice_type', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="total_amount">Total Amount</Label>
                  <Input
                    id="total_amount"
                    type="number"
                    step="0.01"
                    value={extractedData.total_amount}
                    onChange={(e) => handleInputChange('total_amount', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tax_amount">Tax/VAT Amount</Label>
                  <Input
                    id="tax_amount"
                    type="number"
                    step="0.01"
                    value={extractedData.tax_amount}
                    onChange={(e) => handleInputChange('tax_amount', e.target.value)}
                  />
                </div>
              </div>

              {extractedData.line_items && extractedData.line_items.length > 0 && (
                <div className="space-y-2">
                  <Label>Line Items</Label>
                  <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left">Description</th>
                          <th className="px-3 py-2 text-right">Qty</th>
                          <th className="px-3 py-2 text-right">Unit Price</th>
                          <th className="px-3 py-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {extractedData.line_items.map((item, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-3 py-2">{item.description}</td>
                            <td className="px-3 py-2 text-right">{item.quantity}</td>
                            <td className="px-3 py-2 text-right">{item.unit_price}</td>
                            <td className="px-3 py-2 text-right">{item.amount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
                <Button
                  className="flex-1 gradient-primary"
                  onClick={saveInvoice}
                  disabled={uploading}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Save Invoice
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
