import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Upload,
  FileText,
  Image,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mail,
  HardDrive,
  LogIn,
  RefreshCw,
} from 'lucide-react';

interface ExtractedData {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: string;
  tax_amount: string;
  currency: string;
}

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
};

type GmailMessage = {
  id: string;
  subject?: string;
  from?: string;
  internalDate?: string;
  attachments?: { filename: string; mimeType: string; size: number; attachmentId: string }[];
};

export default function UploadInvoice() {
  // -----------------------------
  // AUTH (Supabase)
  // -----------------------------
  const [session, setSession] = useState<any>(null);
  const [providerToken, setProviderToken] = useState<string | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session || null);
      setProviderToken((data.session as any)?.provider_token || null);
      setLoadingSession(false);
    };

    init();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession || null);
      setProviderToken((newSession as any)?.provider_token || null);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const isAuthenticated = !!session?.user;
  const userEmail = session?.user?.email;
  const userId = session?.user?.id;

  // -----------------------------
  // UI States
  // -----------------------------
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [processingSteps, setProcessingSteps] = useState<{
    step: string;
    status: 'pending' | 'processing' | 'complete' | 'error';
  }[]>([]);
  const [uploadMethod, setUploadMethod] = useState<'file' | 'drive' | 'email'>('file');
  const [extractedText, setExtractedText] = useState('');
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [selectedDriveFile, setSelectedDriveFile] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);

  // Gmail
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailMessages, setGmailMessages] = useState<GmailMessage[]>([]);

  const workerRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // -----------------------------
  // Helpers: Edge invoke with real errors
  // -----------------------------
  const invokeEdge = async (fn: string, body: any) => {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) throw new Error(`${fn} invoke failed: ${error.message}`);

    // our edge functions should return { ok: true/false, ... }
    if (!data?.ok) {
      const msg =
        `${fn} failed: ${data?.error || 'Unknown error'}\n` +
        (data?.status ? `status: ${data.status}\n` : '') +
        (data?.details ? `details: ${data.details}` : '');
      throw new Error(msg.trim());
    }

    return data;
  };

  // provider_token must be OAuth token (NOT AIza api key)
  const getProviderToken = async () => {
    // session provider_token
    const { data } = await supabase.auth.getSession();
    const pt = (data.session as any)?.provider_token as string | undefined;
    return pt || null;
  };

  // -----------------------------
  // Google Login (with select account)
  // -----------------------------
  const handleGoogleSignIn = async (forceSelectAccount = false) => {
    const redirectTo = `${window.location.origin}/invoice-upload`;

    const scopes =
      'email profile ' +
      'https://www.googleapis.com/auth/drive.readonly ' +
      'https://www.googleapis.com/auth/gmail.readonly';

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        scopes,
        queryParams: forceSelectAccount
          ? { prompt: 'select_account consent' }
          : { prompt: 'consent' },
      },
    });

    if (error) alert(`Google sign-in error: ${error.message}`);
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      setDriveFiles([]);
      setSelectedDriveFile(null);
      setExtractedData(null);
      setFile(null);
      setExtractedText('');
      setOcrProgress(0);
      setGmailMessages([]);
    } catch (e: any) {
      console.error('Sign out error:', e);
    }
  };

  // -----------------------------
  // Drag/Drop
  // -----------------------------
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const isValidFileType = (f: File) => {
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    return validTypes.includes(f.type);
  };

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

  // -----------------------------
  // OCR libraries
  // -----------------------------
  const loadLibraries = useCallback(async () => {
    try {
      if (!(window as any).Tesseract) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        document.head.appendChild(script);
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load Tesseract.js'));
          setTimeout(() => reject(new Error('Tesseract.js load timeout')), 10000);
        });
      }

      if (!(window as any).pdfjsLib) {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        document.head.appendChild(script);
        await new Promise((resolve, reject) => {
          script.onload = () => {
            (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
              'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            resolve(null);
          };
          script.onerror = () => reject(new Error('Failed to load PDF.js'));
          setTimeout(() => reject(new Error('PDF.js load timeout')), 10000);
        });
      }

      return true;
    } catch (error) {
      console.error('Library loading error:', error);
      throw error;
    }
  }, []);

  const extractTextFromPDF = useCallback(async (f: File) => {
    setOcrProgress(10);
    const arrayBuffer = await f.arrayBuffer();
    const pdfjsLib = (window as any).pdfjsLib;
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      setOcrProgress(10 + (i / Math.min(pdf.numPages, 3)) * 40);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');

      if (pageText.trim().length > 50) {
        fullText += pageText + '\n';
      } else {
        const viewport = page.getViewport({ scale: 2.0 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // @ts-ignore
        await page.render({ canvasContext: context, viewport }).promise;

        if (!workerRef.current) {
          workerRef.current = await (window as any).Tesseract.createWorker('eng');
        }

        const { data: { text } } = await workerRef.current.recognize(canvas);
        fullText += text + '\n';
      }
    }

    setOcrProgress(100);
    return fullText;
  }, []);

  const performOCR = useCallback(async (imageFile: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          setOcrProgress(10);

          if (!(window as any).Tesseract) throw new Error('Tesseract library not loaded');

          if (!workerRef.current) {
            workerRef.current = await (window as any).Tesseract.createWorker('eng', 1, {
              logger: (m: any) => {
                if (m.status === 'recognizing text') {
                  setOcrProgress(10 + Math.round(m.progress * 80));
                }
              },
            });
          }

          const { data: { text } } = await workerRef.current.recognize(e.target?.result);
          setOcrProgress(100);
          resolve(text);
        } catch (error) {
          console.error('OCR Error:', error);
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(imageFile);
    });
  }, []);

  // -----------------------------
  // FREE extraction (no API keys)
  // -----------------------------
  const extractWithHeuristics = (text: string, fileName: string): ExtractedData => {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    const lower = cleaned.toLowerCase();

    // invoice number
    const invMatch =
      cleaned.match(/invoice\s*(no\.|number|#)?\s*[:\-]?\s*([A-Z0-9\-]+)/i) ||
      cleaned.match(/\bINV[-\s]?\d{3,}\b/i);

    const invoice_number =
      (invMatch && (invMatch[2] || invMatch[0])) ? String(invMatch[2] || invMatch[0]).trim() : '';

    // date
    const dateMatch =
      cleaned.match(/\b(\d{4}-\d{2}-\d{2})\b/) ||
      cleaned.match(/\b(\d{2}\/\d{2}\/\d{4})\b/) ||
      cleaned.match(/\b(\d{2}\.\d{2}\.\d{4})\b/);

    let invoice_date = '';
    if (dateMatch?.[1]) {
      const d = dateMatch[1];
      if (d.includes('/')) {
        const [mm, dd, yyyy] = d.split('/');
        invoice_date = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      } else if (d.includes('.')) {
        const [dd, mm, yyyy] = d.split('.');
        invoice_date = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      } else {
        invoice_date = d;
      }
    }

    // totals
    const totalMatch =
      cleaned.match(/total\s*(amount)?\s*[:\-]?\s*([$€£]?\s*\d+[.,]?\d*)/i) ||
      cleaned.match(/\bgrand\s*total\s*[:\-]?\s*([$€£]?\s*\d+[.,]?\d*)/i);

    const taxMatch =
      cleaned.match(/(tax|vat)\s*[:\-]?\s*([$€£]?\s*\d+[.,]?\d*)/i) ||
      cleaned.match(/\bVAT\s*\d+%?\s*([$€£]?\s*\d+[.,]?\d*)/i);

    const normalizeNum = (v: string) =>
      v
        .replace(/[^\d.,]/g, '')
        .replace(',', '.');

    const total_amount = totalMatch?.[2] ? normalizeNum(totalMatch[2]) : '';
    const tax_amount = taxMatch?.[2] ? normalizeNum(taxMatch[2]) : '';

    // currency guess
    let currency = 'USD';
    if (lower.includes('€') || lower.includes('eur')) currency = 'EUR';
    if (lower.includes('£') || lower.includes('gbp')) currency = 'GBP';
    if (lower.includes('$') || lower.includes('usd')) currency = 'USD';

    // vendor guess: use first non-empty line or filename
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const vendor_name = lines[0]?.slice(0, 60) || fileName.replace(/\.[^/.]+$/, '');

    return {
      vendor_name,
      invoice_number,
      invoice_date,
      total_amount,
      tax_amount,
      currency,
    };
  };

  // -----------------------------
  // Process local file
  // -----------------------------
  const processInvoice = async () => {
    if (!file) return;

    setUploading(true);
    setProcessing(true);
    setProcessingSteps([
      { step: 'Uploading file...', status: 'complete' },
      { step: 'Running OCR extraction...', status: 'processing' },
      { step: 'Extracting invoice data...', status: 'pending' },
      { step: 'Validating data...', status: 'pending' },
    ]);

    try {
      await loadLibraries();

      let text = '';
      if (file.type === 'application/pdf') text = await extractTextFromPDF(file);
      else text = await performOCR(file);

      setExtractedText(text);
      setProcessingSteps(prev =>
        prev.map((s, i) => (i === 1 ? { ...s, status: 'complete' } : i === 2 ? { ...s, status: 'processing' } : s))
      );

      const parsed = extractWithHeuristics(text, file.name);

      setProcessingSteps(prev =>
        prev.map((s, i) => (i === 2 ? { ...s, status: 'complete' } : i === 3 ? { ...s, status: 'processing' } : s))
      );

      await new Promise(resolve => setTimeout(resolve, 300));
      setProcessingSteps(prev => prev.map(s => ({ ...s, status: 'complete' })));

      setExtractedData(parsed);
      alert('Invoice processed successfully!');
    } catch (error: any) {
      console.error('Error processing invoice:', error);
      setProcessingSteps(prev => prev.map(s => (s.status === 'processing' ? { ...s, status: 'error' } : s)));
      alert(`Processing failed: ${error.message}`);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  // -----------------------------
  // Drive: list files
  // -----------------------------
  const fetchDriveFiles = async () => {
    try {
      setUploading(true);

      const pt = await getProviderToken();
      if (!pt) {
        alert('Google token missing. Logout and login again with Google (Drive scope).');
        return;
      }

      const data = await invokeEdge('drive-list', { providerToken: pt });
      const files = (data.files || []) as DriveFile[];
      setDriveFiles(files);

      if (!files.length) alert('No PDF or image files found in your Google Drive.');
    } catch (e: any) {
      console.error('Drive fetch error:', e);
      alert(`Error fetching files: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  // -----------------------------
  // Drive: download file via edge function
  // -----------------------------
  const downloadDriveFile = async (fileId: string): Promise<File> => {
    const pt = await getProviderToken();
    if (!pt) throw new Error('Missing Google provider token. Re-login with Google.');

    const data = await invokeEdge('drive-download', { providerToken: pt, fileId });
    const base64 = data.base64 as string;
    if (!base64) throw new Error('drive-download returned no base64');

    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes]);

    const meta = driveFiles.find(f => f.id === fileId);
    const name = meta?.name || `drive-file-${fileId}`;
    const mimeType = meta?.mimeType || blob.type || 'application/octet-stream';

    return new File([blob], name, { type: mimeType });
  };

  const processSelectedDriveFile = async () => {
    if (!selectedDriveFile) return;

    setUploading(true);
    setProcessing(true);
    setProcessingSteps([
      { step: 'Downloading from Google Drive...', status: 'processing' },
      { step: 'Running OCR extraction...', status: 'pending' },
      { step: 'Extracting invoice data...', status: 'pending' },
      { step: 'Validating data...', status: 'pending' },
    ]);

    try {
      const downloadedFile = await downloadDriveFile(selectedDriveFile);
      setFile(downloadedFile);

      setProcessingSteps(prev => prev.map((s, i) => (i === 0 ? { ...s, status: 'complete' } : i === 1 ? { ...s, status: 'processing' } : s)));

      await loadLibraries();

      let text = '';
      if (downloadedFile.type === 'application/pdf') text = await extractTextFromPDF(downloadedFile);
      else text = await performOCR(downloadedFile);

      setExtractedText(text);

      setProcessingSteps(prev => prev.map((s, i) => (i === 1 ? { ...s, status: 'complete' } : i === 2 ? { ...s, status: 'processing' } : s)));

      const parsed = extractWithHeuristics(text, downloadedFile.name);

      setProcessingSteps(prev => prev.map((s, i) => (i === 2 ? { ...s, status: 'complete' } : i === 3 ? { ...s, status: 'processing' } : s)));

      await new Promise(resolve => setTimeout(resolve, 300));
      setProcessingSteps(prev => prev.map(s => ({ ...s, status: 'complete' })));

      setExtractedData(parsed);
      alert('Invoice processed successfully from Google Drive!');
    } catch (error: any) {
      console.error('Processing error:', error);
      setProcessingSteps(prev => prev.map(s => (s.status === 'processing' ? { ...s, status: 'error' } : s)));
      alert(`Error: ${error.message}`);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  // -----------------------------
  // Gmail: list invoice emails (last 90 days)
  // -----------------------------
  const fetchGmailInvoices = async () => {
    try {
      setGmailLoading(true);

      const pt = await getProviderToken();
      if (!pt) {
        alert('Google token missing. Logout and login again with Google (Gmail scope).');
        return;
      }

      const data = await invokeEdge('gmail-list', { providerToken: pt });
      const msgs = (data.messages || []) as GmailMessage[];
      setGmailMessages(msgs);

      if (!msgs.length) alert('No invoice emails found in last 90 days (with PDF/JPG/PNG attachments).');
    } catch (e: any) {
      console.error('Gmail list error:', e);
      alert(`Gmail error: ${e.message}`);
    } finally {
      setGmailLoading(false);
    }
  };

  // -----------------------------
  // Save invoice: upload file to storage + insert row
  // -----------------------------
  const saveInvoice = async () => {
    try {
      if (!extractedData || !file) return;

      if (!isAuthenticated || !userId) {
        alert('Please login first to save invoices.');
        return;
      }

      setUploading(true);

      // 1) Upload file to storage bucket "invoices"
      // Make sure bucket exists in Supabase: Storage -> New bucket -> invoices
      const ext = file.name.split('.').pop() || 'bin';
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${userId}/${Date.now()}_${safeName}`;

      const { error: upErr } = await supabase
        .storage
        .from('invoices')
        .upload(storagePath, file, { upsert: true, contentType: file.type });

      if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

      // 2) Public URL (only works if bucket is public; otherwise you can use signed URLs later)
      const { data: pub } = supabase.storage.from('invoices').getPublicUrl(storagePath);
      const fileUrl = pub?.publicUrl || null;

      // 3) Insert invoice row
      const insertObj: any = {
        user_id: userId,
        file_name: file.name,
        file_type: file.type,
        file_url: fileUrl,
        vendor_name: extractedData.vendor_name || null,
        invoice_number: extractedData.invoice_number || null,
        invoice_date: extractedData.invoice_date || null,
        total_amount: extractedData.total_amount ? Number(extractedData.total_amount) : null,
        tax_amount: extractedData.tax_amount ? Number(extractedData.tax_amount) : null,
        currency: extractedData.currency || null,
        storage_path: storagePath, // remove this line if your table doesn't have storage_path
        source: uploadMethod,       // optional column, remove if not exists
      };

      const { error: insErr } = await supabase.from('invoices').insert(insertObj);
      if (insErr) throw new Error(`DB insert failed: ${insErr.message}`);

      alert('Invoice saved successfully!');
      resetForm();
    } catch (e: any) {
      console.error('Save error:', e);
      alert(`Save failed: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (field: keyof ExtractedData, value: string) => {
    if (extractedData) setExtractedData({ ...extractedData, [field]: value });
  };

  const resetForm = () => {
    setFile(null);
    setExtractedData(null);
    setProcessingSteps([]);
    setExtractedText('');
    setSelectedDriveFile(null);
    setOcrProgress(0);
  };

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">Upload Invoice</h1>
            <p className="text-gray-600 mt-1">
              Upload invoices via file, Google Drive, or email
            </p>
          </div>

          {!loadingSession && isAuthenticated && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs text-gray-500">Logged in as</p>
                <p className="text-sm font-medium">{userEmail}</p>
              </div>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                <X className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          )}
        </div>

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

          {/* ---------------- FILE TAB ---------------- */}
          <TabsContent value="file">
            <Card>
              <CardContent className="p-6">
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                    isDragging ? 'border-blue-500 bg-blue-50' : file ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {file ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-center gap-3">
                        {file.type === 'application/pdf' ? (
                          <FileText className="h-12 w-12 text-blue-600" />
                        ) : (
                          <Image className="h-12 w-12 text-blue-600" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{file.name}</p>
                        <p className="text-sm text-gray-600">
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
                      <div className="p-4 rounded-full bg-blue-100 w-fit mx-auto">
                        <Upload className="h-8 w-8 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium">Drop your invoice here</p>
                        <p className="text-sm text-gray-600">
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
                      className="w-full bg-blue-600 hover:bg-blue-700"
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

          {/* ---------------- DRIVE TAB ---------------- */}
          <TabsContent value="drive">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <HardDrive className="h-5 w-5 text-blue-600" />
                  Import from Your Google Drive
                </CardTitle>
                <CardDescription>
                  Access files directly from your Google Drive account
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isAuthenticated ? (
                  <div className="text-center py-8">
                    <HardDrive className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-sm text-gray-600 mb-4">
                      Sign in with Google to access your Drive files
                    </p>

                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <Button
                        onClick={() => handleGoogleSignIn(false)}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <LogIn className="h-4 w-4 mr-2" />
                        Sign in with Google
                      </Button>

                      <Button
                        onClick={() => handleGoogleSignIn(true)}
                        variant="outline"
                      >
                        <LogIn className="h-4 w-4 mr-2" />
                        Use another account
                      </Button>
                    </div>

                    <p className="text-xs text-gray-500 mt-4">
                      You will be able to browse and select invoice files from your Google Drive
                    </p>
                  </div>
                ) : (
                  <>
                    <Alert>
                      <AlertDescription>
                        Logged in as: <strong>{userEmail}</strong>
                      </AlertDescription>
                    </Alert>

                    {driveFiles.length === 0 ? (
                      <div className="text-center py-6">
                        <Button onClick={fetchDriveFiles} disabled={uploading} className="bg-blue-600 hover:bg-blue-700">
                          {uploading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              Loading...
                            </>
                          ) : (
                            <>
                              <HardDrive className="h-4 w-4 mr-2" />
                              Browse My Drive Files
                            </>
                          )}
                        </Button>
                        <p className="text-xs text-gray-500 mt-3">
                          Click to load your PDF and image files from Google Drive
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <Label>Select a file from your Drive:</Label>
                          <Button variant="ghost" size="sm" onClick={fetchDriveFiles}>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Refresh
                          </Button>
                        </div>
                        <div className="border rounded-lg max-h-64 overflow-y-auto">
                          {driveFiles.map((df) => (
                            <div
                              key={df.id}
                              onClick={() => setSelectedDriveFile(df.id)}
                              className={`p-3 border-b cursor-pointer hover:bg-gray-50 transition-colors ${
                                selectedDriveFile === df.id ? 'bg-blue-50 border-blue-300' : ''
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                {df.mimeType === 'application/pdf' ? (
                                  <FileText className="h-5 w-5 text-red-600" />
                                ) : (
                                  <Image className="h-5 w-5 text-blue-600" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{df.name}</p>
                                  <p className="text-xs text-gray-500">
                                    {df.modifiedTime ? new Date(df.modifiedTime).toLocaleDateString() : ''}{' '}
                                    {df.size ? `• ${(Number(df.size) / 1024).toFixed(0)} KB` : ''}
                                  </p>
                                </div>
                                {selectedDriveFile === df.id && (
                                  <CheckCircle2 className="h-5 w-5 text-blue-600 flex-shrink-0" />
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <Button
                          className="w-full bg-blue-600 hover:bg-blue-700"
                          onClick={processSelectedDriveFile}
                          disabled={!selectedDriveFile || uploading || processing}
                        >
                          {uploading || processing ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin mr-2" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <Upload className="h-4 w-4 mr-2" />
                              Process Selected File
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- EMAIL TAB ---------------- */}
          <TabsContent value="email">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5 text-blue-600" />
                  Gmail Integration
                </CardTitle>
                <CardDescription>
                  List invoice emails from last 90 days with attachments
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!isAuthenticated ? (
                  <div className="text-center py-8">
                    <Mail className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-sm text-gray-600 mb-4">
                      Sign in with Google to enable Gmail integration
                    </p>

                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                      <Button
                        onClick={() => handleGoogleSignIn(false)}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <LogIn className="h-4 w-4 mr-2" />
                        Sign in with Google
                      </Button>

                      <Button
                        onClick={() => handleGoogleSignIn(true)}
                        variant="outline"
                      >
                        <LogIn className="h-4 w-4 mr-2" />
                        Use another account
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Alert>
                      <AlertDescription>
                        Connected to: <strong>{userEmail}</strong>
                      </AlertDescription>
                    </Alert>

                    <Button
                      onClick={fetchGmailInvoices}
                      disabled={gmailLoading}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {gmailLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Loading Gmail...
                        </>
                      ) : (
                        <>
                          <Mail className="h-4 w-4 mr-2" />
                          Fetch invoice emails (90 days)
                        </>
                      )}
                    </Button>

                    {gmailMessages.length > 0 && (
                      <div className="border rounded-lg max-h-80 overflow-y-auto">
                        {gmailMessages.map((m) => (
                          <div key={m.id} className="p-3 border-b">
                            <p className="text-sm font-medium">{m.subject || '(No subject)'}</p>
                            <p className="text-xs text-gray-500">{m.from}</p>
                            <p className="text-xs text-gray-500">
                              {m.internalDate ? new Date(Number(m.internalDate)).toLocaleString() : ''}
                            </p>
                            <div className="mt-2 text-xs text-gray-600">
                              {(m.attachments || []).map((a, idx) => (
                                <div key={idx} className="flex items-center justify-between">
                                  <span>{a.filename} ({Math.round((a.size || 0) / 1024)} KB)</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Processing */}
        {processingSteps.length > 0 && !extractedData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">AI Processing</CardTitle>
              <CardDescription>Workflow in progress</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {processingSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  {step.status === 'pending' && <div className="h-5 w-5 rounded-full border-2 border-gray-300" />}
                  {step.status === 'processing' && <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />}
                  {step.status === 'complete' && <CheckCircle2 className="h-5 w-5 text-green-600" />}
                  {step.status === 'error' && <AlertCircle className="h-5 w-5 text-red-600" />}
                  <span
                    className={`text-sm ${
                      step.status === 'pending'
                        ? 'text-gray-500'
                        : step.status === 'processing'
                        ? 'text-gray-900 font-medium'
                        : step.status === 'complete'
                        ? 'text-green-600'
                        : 'text-red-600'
                    }`}
                  >
                    {step.step}
                  </span>
                </div>
              ))}

              {ocrProgress > 0 && ocrProgress < 100 && (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>OCR Progress</span>
                    <span>{ocrProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-blue-600 h-2 rounded-full transition-all duration-300" style={{ width: `${ocrProgress}%` }} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Review + Save */}
        {extractedData && (
          <Card>
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

              {extractedText && (
                <details className="mt-4">
                  <summary className="text-sm font-semibold text-gray-700 cursor-pointer hover:text-blue-600">
                    View extracted text ({extractedText.length} characters)
                  </summary>
                  <pre className="mt-3 p-4 bg-gray-50 rounded-lg text-xs overflow-auto max-h-48 border-2 border-gray-200">
                    {extractedText}
                  </pre>
                </details>
              )}

              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={resetForm}>
                  Cancel
                </Button>

                <Button
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
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
    </div>
  );
}
