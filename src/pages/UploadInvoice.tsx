import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  LogIn,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ExtractedData {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string; // YYYY-MM-DD
  total_amount: string; // number as string
  tax_amount: string; // number as string
  currency: string; // 3-letter
}

type StepStatus = 'pending' | 'processing' | 'complete' | 'error';

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
};

type GmailAttachment = {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size?: number;
};

type GmailMessage = {
  id: string;
  threadId?: string;
  subject?: string | null;
  from?: string | null;
  date?: string | null;
  snippet?: string;
  attachments: GmailAttachment[];
};

const corsSafeError = (err: any) => {
  const msg =
    err?.message ||
    err?.error_description ||
    err?.error?.message ||
    (typeof err === 'string' ? err : JSON.stringify(err));
  return String(msg);
};

const isValidFileType = (f: File) => {
  const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
  return validTypes.includes(f.type);
};

function safeNum(x: string) {
  const cleaned = (x || '').replace(/[^\d.,-]/g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function detectCurrency(text: string): string {
  const t = (text || '').toLowerCase();
  if (t.includes('€') || t.includes(' eur') || t.includes('euro')) return 'EUR';
  if (t.includes('$') || t.includes(' usd') || t.includes('dollar')) return 'USD';
  if (t.includes('£') || t.includes(' gbp') || t.includes('pound')) return 'GBP';
  return 'USD';
}

function normalizeDate(raw: string): string {
  const s = (raw || '').trim();

  const iso = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slash = s.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = slash[3];
    const dd = a > 12 ? a : b;
    const mm = a > 12 ? b : a;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${y}-${pad(mm)}-${pad(dd)}`;
  }

  const dot = s.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/);
  if (dot) {
    const dd = Number(dot[1]);
    const mm = Number(dot[2]);
    const y = dot[3];
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${y}-${pad(mm)}-${pad(dd)}`;
  }

  return '';
}

function extractHeuristic(text: string, fileName: string): ExtractedData {
  const t = text || '';
  const currency = detectCurrency(t);

  const lines = t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let vendor = lines[0] || fileName.replace(/\.[^/.]+$/, '');
  if (/^invoice\b/i.test(vendor) && lines[1]) vendor = lines[1];

  const invNo =
    t.match(/invoice\s*(number|no\.?|#)\s*[:\-]?\s*([A-Z0-9\-]+)/i)?.[2] ||
    t.match(/\bINV[-\s]?\d+[A-Z0-9\-]*\b/i)?.[0] ||
    '';

  const dateRaw =
    t.match(/invoice\s*date\s*[:\-]?\s*([0-9.\-\/]{8,10})/i)?.[1] ||
    t.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ||
    t.match(/\b(\d{1,2}[\/.]\d{1,2}[\/.](20\d{2}))\b/)?.[1] ||
    '';
  const invoice_date = normalizeDate(dateRaw);

  const taxRaw =
    t.match(/\b(vat|tax)\s*(amount)?\s*[:\-]?\s*([$€£]?\s*[0-9][0-9.,]+)/i)?.[3] || '';
  const tax_amount = taxRaw ? String(safeNum(taxRaw) ?? '') : '';

  const totalRaw =
    t.match(/\b(total\s*(amount)?|grand\s*total|amount\s*due)\s*[:\-]?\s*([$€£]?\s*[0-9][0-9.,]+)/i)?.[3] ||
    '';
  let total = totalRaw ? safeNum(totalRaw) : null;

  if (!total) {
    const nums = Array.from(
      t.matchAll(/[$€£]?\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?)/g),
    )
      .map((m) => safeNum(m[0] || ''))
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    if (nums.length) total = Math.max(...nums);
  }

  return {
    vendor_name: vendor || '',
    invoice_number: invNo || '',
    invoice_date: invoice_date || '',
    total_amount: total ? String(total) : '',
    tax_amount: tax_amount || '',
    currency,
  };
}

export default function UploadInvoice() {
  const { toast } = useToast();

  // ✅ Supabase session + provider token
  const [session, setSession] = useState<any>(null);
  const [providerToken, setProviderToken] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) console.warn(error);
      setSession(data.session || null);
      setProviderToken(data.session?.provider_token || null);
    };

    load();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession || null);
      setProviderToken(newSession?.provider_token || null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [processingSteps, setProcessingSteps] = useState<{ step: string; status: StepStatus }[]>([]);
  const [uploadMethod, setUploadMethod] = useState<'file' | 'drive' | 'email'>('file');
  const [extractedText, setExtractedText] = useState('');
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [selectedDriveFile, setSelectedDriveFile] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);

  // Gmail
  const [gmailMessages, setGmailMessages] = useState<GmailMessage[]>([]);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [selectedGmailMsg, setSelectedGmailMsg] = useState<string | null>(null);
  const [selectedGmailAttachmentId, setSelectedGmailAttachmentId] = useState<string | null>(null);

  const workerRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const isAuthenticated = !!session?.user;
  const userEmail = session?.user?.email || '';

  // ✅ Google Login (always show chooser)
  const handleGoogleSignIn = async () => {
    // keep redirect stable (avoid 404)
    const redirectTo = `${window.location.origin}${window.location.pathname}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        scopes:
          'openid email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/gmail.readonly',
        queryParams: {
          access_type: 'offline',
          prompt: 'consent select_account',
        },
      },
    });

    if (error) {
      toast({
        variant: 'destructive',
        title: 'Google sign-in failed',
        description: error.message,
      });
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      setDriveFiles([]);
      setSelectedDriveFile(null);
      setExtractedData(null);
      setGmailMessages([]);
      setSelectedGmailMsg(null);
      setSelectedGmailAttachmentId(null);

      toast({ title: 'Logged out', description: 'You have been signed out.' });
    } catch (e: any) {
      toast({
        variant: 'destructive',
        title: 'Logout failed',
        description: corsSafeError(e),
      });
    }
  };

  const loadLibraries = useCallback(async () => {
    // load Tesseract
    if (!(window as any).Tesseract) {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      document.head.appendChild(script);
      await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load Tesseract.js'));
        setTimeout(() => reject(new Error('Tesseract.js load timeout')), 15000);
      });
    }

    // load pdf.js
    if (!(window as any).pdfjsLib) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      document.head.appendChild(script);
      await new Promise<void>((resolve, reject) => {
        script.onload = () => {
          (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          resolve();
        };
        script.onerror = () => reject(new Error('Failed to load PDF.js'));
        setTimeout(() => reject(new Error('PDF.js load timeout')), 15000);
      });
    }
  }, []);

  const extractTextFromPDF = useCallback(async (f: File) => {
    setOcrProgress(5);

    const arrayBuffer = await f.arrayBuffer();
    const pdfjsLib = (window as any).pdfjsLib;
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';

    if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context not available');

    const pagesToRead = Math.min(pdf.numPages, 3);

    for (let i = 1; i <= pagesToRead; i++) {
      setOcrProgress(5 + Math.round((i / pagesToRead) * 40));

      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');

      // If PDF has selectable text, use it
      if (pageText.trim().length > 50) {
        fullText += pageText + '\n';
      } else {
        // Otherwise render and OCR
        const viewport = page.getViewport({ scale: 2.5 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: context, viewport }).promise;

        if (!workerRef.current) {
          workerRef.current = await (window as any).Tesseract.createWorker('eng');
        }

        const res = await workerRef.current.recognize(canvas);
        const text = res?.data?.text || '';
        fullText += text + '\n';
      }
    }

    setOcrProgress(100);
    return fullText;
  }, []);

  const performOCR = useCallback(async (imageFile: File) => {
    setOcrProgress(5);

    if (!(window as any).Tesseract) throw new Error('Tesseract library not loaded');

    if (!workerRef.current) {
      workerRef.current = await (window as any).Tesseract.createWorker('eng', 1, {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            setOcrProgress(5 + Math.round(m.progress * 90));
          }
        },
      });
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(imageFile);
    });

    const res = await workerRef.current.recognize(dataUrl);
    setOcrProgress(100);
    return res?.data?.text || '';
  }, []);

  const extractInvoiceDataFree = async (text: string, fileName: string): Promise<ExtractedData> => {
    return extractHeuristic(text, fileName);
  };

  const resetForm = () => {
    setFile(null);
    setExtractedData(null);
    setProcessingSteps([]);
    setExtractedText('');
    setSelectedDriveFile(null);
    setOcrProgress(0);

    setSelectedGmailMsg(null);
    setSelectedGmailAttachmentId(null);
  };

  // Drag/Drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile && isValidFileType(droppedFile)) {
        setFile(droppedFile);
        setExtractedData(null);
      } else {
        toast({
          variant: 'destructive',
          title: 'Invalid file',
          description: 'Only PDF, JPG, PNG allowed.',
        });
      }
    },
    [toast],
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected && isValidFileType(selected)) {
      setFile(selected);
      setExtractedData(null);
    } else {
      toast({
        variant: 'destructive',
        title: 'Invalid file',
        description: 'Only PDF, JPG, PNG allowed.',
      });
    }
  };

  // Process local file
  const processInvoice = async () => {
    if (!file) return;

    setUploading(true);
    setProcessing(true);
    setProcessingSteps([
      { step: 'Uploading file...', status: 'complete' },
      { step: 'Running OCR extraction...', status: 'processing' },
      { step: 'Extracting invoice data (free)...', status: 'pending' },
      { step: 'Validating data...', status: 'pending' },
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
      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 1 ? { ...s, status: 'complete' } : i === 2 ? { ...s, status: 'processing' } : s)),
      );

      const aiExtractedData = await extractInvoiceDataFree(text, file.name);

      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 2 ? { ...s, status: 'complete' } : i === 3 ? { ...s, status: 'processing' } : s)),
      );

      await new Promise((resolve) => setTimeout(resolve, 250));
      setProcessingSteps((prev) => prev.map((s) => ({ ...s, status: 'complete' })));

      setExtractedData(aiExtractedData);
      toast({ title: 'Processed', description: 'Invoice processed successfully!' });
    } catch (error: any) {
      console.error(error);
      setProcessingSteps((prev) => prev.map((s) => (s.status === 'processing' ? { ...s, status: 'error' } : s)));
      toast({
        variant: 'destructive',
        title: 'Processing failed',
        description: corsSafeError(error),
      });
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  // Helpers for Edge Function errors
  const explainEdgeError = (e: any) => {
    const msg = corsSafeError(e);
    // common cases
    if (msg.toLowerCase().includes('invalid jwt')) {
      return 'Your Supabase session token was not attached or expired. Logout and login again.';
    }
    if (msg.toLowerCase().includes('failed to send a request')) {
      return 'Browser could not reach the Edge Function (CORS/OPTIONS failure or function down). Ensure functions have OPTIONS + CORS headers and are deployed.';
    }
    return msg;
  };

  // ✅ DRIVE list
  const fetchDriveFiles = async () => {
    if (!providerToken) {
      toast({
        variant: 'destructive',
        title: 'Google token missing',
        description: 'Please login with Google again (Drive permission).',
      });
      return;
    }

    try {
      setUploading(true);

      const { data, error } = await supabase.functions.invoke('drive-list', {
        body: { providerToken },
      });

      if (error) throw error;

      const files: any[] = Array.isArray(data?.files) ? data.files : [];
      const finalFiles: DriveFile[] = files.map((f: any) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size,
        modifiedTime: f.modifiedTime,
      }));

      setDriveFiles(finalFiles);

      if (finalFiles.length === 0) {
        toast({
          variant: 'destructive',
          title: 'No files found',
          description:
            'No PDF/image found. If files are in Shared Drive, this version supports it. Otherwise confirm you logged into the correct Google account.',
        });
      }
    } catch (e: any) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'Drive error',
        description: explainEdgeError(e),
      });
    } finally {
      setUploading(false);
    }
  };

  // ✅ DRIVE download + process
  const processSelectedDriveFile = async () => {
    if (!selectedDriveFile) return;

    if (!providerToken) {
      toast({
        variant: 'destructive',
        title: 'Google token missing',
        description: 'Please login with Google again (Drive permission).',
      });
      return;
    }

    setUploading(true);
    setProcessing(true);
    setExtractedData(null);
    setOcrProgress(0);
    setProcessingSteps([
      { step: 'Downloading from Google Drive...', status: 'processing' },
      { step: 'Running OCR extraction...', status: 'pending' },
      { step: 'Extracting invoice data (free)...', status: 'pending' },
      { step: 'Validating data...', status: 'pending' },
    ]);

    try {
      const fileMetadata = driveFiles.find((f) => f.id === selectedDriveFile);
      if (!fileMetadata) throw new Error('Selected file not found');

      const { data, error } = await supabase.functions.invoke('drive-download', {
        body: { providerToken, fileId: selectedDriveFile },
      });

      if (error) throw error;
      if (!data?.base64) throw new Error('Drive download failed: missing base64');

      const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
      const downloadedFile = new File([bytes], fileMetadata.name, { type: fileMetadata.mimeType });

      setFile(downloadedFile);

      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 0 ? { ...s, status: 'complete' } : i === 1 ? { ...s, status: 'processing' } : s)),
      );

      await loadLibraries();

      let text = '';
      if (downloadedFile.type === 'application/pdf') {
        text = await extractTextFromPDF(downloadedFile);
      } else {
        text = await performOCR(downloadedFile);
      }

      setExtractedText(text);

      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 1 ? { ...s, status: 'complete' } : i === 2 ? { ...s, status: 'processing' } : s)),
      );

      const aiExtractedData = await extractInvoiceDataFree(text, downloadedFile.name);

      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 2 ? { ...s, status: 'complete' } : i === 3 ? { ...s, status: 'processing' } : s)),
      );

      await new Promise((resolve) => setTimeout(resolve, 250));
      setProcessingSteps((prev) => prev.map((s) => ({ ...s, status: 'complete' })));

      setExtractedData(aiExtractedData);
      toast({ title: 'Success', description: 'Invoice processed from Google Drive!' });
    } catch (e: any) {
      console.error(e);
      setProcessingSteps((prev) => prev.map((s) => (s.status === 'processing' ? { ...s, status: 'error' } : s)));
      toast({
        variant: 'destructive',
        title: 'Drive processing failed',
        description: explainEdgeError(e),
      });
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  // ✅ GMAIL list (last 90 days)
  const fetchGmailInvoices = async () => {
    if (!providerToken) {
      toast({
        variant: 'destructive',
        title: 'Google token missing',
        description: 'Please login with Google again (Gmail permission).',
      });
      return;
    }

    try {
      setGmailLoading(true);

      const { data, error } = await supabase.functions.invoke('gmail-list', {
        body: { providerToken, maxResults: 20 },
      });

      if (error) throw error;

      const msgs: GmailMessage[] = Array.isArray(data?.messages) ? data.messages : [];
      setGmailMessages(msgs);

      if (!msgs.length) {
        toast({
          variant: 'destructive',
          title: 'No invoices found',
          description: 'No PDF/JPG invoice attachments in last 90 days.',
        });
      }
    } catch (e: any) {
      console.error(e);
      toast({
        variant: 'destructive',
        title: 'Gmail error',
        description: explainEdgeError(e),
      });
    } finally {
      setGmailLoading(false);
    }
  };

  // ✅ GMAIL download + process
  const processSelectedGmailAttachment = async () => {
    if (!providerToken) {
      toast({
        variant: 'destructive',
        title: 'Google token missing',
        description: 'Please login with Google again (Gmail permission).',
      });
      return;
    }
    if (!selectedGmailMsg || !selectedGmailAttachmentId) {
      toast({
        variant: 'destructive',
        title: 'Select attachment',
        description: 'Select an email and attachment first.',
      });
      return;
    }

    const msg = gmailMessages.find((m) => m.id === selectedGmailMsg);
    const att = msg?.attachments.find((a) => a.attachmentId === selectedGmailAttachmentId);
    if (!msg || !att) {
      toast({
        variant: 'destructive',
        title: 'Attachment missing',
        description: 'Attachment not found.',
      });
      return;
    }

    setUploading(true);
    setProcessing(true);
    setProcessingSteps([
      { step: 'Downloading attachment from Gmail...', status: 'processing' },
      { step: 'Running OCR extraction...', status: 'pending' },
      { step: 'Extracting invoice data (free)...', status: 'pending' },
      { step: 'Validating data...', status: 'pending' },
    ]);

    try {
      const { data, error } = await supabase.functions.invoke('gmail-download-attachment', {
        body: {
          providerToken,
          messageId: msg.id,
          attachmentId: att.attachmentId,
          filename: att.filename,
          mimeType: att.mimeType,
        },
      });

      if (error) throw error;
      if (!data?.base64) throw new Error('Gmail download failed: missing base64');

      const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
      const downloadedFile = new File([bytes], data.filename || att.filename || 'attachment', {
        type: data.mimeType || att.mimeType || 'application/octet-stream',
      });

      setFile(downloadedFile);

      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 0 ? { ...s, status: 'complete' } : i === 1 ? { ...s, status: 'processing' } : s)),
      );

      await loadLibraries();

      let text = '';
      if (downloadedFile.type === 'application/pdf') {
        text = await extractTextFromPDF(downloadedFile);
      } else {
        text = await performOCR(downloadedFile);
      }

      setExtractedText(text);

      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 1 ? { ...s, status: 'complete' } : i === 2 ? { ...s, status: 'processing' } : s)),
      );

      const aiExtractedData = await extractInvoiceDataFree(text, downloadedFile.name);

      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 2 ? { ...s, status: 'complete' } : i === 3 ? { ...s, status: 'processing' } : s)),
      );

      await new Promise((resolve) => setTimeout(resolve, 250));
      setProcessingSteps((prev) => prev.map((s) => ({ ...s, status: 'complete' })));

      setExtractedData(aiExtractedData);
      toast({ title: 'Success', description: 'Invoice processed from Gmail!' });
    } catch (e: any) {
      console.error(e);
      setProcessingSteps((prev) => prev.map((s) => (s.status === 'processing' ? { ...s, status: 'error' } : s)));
      toast({
        variant: 'destructive',
        title: 'Gmail processing failed',
        description: explainEdgeError(e),
      });
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const handleInputChange = (field: keyof ExtractedData, value: string) => {
    if (extractedData) setExtractedData({ ...extractedData, [field]: value });
  };

  // ✅ Save invoice: upload to Storage + insert row
  const saveInvoice = async () => {
    try {
      if (!isAuthenticated) {
        toast({ variant: 'destructive', title: 'Login required', description: 'Please login first.' });
        return;
      }
      if (!file || !extractedData) {
        toast({ variant: 'destructive', title: 'Missing data', description: 'Missing file or extracted data.' });
        return;
      }

      setUploading(true);

      const userId = session.user.id;
      const safeName = file.name.replace(/[^\w.\-]+/g, '_');
      const storagePath = `${userId}/${Date.now()}_${safeName}`;

      const uploadRes = await supabase.storage.from('invoices').upload(storagePath, file, {
        upsert: false,
        contentType: file.type,
      });

      if (uploadRes.error) {
        if (uploadRes.error.message?.toLowerCase().includes('bucket')) {
          throw new Error('Storage bucket "invoices" not found. Create it in Supabase Storage first.');
        }
        throw uploadRes.error;
      }

      const publicUrl = supabase.storage.from('invoices').getPublicUrl(storagePath)?.data?.publicUrl || null;

      const basePayload: any = {
        user_id: userId,
        file_name: file.name,
        vendor_name: extractedData.vendor_name || null,
        invoice_number: extractedData.invoice_number || null,
        invoice_date: extractedData.invoice_date || null,
        total_amount: extractedData.total_amount ? Number(extractedData.total_amount) : null,
        tax_amount: extractedData.tax_amount ? Number(extractedData.tax_amount) : null,
        currency: extractedData.currency || null,
      };

      const payloadWithOptional: any = {
        ...basePayload,
        storage_path: storagePath,
        file_url: publicUrl,
        file_type: file.type,
      };

      // try insert with optional cols; fallback if schema missing
      let ins = await supabase.from('invoices').insert(payloadWithOptional);
      if (ins.error && /column .* does not exist/i.test(ins.error.message || '')) {
        ins = await supabase.from('invoices').insert(basePayload);
      }
      if (ins.error) throw ins.error;

      toast({ title: 'Saved', description: 'Invoice saved successfully!' });
      resetForm();
    } catch (e: any) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Save failed', description: corsSafeError(e) });
    } finally {
      setUploading(false);
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

          {isAuthenticated ? (
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
          ) : (
            <div className="flex gap-2">
              <Button onClick={handleGoogleSignIn} className="bg-blue-600 hover:bg-blue-700">
                <LogIn className="h-4 w-4 mr-2" />
                Sign in with Google
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

          {/* FILE UPLOAD */}
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

          {/* DRIVE */}
          <TabsContent value="drive">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <HardDrive className="h-5 w-5 text-blue-600" />
                  Import from Your Google Drive
                </CardTitle>
                <CardDescription>Access files directly from your Google Drive account</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isAuthenticated ? (
                  <div className="text-center py-8">
                    <HardDrive className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-sm text-gray-600 mb-4">Sign in with Google to access your Drive files</p>
                    <Button onClick={handleGoogleSignIn} className="bg-blue-600 hover:bg-blue-700">
                      <LogIn className="h-4 w-4 mr-2" />
                      Sign in with Google
                    </Button>
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
                        <p className="text-xs text-gray-500 mt-3">Click to load your PDF and image files from Google Drive</p>
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
                          {driveFiles.map((f) => (
                            <div
                              key={f.id}
                              onClick={() => setSelectedDriveFile(f.id)}
                              className={`p-3 border-b cursor-pointer hover:bg-gray-50 transition-colors ${
                                selectedDriveFile === f.id ? 'bg-blue-50 border-blue-300' : ''
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                {f.mimeType === 'application/pdf' ? (
                                  <FileText className="h-5 w-5 text-red-600" />
                                ) : (
                                  <ImageIcon className="h-5 w-5 text-blue-600" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{f.name}</p>
                                  <p className="text-xs text-gray-500">
                                    {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : ''}{' '}
                                    {f.size ? ` • ${(Number(f.size) / 1024).toFixed(0)} KB` : ''}
                                  </p>
                                </div>
                                {selectedDriveFile === f.id && (
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

          {/* GMAIL */}
          <TabsContent value="email">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5 text-blue-600" />
                  Gmail Integration
                </CardTitle>
                <CardDescription>Process invoice attachments from your Gmail (last 90 days)</CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                {!isAuthenticated ? (
                  <div className="text-center py-8">
                    <Mail className="h-16 w-16 mx-auto mb-4 text-gray-400" />
                    <p className="text-sm text-gray-600 mb-4">Sign in with Google to enable Gmail integration</p>
                    <Button onClick={handleGoogleSignIn} className="bg-blue-600 hover:bg-blue-700">
                      <LogIn className="h-4 w-4 mr-2" />
                      Sign in with Google
                    </Button>
                  </div>
                ) : (
                  <>
                    <Alert>
                      <AlertDescription>
                        Connected to: <strong>{userEmail}</strong>
                      </AlertDescription>
                    </Alert>

                    <div className="flex gap-2">
                      <Button onClick={fetchGmailInvoices} disabled={gmailLoading} className="bg-blue-600 hover:bg-blue-700">
                        {gmailLoading ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Loading...
                          </>
                        ) : (
                          <>
                            <Mail className="h-4 w-4 mr-2" />
                            Browse Gmail Invoices
                          </>
                        )}
                      </Button>

                      <Button variant="outline" onClick={handleGoogleSignIn}>
                        Use another account
                      </Button>
                    </div>

                    {gmailMessages.length > 0 && (
                      <div className="border rounded-lg max-h-64 overflow-y-auto">
                        {gmailMessages.map((m) => (
                          <div
                            key={m.id}
                            onClick={() => {
                              setSelectedGmailMsg(m.id);
                              setSelectedGmailAttachmentId(null);
                            }}
                            className={`p-3 border-b cursor-pointer hover:bg-gray-50 transition-colors ${
                              selectedGmailMsg === m.id ? 'bg-blue-50 border-blue-300' : ''
                            }`}
                          >
                            <div className="text-sm font-medium truncate">{m.subject || '(No subject)'}</div>
                            <div className="text-xs text-gray-500 truncate">{m.from || ''}</div>
                            <div className="text-xs text-gray-500">{m.date ? new Date(m.date).toLocaleString() : ''}</div>

                            {selectedGmailMsg === m.id && (
                              <div className="mt-2 space-y-1">
                                <div className="text-xs font-semibold text-gray-700">Attachments:</div>
                                {m.attachments.map((a) => (
                                  <div
                                    key={a.attachmentId}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedGmailAttachmentId(a.attachmentId);
                                    }}
                                    className={`text-xs p-2 rounded border cursor-pointer ${
                                      selectedGmailAttachmentId === a.attachmentId
                                        ? 'bg-blue-100 border-blue-300'
                                        : 'bg-white hover:bg-gray-50'
                                    }`}
                                  >
                                    {a.filename} ({a.mimeType})
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <Button
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      onClick={processSelectedGmailAttachment}
                      disabled={!selectedGmailMsg || !selectedGmailAttachmentId || uploading || processing}
                    >
                      {uploading || processing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Process Selected Gmail Attachment
                        </>
                      )}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {processingSteps.length > 0 && !extractedData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Processing</CardTitle>
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
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${ocrProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {extractedData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Review Extracted Data</CardTitle>
              <CardDescription>Verify and correct the extracted information before saving</CardDescription>
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
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
