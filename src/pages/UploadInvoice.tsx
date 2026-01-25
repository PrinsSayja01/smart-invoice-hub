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
  Image as ImageIcon,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Mail,
  HardDrive,
} from 'lucide-react';

declare global {
  interface Window {
    google?: any;
    gapi?: any;
  }
}

interface ExtractedData {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string; // YYYY-MM-DD
  total_amount: string; // number as string
  tax_amount: string;   // number as string
  currency: string;     // USD/EUR/GBP etc
}

type StepStatus = 'pending' | 'processing' | 'complete' | 'error';

export default function UploadInvoice() {
  // ---------- AUTH (Supabase app login) ----------
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  const isAuthenticated = !!session?.user;
  const userEmail = session?.user?.email;

  // ---------- UI STATE ----------
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [processingSteps, setProcessingSteps] = useState<{ step: string; status: StepStatus }[]>([]);
  const [uploadMethod, setUploadMethod] = useState<'file' | 'drive' | 'email'>('file');
  const [extractedText, setExtractedText] = useState('');
  const [ocrProgress, setOcrProgress] = useState(0);

  const workerRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // ---------- GOOGLE PICKER STATE ----------
  const [googleReady, setGoogleReady] = useState(false);
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);

  const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
  const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  // ---------- HELPERS ----------
  const isValidFileType = (f: File) => {
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    return validTypes.includes(f.type);
  };

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

  const resetForm = () => {
    setFile(null);
    setExtractedData(null);
    setProcessingSteps([]);
    setExtractedText('');
    setOcrProgress(0);
  };

  // ---------- LOAD OCR LIBS ----------
  const loadLibraries = useCallback(async () => {
    try {
      if (!(window as any).Tesseract) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        document.head.appendChild(script);
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load Tesseract.js'));
          setTimeout(() => reject(new Error('Tesseract.js load timeout')), 15000);
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
          setTimeout(() => reject(new Error('PDF.js load timeout')), 15000);
        });
      }

      return true;
    } catch (error) {
      console.error('Library loading error:', error);
      throw error;
    }
  }, []);

  const extractTextFromPDF = useCallback(async (pdfFile: File) => {
    setOcrProgress(10);
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdfjsLib = (window as any).pdfjsLib;
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';

    if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      setOcrProgress(10 + Math.round((i / Math.min(pdf.numPages, 3)) * 40));

      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');

      if (pageText.trim().length > 50) {
        fullText += pageText + '\n';
      } else {
        const viewport = page.getViewport({ scale: 2.0 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        if (!context) throw new Error('Canvas context missing');

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

  // ---------- FREE LOCAL EXTRACTION (NO PAID API) ----------
  const extractWithHeuristics = (text: string): ExtractedData => {
    const t = text.replace(/\s+/g, ' ').trim();

    const currency =
      /\bEUR\b/i.test(t) ? 'EUR' :
      /\bGBP\b/i.test(t) ? 'GBP' :
      /\bUSD\b/i.test(t) ? 'USD' :
      /€/.test(t) ? 'EUR' :
      /£/.test(t) ? 'GBP' :
      /\$/.test(t) ? 'USD' : 'USD';

    const invoiceNumber =
      (t.match(/\b(?:invoice|inv)\s*(?:no|number|#)?\s*[:\-]?\s*([A-Z0-9\-\/]+)/i)?.[1]) ||
      (t.match(/\bINV[-\/]?\d{3,}\b/i)?.[0]) ||
      '';

    const dateRaw =
      t.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1] ||
      t.match(/\b(\d{2}\/\d{2}\/\d{4})\b/)?.[1] ||
      t.match(/\b(\d{2}\.\d{2}\.\d{4})\b/)?.[1] ||
      '';

    const normalizeDate = (d: string) => {
      if (!d) return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
        const [mm, dd, yyyy] = d.split('/');
        return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      }
      if (/^\d{2}\.\d{2}\.\d{4}$/.test(d)) {
        const [dd, mm, yyyy] = d.split('.');
        return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      }
      return '';
    };

    const invoiceDate = normalizeDate(dateRaw);

    const pickAmount = (labelRegex: RegExp) => {
      const m = t.match(labelRegex);
      if (!m) return '';
      const raw = m[1].replace(/,/g, '');
      const n = Number(raw);
      return Number.isFinite(n) ? String(n) : '';
    };

    const total =
      pickAmount(/\b(?:total|amount\s+due|grand\s+total)\b\s*[:\-]?\s*[€$£]?\s*([0-9]+(?:\.[0-9]{1,2})?)/i) ||
      (t.match(/[€$£]\s*([0-9]+(?:\.[0-9]{1,2})?)/)?.[1] ?? '');

    const tax =
      pickAmount(/\b(?:tax|vat)\b\s*[:\-]?\s*[€$£]?\s*([0-9]+(?:\.[0-9]{1,2})?)/i) || '';

    const vendor =
      (t.match(/\bfrom\b\s*[:\-]?\s*([A-Za-z0-9 &.,\-]{3,60})/i)?.[1]) ||
      (t.split(' ').slice(0, 6).join(' ')) ||
      'Unknown Vendor';

    return {
      vendor_name: vendor.trim(),
      invoice_number: invoiceNumber.trim(),
      invoice_date: invoiceDate,
      total_amount: total ? String(Number(total)) : '',
      tax_amount: tax ? String(Number(tax)) : '',
      currency,
    };
  };

  // ---------- PROCESS FILE ----------
  const processInvoice = async () => {
    if (!file) return;

    setUploading(true);
    setProcessing(true);
    setProcessingSteps([
      { step: 'Preparing file...', status: 'complete' },
      { step: 'Running OCR extraction...', status: 'processing' },
      { step: 'Extracting invoice fields (free)...', status: 'pending' },
      { step: 'Ready to save', status: 'pending' },
    ]);

    try {
      await loadLibraries();

      let text = '';
      if (file.type === 'application/pdf') {
        text = await extractTextFromPDF(file);
      } else {
        text = await performOCR(file);
      }

      setExtractedText(text);
      setProcessingSteps(prev =>
        prev.map((s, i) =>
          i === 1 ? { ...s, status: 'complete' } : i === 2 ? { ...s, status: 'processing' } : s
        )
      );

      const parsed = extractWithHeuristics(text);

      setProcessingSteps(prev =>
        prev.map((s, i) =>
          i === 2 ? { ...s, status: 'complete' } : i === 3 ? { ...s, status: 'complete' } : s
        )
      );

      setExtractedData(parsed);
    } catch (error: any) {
      console.error('Error processing invoice:', error);
      setProcessingSteps(prev =>
        prev.map(s => (s.status === 'processing' ? { ...s, status: 'error' } : s))
      );
      alert(`Processing failed: ${error.message}`);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  // ---------- SAVE TO SUPABASE (Storage + Table) ----------
  const saveInvoice = async () => {
    if (!extractedData || !file) return;

    try {
      setUploading(true);

      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      const userId = authData.user?.id;
      if (!userId) throw new Error('Not logged in');

      // 1) Upload file to Storage bucket "invoices"
      const safeName = file.name.replace(/[^\w.\-]+/g, '_');
      const storagePath = `${userId}/${Date.now()}_${safeName}`;

      const { error: upErr } = await supabase.storage
        .from('invoices')
        .upload(storagePath, file, { upsert: false, contentType: file.type });

      if (upErr) throw upErr;

      // 2) Insert into invoices table
      const { error: insErr } = await supabase.from('invoices').insert({
        user_id: userId,
        file_name: file.name,
        vendor_name: extractedData.vendor_name || null,
        invoice_number: extractedData.invoice_number || null,
        invoice_date: extractedData.invoice_date || null,
        total_amount: extractedData.total_amount ? Number(extractedData.total_amount) : null,
        tax_amount: extractedData.tax_amount ? Number(extractedData.tax_amount) : null,
        currency: extractedData.currency || null,
        storage_path: storagePath, // you must have this column, OR remove this line if your table doesn’t have it
      });

      if (insErr) throw insErr;

      alert('Invoice saved to Supabase!');
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

  // ---------- GOOGLE PICKER LOADER ----------
  useEffect(() => {
    if (!GOOGLE_API_KEY || !GOOGLE_CLIENT_ID) return;

    const loadScript = (src: string) =>
      new Promise<void>((resolve, reject) => {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) return resolve();
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load: ${src}`));
        document.head.appendChild(s);
      });

    (async () => {
      try {
        // GIS (token client)
        await loadScript('https://accounts.google.com/gsi/client');
        // Google API loader (picker)
        await loadScript('https://apis.google.com/js/api.js');
        setGoogleReady(true);
      } catch (e) {
        console.error(e);
        setGoogleReady(false);
      }
    })();
  }, [GOOGLE_API_KEY, GOOGLE_CLIENT_ID]);

  const openDrivePicker = async () => {
    try {
      if (!GOOGLE_API_KEY || !GOOGLE_CLIENT_ID) {
        alert('Missing VITE_GOOGLE_API_KEY or VITE_GOOGLE_CLIENT_ID');
        return;
      }
      if (!googleReady || !window.google || !window.gapi) {
        alert('Google scripts not loaded yet. Refresh and try again.');
        return;
      }

      // 1) Get Drive access token using Google Identity Services
      const token = await new Promise<string>((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: 'https://www.googleapis.com/auth/drive.readonly',
          callback: (resp: any) => {
            if (resp?.access_token) resolve(resp.access_token);
            else reject(new Error('No access token returned'));
          },
        });
        tokenClient.requestAccessToken({ prompt: 'consent' });
      });

      setDriveAccessToken(token);

      // 2) Load picker API and open Picker
      await new Promise<void>((resolve) => window.gapi.load('picker', { callback: resolve }));

      const view = new window.google.picker.DocsView()
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false)
        .setMimeTypes('application/pdf,image/png,image/jpeg');

      const picker = new window.google.picker.PickerBuilder()
        .setDeveloperKey(GOOGLE_API_KEY)
        .setOAuthToken(token)
        .addView(view)
        .setTitle('Select an invoice file')
        .setCallback(async (data: any) => {
          if (data.action !== window.google.picker.Action.PICKED) return;

          const doc = data.docs?.[0];
          if (!doc?.id) return;

          const fileId = doc.id;
          const name = doc.name || 'invoice';
          const mimeType = doc.mimeType || 'application/pdf';

          // Download the file bytes from Drive
          try {
            setUploading(true);
            const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!r.ok) {
              const txt = await r.text();
              throw new Error(`Drive download failed (${r.status}): ${txt}`);
            }

            const blob = await r.blob();
            const downloaded = new File([blob], name, { type: mimeType });

            if (!isValidFileType(downloaded)) {
              alert('Selected file type not supported. Use PDF/JPG/PNG.');
              return;
            }

            setFile(downloaded);
            setExtractedData(null);

            // Auto-process after selecting from Drive (optional)
            setTimeout(() => processInvoice(), 250);
          } catch (err: any) {
            console.error(err);
            alert(err.message);
          } finally {
            setUploading(false);
          }
        })
        .build();

      picker.setVisible(true);
    } catch (e: any) {
      console.error(e);
      alert(`Drive Picker error: ${e.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">Upload Invoice</h1>
            <p className="text-gray-600 mt-1">Upload invoices via file, Google Drive, or email</p>
          </div>

          {isAuthenticated && (
            <div className="text-right">
              <p className="text-xs text-gray-500">Logged in as</p>
              <p className="text-sm font-medium">{userEmail}</p>
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

          {/* FILE TAB */}
          <TabsContent value="file">
            <Card>
              <CardContent className="p-6">
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                    isDragging
                      ? 'border-blue-500 bg-blue-50'
                      : file
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {file ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-center gap-3">
                        {file.type === 'application/pdf' ? (
                          <FileText className="h-12 w-12 text-blue-600" />
                        ) : (
                          <ImageIcon className="h-12 w-12 text-blue-600" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{file.name}</p>
                        <p className="text-sm text-gray-600">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
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
                        <p className="text-sm text-gray-600">or click to browse • PDF, JPG, PNG up to 10MB</p>
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
                    <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={processInvoice} disabled={uploading || processing}>
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

          {/* DRIVE TAB (Picker) */}
          <TabsContent value="drive">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <HardDrive className="h-5 w-5 text-blue-600" />
                  Import from Google Drive (Picker)
                </CardTitle>
                <CardDescription>
                  This uses Google Drive Picker (no Supabase scopes required)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!GOOGLE_API_KEY || !GOOGLE_CLIENT_ID ? (
                  <Alert>
                    <AlertDescription>
                      Missing env vars. Add <strong>VITE_GOOGLE_API_KEY</strong> and <strong>VITE_GOOGLE_CLIENT_ID</strong> in Vercel and redeploy.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <Button
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      onClick={openDrivePicker}
                      disabled={uploading || processing || !googleReady}
                    >
                      {uploading || processing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Working...
                        </>
                      ) : (
                        <>
                          <HardDrive className="h-4 w-4 mr-2" />
                          Choose from Google Drive
                        </>
                      )}
                    </Button>

                    {driveAccessToken && (
                      <p className="text-xs text-gray-500">
                        Drive token acquired ✅
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* EMAIL TAB */}
          <TabsContent value="email">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5 text-blue-600" />
                  Gmail Integration
                </CardTitle>
                <CardDescription>Coming soon (you can add later)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-8 text-gray-500">
                  <Mail className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                  <p className="text-sm mb-2">Gmail integration coming soon!</p>
                  <p className="text-xs text-blue-600">Auto-scan inbox for invoice attachments</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* PROCESSING STEPS */}
        {processingSteps.length > 0 && !extractedData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Processing</CardTitle>
              <CardDescription>OCR + Free extraction</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {processingSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  {step.status === 'pending' && <div className="h-5 w-5 rounded-full border-2 border-gray-300" />}
                  {step.status === 'processing' && <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />}
                  {step.status === 'complete' && <CheckCircle2 className="h-5 w-5 text-green-600" />}
                  {step.status === 'error' && <AlertCircle className="h-5 w-5 text-red-600" />}
                  <span className="text-sm">{step.step}</span>
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

        {/* REVIEW + SAVE */}
        {extractedData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Review Extracted Data</CardTitle>
              <CardDescription>Verify and correct before saving</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="vendor_name">Vendor Name</Label>
                  <Input id="vendor_name" value={extractedData.vendor_name} onChange={(e) => handleInputChange('vendor_name', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice_number">Invoice Number</Label>
                  <Input id="invoice_number" value={extractedData.invoice_number} onChange={(e) => handleInputChange('invoice_number', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice_date">Invoice Date</Label>
                  <Input id="invoice_date" type="date" value={extractedData.invoice_date} onChange={(e) => handleInputChange('invoice_date', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Input id="currency" value={extractedData.currency} onChange={(e) => handleInputChange('currency', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="total_amount">Total Amount</Label>
                  <Input id="total_amount" type="number" step="0.01" value={extractedData.total_amount} onChange={(e) => handleInputChange('total_amount', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tax_amount">Tax/VAT Amount</Label>
                  <Input id="tax_amount" type="number" step="0.01" value={extractedData.tax_amount} onChange={(e) => handleInputChange('tax_amount', e.target.value)} />
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
                <Button className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={saveInvoice} disabled={uploading}>
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

              {!isAuthenticated && (
                <Alert>
                  <AlertDescription>
                    You are not logged in. Saving needs Supabase login.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
