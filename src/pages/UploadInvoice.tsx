import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, Image, X, Loader2, CheckCircle2, AlertCircle, Mail, HardDrive, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExtractedData {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: string;
  tax_amount: string;
  currency: string;
}

export default function UploadInvoice() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [processingSteps, setProcessingSteps] = useState<{
    step: string;
    status: 'pending' | 'processing' | 'complete' | 'error';
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
      setFile(droppedFile);
      setExtractedData(null);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && isValidFileType(selectedFile)) {
      setFile(selectedFile);
      setExtractedData(null);
    }
  };

  const isValidFileType = (file: File) => {
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    return validTypes.includes(file.type);
  };

  const copyEmailToClipboard = () => {
    navigator.clipboard.writeText(emailAddress);
    toast({
      title: 'Email copied!',
      description: 'Forward invoices to this email address.',
    });
  };

  const processGoogleDriveFile = async () => {
    if (!googleDriveUrl || !user) return;

    setUploading(true);
    setProcessingSteps([
      { step: 'Fetching from Google Drive...', status: 'processing' },
      { step: 'Running OCR extraction...', status: 'pending' },
      { step: 'Classifying invoice type...', status: 'pending' },
      { step: 'Detecting anomalies...', status: 'pending' },
      { step: 'Checking compliance...', status: 'pending' },
    ]);

    try {
      // Extract file ID from Google Drive URL
      const fileIdMatch = googleDriveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
      const fileId = fileIdMatch ? fileIdMatch[1] : null;

      if (!fileId) {
        throw new Error('Invalid Google Drive URL. Please use a valid sharing link.');
      }

      setProcessingSteps(prev => prev.map((s, i) => 
        i === 0 ? { ...s, status: 'complete' } : i === 1 ? { ...s, status: 'processing' } : s
      ));

      setProcessing(true);

      // Call the process-invoice edge function with Google Drive URL
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
      });

      toast({
        title: 'Invoice processed!',
        description: 'Review the extracted data below and save when ready.',
      });
    } catch (error: any) {
      console.error('Error processing Google Drive invoice:', error);
      setProcessingSteps(prev => prev.map((s) => 
        s.status === 'processing' ? { ...s, status: 'error' } : s
      ));
      toast({
        variant: 'destructive',
        title: 'Processing failed',
        description: error.message || 'Failed to process invoice from Google Drive',
      });
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const processInvoice = async () => {
    if (!file || !user) return;

    setUploading(true);
    setProcessingSteps([
      { step: 'Uploading file...', status: 'processing' },
      { step: 'Running OCR extraction...', status: 'pending' },
      { step: 'Classifying invoice type...', status: 'pending' },
      { step: 'Detecting anomalies...', status: 'pending' },
      { step: 'Checking compliance...', status: 'pending' },
    ]);

    try {
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
        i === 0 ? { ...s, status: 'complete' } : i === 1 ? { ...s, status: 'processing' } : s
      ));

      setProcessing(true);

      const { data: processedData, error: processError } = await supabase.functions.invoke('process-invoice', {
        body: {
          fileUrl: urlData.publicUrl,
          fileName: file.name,
          fileType: file.type,
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
      });

      toast({
        title: 'Invoice processed!',
        description: 'Review the extracted data below and save when ready.',
      });
    } catch (error: any) {
      console.error('Error processing invoice:', error);
      setProcessingSteps(prev => prev.map((s) => 
        s.status === 'processing' ? { ...s, status: 'error' } : s
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
        compliance_status: 'compliant',
        risk_score: 'low',
      });

      if (insertError) throw insertError;

      toast({
        title: 'Invoice saved!',
        description: 'Your invoice has been successfully saved.',
      });

      navigate('/dashboard/invoices');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: error.message || 'Failed to save invoice',
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
    setExtractedData(null);
    setProcessingSteps([]);
    setGoogleDriveUrl('');
  };

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Upload Invoice</h1>
          <p className="text-muted-foreground mt-1">
            Upload invoices via file, Google Drive, or email
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
                      <div className="flex items-center justify-center gap-3">
                        {file.type === 'application/pdf' ? (
                          <FileText className="h-12 w-12 text-primary" />
                        ) : (
                          <Image className="h-12 w-12 text-primary" />
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
                        <Upload className="h-8 w-8 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">Drop your invoice here</p>
                        <p className="text-sm text-muted-foreground">
                          or click to browse • PDF, JPG, PNG up to 10MB
                        </p>
                      </div>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
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
                          Processing...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
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
                  Paste a Google Drive sharing link to import your invoice
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
                    Make sure the file is set to "Anyone with the link can view"
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
                  Forward invoices to your personal email address for automatic processing
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="p-4 rounded-xl bg-muted/50 border border-border">
                  <p className="text-sm text-muted-foreground mb-2">Your unique email address:</p>
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
                  <div className="space-y-2">
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">1</div>
                      <p className="text-sm text-muted-foreground">Forward any invoice email to your unique address above</p>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">2</div>
                      <p className="text-sm text-muted-foreground">We'll automatically extract and process attached invoices</p>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-bold text-primary">3</div>
                      <p className="text-sm text-muted-foreground">Processed invoices appear in your dashboard within minutes</p>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-info/10 border border-info/20">
                  <p className="text-sm text-info">
                    <strong>Pro tip:</strong> Set up email forwarding rules to automatically send vendor invoices to this address!
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Processing Steps */}
        {processingSteps.length > 0 && !extractedData && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">AI Processing</CardTitle>
              <CardDescription>Multi-agent workflow in progress</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {processingSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  {step.status === 'pending' && (
                    <div className="h-5 w-5 rounded-full border-2 border-muted" />
                  )}
                  {step.status === 'processing' && (
                    <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  )}
                  {step.status === 'complete' && (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  )}
                  {step.status === 'error' && (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  )}
                  <span className={cn(
                    'text-sm',
                    step.status === 'pending' && 'text-muted-foreground',
                    step.status === 'processing' && 'text-foreground font-medium',
                    step.status === 'complete' && 'text-success',
                    step.status === 'error' && 'text-destructive'
                  )}>
                    {step.step}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Extracted Data Form */}
        {extractedData && (
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">Review Extracted Data</CardTitle>
              <CardDescription>
                Verify and correct the extracted information before saving
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  <Label htmlFor="currency">Currency</Label>
                  <Input
                    id="currency"
                    value={extractedData.currency}
                    onChange={(e) => handleInputChange('currency', e.target.value)}
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
