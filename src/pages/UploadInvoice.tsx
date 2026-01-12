import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, Image, X, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
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
      // Upload file to storage
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

      // Call the process-invoice edge function
      const { data: processedData, error: processError } = await supabase.functions.invoke('process-invoice', {
        body: {
          fileUrl: urlData.publicUrl,
          fileName: file.name,
          fileType: file.type,
        },
      });

      if (processError) throw processError;

      // Update processing steps
      setProcessingSteps(prev => prev.map(s => ({ ...s, status: 'complete' })));

      // Set extracted data for review
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
      setProcessingSteps(prev => prev.map((s, i) => 
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
    if (!extractedData || !file || !user) return;

    setUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;

      const { data: urlData } = supabase.storage
        .from('invoices')
        .getPublicUrl(fileName);

      // Save to database
      const { error: insertError } = await supabase.from('invoices').insert({
        user_id: user.id,
        file_url: urlData.publicUrl,
        file_name: file.name,
        file_type: file.type,
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

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Upload Invoice</h1>
          <p className="text-muted-foreground mt-1">
            Upload a PDF or image file to extract invoice data using AI
          </p>
        </div>

        {/* Upload Zone */}
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFile(null);
                      setExtractedData(null);
                    }}
                  >
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
                <Button
                  variant="outline"
                  onClick={() => {
                    setFile(null);
                    setExtractedData(null);
                    setProcessingSteps([]);
                  }}
                >
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
