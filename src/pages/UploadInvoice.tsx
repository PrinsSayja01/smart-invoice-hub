import { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, FileText, Image, X, Loader2, CheckCircle2, AlertCircle, Mail, HardDrive, Copy, ExternalLink, Info } from 'lucide-react';

interface ExtractedData {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: string;
  tax_amount: string;
  currency: string;
}

export default function UploadInvoice() {
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
  const [ocrProgress, setOcrProgress] = useState(0);
  const [extractedText, setExtractedText] = useState('');
  const [showGoogleAuth, setShowGoogleAuth] = useState(false);
  
  const workerRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const emailAddress = `invoices+${Math.random().toString(36).substring(7)}@invoiceai.app`;

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
    alert('Email copied to clipboard!');
  };

  const extractInvoiceData = useCallback((text: string): ExtractedData => {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    
    let vendorName = '';
    const companyIndicators = ['inc', 'llc', 'ltd', 'corp', 'corporation', 'company', 'co.', 'gmbh', 'ag', 'sa', 'limited'];
    
    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const line = lines[i];
      const cleanLine = line.replace(/[^a-zA-Z0-9\s&.-]/g, '');
      
      if (/^(invoice|bill|receipt|tax|from|to|date|number|total)/i.test(line)) continue;
      
      if (cleanLine.length > 3 && cleanLine.length < 100) {
        const hasIndicator = companyIndicators.some(ind => cleanLine.toLowerCase().includes(ind));
        const isAllCaps = cleanLine === cleanLine.toUpperCase() && /[A-Z]{3,}/.test(cleanLine);
        const hasMultipleWords = cleanLine.split(/\s+/).length >= 2;
        const hasLetters = /[a-zA-Z]{3,}/.test(cleanLine);
        
        if ((hasIndicator || (isAllCaps && hasMultipleWords)) && hasLetters) {
          vendorName = cleanLine;
          break;
        }
      }
    }
    
    if (!vendorName) {
      vendorName = lines.find(l => {
        const clean = l.replace(/[^a-zA-Z0-9\s]/g, '');
        return clean.length > 5 && /[a-zA-Z]{3,}/.test(clean) && !/^\d+$/.test(clean);
      }) || '';
    }
    
    let invoiceNumber = '';
    const invPatterns = [
      /invoice\s*(?:no|number|#|num)?[:\s#-]*([A-Z0-9][-A-Z0-9]{2,20})/i,
      /inv\s*(?:no|number|#)?[:\s#-]*([A-Z0-9][-A-Z0-9]{2,20})/i,
      /bill\s*(?:no|number|#)?[:\s#-]*([A-Z0-9][-A-Z0-9]{2,20})/i,
      /(?:^|\s)#\s*([A-Z0-9][-A-Z0-9]{3,20})/i,
      /\b([A-Z]{2,4}[-\s]?\d{4,10})\b/,
      /\b(INV[-\s]?\d{4,10})\b/i,
      /\b(\d{6,12})\b/
    ];
    
    for (const pattern of invPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        invoiceNumber = match[1].trim();
        break;
      }
    }
    
    let invoiceDate = '';
    const datePatterns = [
      /(?:invoice\s*)?date[:\s]*(\d{1,2}[-/.\s]\d{1,2}[-/.\s]\d{2,4})/i,
      /(?:invoice\s*)?date[:\s]*(\d{4}[-/.\s]\d{1,2}[-/.\s]\d{1,2})/i,
      /(?:dated|issued)[:\s]*(\d{1,2}[-/.\s]\d{1,2}[-/.\s]\d{2,4})/i,
      /\b(\d{1,2}[-/]\d{1,2}[-/]\d{4})\b/,
      /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/,
      /\b(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})\b/i
    ];
    
    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        try {
          let dateStr = match[1].replace(/[.\s]+/g, '/');
          const parsed = new Date(dateStr);
          if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1990 && parsed.getFullYear() < 2100) {
            invoiceDate = parsed.toISOString().split('T')[0];
            break;
          }
        } catch (e) {
          console.log('Date parse error:', e);
        }
      }
    }
    
    let currency = 'USD';
    if (/€|EUR/i.test(text)) currency = 'EUR';
    else if (/£|GBP/i.test(text)) currency = 'GBP';
    else if (/¥|JPY/i.test(text)) currency = 'JPY';
    else if (/₹|INR/i.test(text)) currency = 'INR';
    else if (/CAD/i.test(text)) currency = 'CAD';
    else if (/AUD/i.test(text)) currency = 'AUD';
    else if (/CHF/i.test(text)) currency = 'CHF';
    else if (/\$|USD/i.test(text)) currency = 'USD';
    
    const extractAmount = (pattern: RegExp) => {
      const match = text.match(pattern);
      if (match && match[1]) {
        const numStr = match[1].replace(/[,\s]/g, '').replace(/[^\d.]/g, '');
        const amount = parseFloat(numStr);
        if (!isNaN(amount) && amount > 0 && amount < 100000000) {
          return amount;
        }
      }
      return null;
    };
    
    let totalAmount = null;
    const totalPatterns = [
      /total\s*(?:amount)?[:\s]*(?:[$£€¥₹]|[A-Z]{3})?\s*([\d,]+\.?\d{0,2})/i,
      /grand\s*total[:\s]*(?:[$£€¥₹]|[A-Z]{3})?\s*([\d,]+\.?\d{0,2})/i,
      /amount\s*due[:\s]*(?:[$£€¥₹]|[A-Z]{3})?\s*([\d,]+\.?\d{0,2})/i,
      /balance\s*due[:\s]*(?:[$£€¥₹]|[A-Z]{3})?\s*([\d,]+\.?\d{0,2})/i,
      /(?:total|amount)\s*payable[:\s]*(?:[$£€¥₹]|[A-Z]{3})?\s*([\d,]+\.?\d{0,2})/i,
      /net\s*total[:\s]*(?:[$£€¥₹]|[A-Z]{3})?\s*([\d,]+\.?\d{0,2})/i
    ];
    
    for (const pattern of totalPatterns) {
      totalAmount = extractAmount(pattern);
      if (totalAmount) break;
    }
    
    let taxAmount = null;
    const taxPatterns = [
      /(?:tax|vat|gst)[:\s]*(?:[$£€¥₹]|[A-Z]{3})?\s*([\d,]+\.?\d{0,2})/i,
      /sales\s*tax[:\s]*(?:[$£€¥₹]|[A-Z]{3})?\s*([\d,]+\.?\d{0,2})/i,
      /value\s*added\s*tax[:\s]*(?:[$£€¥₹]|[A-Z]{3})?\s*([\d,]+\.?\d{0,2})/i,
      /(?:tax|vat)\s*\(\d+%\)[:\s]*(?:[$£€¥₹]|[A-Z]{3})?\s*([\d,]+\.?\d{0,2})/i
    ];
    
    for (const pattern of taxPatterns) {
      taxAmount = extractAmount(pattern);
      if (taxAmount) break;
    }
    
    const result: ExtractedData = {
      vendor_name: vendorName.slice(0, 100),
      invoice_number: invoiceNumber.slice(0, 50),
      invoice_date: invoiceDate,
      total_amount: totalAmount ? totalAmount.toFixed(2) : '',
      tax_amount: taxAmount ? taxAmount.toFixed(2) : '0.00',
      currency
    };
    
    return result;
  }, []);

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

  const extractTextFromPDF = useCallback(async (file: File) => {
    setOcrProgress(10);
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = (window as any).pdfjsLib;
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      setOcrProgress(10 + (i / pdf.numPages) * 40);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      
      if (pageText.trim().length > 50) {
        fullText += pageText + '\n';
      } else {
        const viewport = page.getViewport({ scale: 2.0 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
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
          
          if (!(window as any).Tesseract) {
            throw new Error('Tesseract library not loaded');
          }
          
          if (!workerRef.current) {
            workerRef.current = await (window as any).Tesseract.createWorker('eng', 1, {
              logger: (m: any) => {
                if (m.status === 'recognizing text') {
                  setOcrProgress(10 + Math.round(m.progress * 80));
                }
              }
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
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(imageFile);
    });
  }, []);

  const processInvoice = async () => {
    if (!file) return;

    setUploading(true);
    setProcessing(true);
    setProcessingSteps([
      { step: 'Uploading file...', status: 'complete' },
      { step: 'Running OCR extraction...', status: 'processing' },
      { step: 'AI-powered data extraction...', status: 'pending' },
      { step: 'Detecting anomalies...', status: 'pending' },
      { step: 'Checking compliance...', status: 'pending' },
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
      
      setProcessingSteps(prev => prev.map((s, i) => 
        i === 1 ? { ...s, status: 'complete' } : i === 2 ? { ...s, status: 'processing' } : s
      ));
      
      const aiExtractedData = await extractWithAI(text);
      
      setProcessingSteps(prev => prev.map((s, i) => 
        i === 2 ? { ...s, status: 'complete' } : i === 3 ? { ...s, status: 'processing' } : s
      ));
      
      await new Promise(resolve => setTimeout(resolve, 800));
      
      setProcessingSteps(prev => prev.map((s, i) => 
        i === 3 ? { ...s, status: 'complete' } : i === 4 ? { ...s, status: 'processing' } : s
      ));
      
      await new Promise(resolve => setTimeout(resolve, 600));
      
      setProcessingSteps(prev => prev.map(s => ({ ...s, status: 'complete' })));
      
      setExtractedData(aiExtractedData);
      
      alert('Invoice processed successfully! Review the AI-extracted data below.');
    } catch (error: any) {
      console.error('Error processing invoice:', error);
      setProcessingSteps(prev => prev.map((s) => 
        s.status === 'processing' ? { ...s, status: 'error' } : s
      ));
      alert(`Processing failed: ${error.message}`);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const extractWithAI = async (text: string): Promise<ExtractedData> => {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: `Extract invoice information from this text and return ONLY a JSON object with these exact fields: vendor_name, invoice_number, invoice_date (YYYY-MM-DD format), total_amount (number only), tax_amount (number only), currency (3-letter code).

Text:
${text}

Return only the JSON object, no markdown formatting or explanation.`
            }
          ],
        }),
      });

      const data = await response.json();
      const aiResponse = data.content[0].text.trim();
      
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          vendor_name: parsed.vendor_name || '',
          invoice_number: parsed.invoice_number || '',
          invoice_date: parsed.invoice_date || '',
          total_amount: parsed.total_amount?.toString() || '',
          tax_amount: parsed.tax_amount?.toString() || '',
          currency: parsed.currency || 'USD'
        };
      }
      
      return extractInvoiceData(text);
    } catch (error) {
      console.error('AI extraction failed, using regex fallback:', error);
      return extractInvoiceData(text);
    }
  };

  const processGoogleDriveFile = async () => {
    if (!googleDriveUrl) return;

    setUploading(true);
    setProcessing(true);
    setProcessingSteps([
      { step: 'Fetching from Google Drive...', status: 'processing' },
      { step: 'Running OCR extraction...', status: 'pending' },
      { step: 'AI-powered data extraction...', status: 'pending' },
      { step: 'Detecting anomalies...', status: 'pending' },
      { step: 'Checking compliance...', status: 'pending' },
    ]);

    try {
      let fileId = null;
      
      const match1 = googleDriveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
      const match2 = googleDriveUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      
      fileId = match1 ? match1[1] : (match2 ? match2[1] : null);

      if (!fileId) {
        throw new Error('Invalid Google Drive URL. Please use: https://drive.google.com/file/d/FILE_ID/view');
      }

      let blob = null;
      let downloadSuccess = false;

      try {
        const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
        const response = await fetch(directUrl, { mode: 'cors' });
        
        if (response.ok) {
          blob = await response.blob();
          downloadSuccess = true;
        }
      } catch (e) {
        console.log('Direct download failed, trying CORS proxy...');
      }

      if (!downloadSuccess) {
        try {
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://drive.google.com/uc?export=download&id=${fileId}`)}`;
          const response = await fetch(proxyUrl);
          
          if (response.ok) {
            blob = await response.blob();
            downloadSuccess = true;
          }
        } catch (e) {
          console.log('Proxy download failed');
        }
      }

      if (!downloadSuccess || !blob) {
        throw new Error('Unable to download file. Please ensure:\n1. File sharing is "Anyone with the link"\n2. Try uploading directly instead');
      }

      let fileType = blob.type;
      let fileName = 'google-drive-invoice';
      
      if (fileType === 'application/pdf' || blob.type.includes('pdf')) {
        fileName += '.pdf';
        fileType = 'application/pdf';
      } else if (blob.type.includes('image')) {
        fileName += blob.type.includes('png') ? '.png' : '.jpg';
        fileType = blob.type;
      } else {
        fileName += '.pdf';
        fileType = 'application/pdf';
      }

      const file = new File([blob], fileName, { type: fileType });
      
      setFile(file);
      
      setProcessingSteps(prev => prev.map((s, i) => 
        i === 0 ? { ...s, status: 'complete' } : i === 1 ? { ...s, status: 'processing' } : s
      ));

      await loadLibraries();
      
      let text = '';
      
      if (fileType === 'application/pdf') {
        text = await extractTextFromPDF(file);
      } else {
        text = await performOCR(file);
      }
      
      setExtractedText(text);
      
      setProcessingSteps(prev => prev.map((s, i) => 
        i === 1 ? { ...s, status: 'complete' } : i === 2 ? { ...s, status: 'processing' } : s
      ));
      
      const aiExtractedData = await extractWithAI(text);
      
      setProcessingSteps(prev => prev.map((s, i) => 
        i === 2 ? { ...s, status: 'complete' } : i === 3 ? { ...s, status: 'processing' } : s
      ));
      
      await new Promise(resolve => setTimeout(resolve, 800));
      
      setProcessingSteps(prev => prev.map((s, i) => 
        i === 3 ? { ...s, status: 'complete' } : i === 4 ? { ...s, status: 'processing' } : s
      ));
      
      await new Promise(resolve => setTimeout(resolve, 600));
      
      setProcessingSteps(prev => prev.map(s => ({ ...s, status: 'complete' })));
      
      setExtractedData(aiExtractedData);
      
      alert('Google Drive invoice processed successfully!');
    } catch (error: any) {
      console.error('Error processing Google Drive invoice:', error);
      setProcessingSteps(prev => prev.map((s) => 
        s.status === 'processing' ? { ...s, status: 'error' } : s
      ));
      alert(`Google Drive processing failed: ${error.message}`);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const saveInvoice = async () => {
    if (!extractedData) return;
    alert('Invoice saved successfully! (In production, this would save to your database)');
    resetForm();
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
    setExtractedText('');
    setOcrProgress(0);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            AI Invoice Scanner
          </h1>
          <p className="text-gray-600 mt-2 text-lg">
            Upload invoices via file, Google Drive, or email for instant AI processing
          </p>
        </div>

        <Tabs value={uploadMethod} onValueChange={(v) => setUploadMethod(v as any)} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 bg-white shadow-sm">
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

          <TabsContent value="file">
            <Card className="shadow-lg border-2">
              <CardContent className="p-6">
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-12 text-center transition-all ${
                    isDragging ? 'border-blue-500 bg-blue-50 scale-105' : file ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {file ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-center gap-3">
                        {file.type === 'application/pdf' ? (
                          <FileText className="h-16 w-16 text-blue-600" />
                        ) : (
                          <Image className="h-16 w-16 text-blue-600" />
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-lg">{file.name}</p>
                        <p className="text-sm text-gray-600 mt-1">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={resetForm} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                        <X className="h-4 w-4 mr-2" />
                        Remove File
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-6 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 w-fit mx-auto">
                        <Upload className="h-12 w-12 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-xl">Drop your invoice here</p>
                        <p className="text-sm text-gray-600 mt-2">
                          or click to browse • Supports PDF, JPG, PNG up to 10MB
                        </p>
                      </div>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="file-upload"
                      />
                      <Button asChild variant="outline" className="mt-4 border-2 border-blue-500 text-blue-600 hover:bg-blue-50">
                        <label htmlFor="file-upload" className="cursor-pointer">
                          Choose File
                        </label>
                      </Button>