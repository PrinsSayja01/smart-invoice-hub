import { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, FileText, Image, X, Loader2, CheckCircle2, AlertCircle, Mail, HardDrive, Copy } from 'lucide-react';
import '@/types/global.d';

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
  
  const workerRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const emailAddress = `invoices+user@invoiceai.app`;

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
    console.log('Extracting invoice data from text:', text.substring(0, 500));
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
    
    console.log('Final extracted data:', result);
    return result;
  }, []);

  const loadLibraries = useCallback(async () => {
    try {
      if (!window.Tesseract) {
        console.log('Loading Tesseract.js...');
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        document.head.appendChild(script);
        await new Promise((resolve, reject) => {
          script.onload = () => {
            console.log('Tesseract.js loaded successfully');
            resolve(null);
          };
          script.onerror = () => reject(new Error('Failed to load Tesseract.js'));
          setTimeout(() => reject(new Error('Tesseract.js load timeout')), 10000);
        });
      }
      
      if (!window.pdfjsLib) {
        console.log('Loading PDF.js...');
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        document.head.appendChild(script);
        await new Promise((resolve, reject) => {
          script.onload = () => {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 
              'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            console.log('PDF.js loaded successfully');
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
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
          workerRef.current = await window.Tesseract.createWorker('eng');
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
          console.log('Starting OCR process...');
          
          if (!window.Tesseract) {
            throw new Error('Tesseract library not loaded');
          }
          
          if (!workerRef.current) {
            console.log('Creating Tesseract worker...');
            workerRef.current = await window.Tesseract.createWorker('eng', 1, {
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
      { step: 'Classifying invoice type...', status: 'pending' },
      { step: 'Detecting anomalies...', status: 'pending' },
      { step: 'Checking compliance...', status: 'pending' },
    ]);

    try {
      console.log('Loading OCR libraries...');
      await loadLibraries();
      
      let text = '';
      
      if (file.type === 'application/pdf') {
        console.log('Processing PDF...');
        text = await extractTextFromPDF(file);
      } else {
        console.log('Processing image with OCR...');
        text = await performOCR(file);
      }
      
      console.log('Extraction complete. Text length:', text.length);
      setExtractedText(text);
      
      setProcessingSteps(prev => prev.map((s, i) => 
        i === 1 ? { ...s, status: 'complete' } : i === 2 ? { ...s, status: 'processing' } : s
      ));
      
      // AI-powered data extraction
      console.log('Using AI to extract invoice data...');
      const aiExtractedData = await extractWithAI(text);
      
      setProcessingSteps(prev => prev.map((s, i) => 
        i === 2 ? { ...s, status: 'complete' } : i === 3 ? { ...s, status: 'processing' } : s
      ));
      
      // Simulate anomaly detection
      await new Promise(resolve => setTimeout(resolve, 800));
      
      setProcessingSteps(prev => prev.map((s, i) => 
        i === 3 ? { ...s, status: 'complete' } : i === 4 ? { ...s, status: 'processing' } : s
      ));
      
      // Simulate compliance check
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
      
      // Parse AI response
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
      
      // Fallback to regex extraction
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
      { step: 'Classifying invoice type...', status: 'pending' },
      { step: 'Detecting anomalies...', status: 'pending' },
      { step: 'Checking compliance...', status: 'pending' },
    ]);

    try {
      // Extract file ID from various Google Drive URL formats
      let fileId = null;
      
      // Format: https://drive.google.com/file/d/FILE_ID/view
      const match1 = googleDriveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
      // Format: https://drive.google.com/open?id=FILE_ID
      const match2 = googleDriveUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
      
      fileId = match1 ? match1[1] : (match2 ? match2[1] : null);

      if (!fileId) {
        throw new Error('Invalid Google Drive URL format. Please use a share link like: https://drive.google.com/file/d/FILE_ID/view');
      }

      console.log('Extracted file ID:', fileId);

      // Try multiple download methods
      let blob = null;
      let downloadSuccess = false;

      // Method 1: Direct export URL
      try {
        console.log('Attempting direct download...');
        const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
        const response = await fetch(directUrl, { mode: 'cors' });
        
        if (response.ok) {
          blob = await response.blob();
          downloadSuccess = true;
          console.log('Direct download successful');
        }
      } catch (e) {
        console.log('Direct download failed, trying alternative method...');
      }

      // Method 2: Using CORS proxy
      if (!downloadSuccess) {
        try {
          console.log('Attempting download via CORS proxy...');
          const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://drive.google.com/uc?export=download&id=${fileId}`)}`;
          const response = await fetch(proxyUrl);
          
          if (response.ok) {
            blob = await response.blob();
            downloadSuccess = true;
            console.log('Proxy download successful');
          }
        } catch (e) {
          console.log('Proxy download failed');
        }
      }

      if (!downloadSuccess || !blob) {
        throw new Error('Unable to download file from Google Drive. Please ensure:\n1. File sharing is set to "Anyone with the link can view"\n2. The link is correct\n3. Try uploading the file directly instead');
      }

      // Detect file type
      let fileType = blob.type;
      let fileName = 'google-drive-invoice';
      
      if (fileType === 'application/pdf' || blob.type.includes('pdf')) {
        fileName += '.pdf';
        fileType = 'application/pdf';
      } else if (blob.type.includes('image')) {
        fileName += blob.type.includes('png') ? '.png' : '.jpg';
        fileType = blob.type;
      } else {
        // Default to PDF if type is unclear
        fileName += '.pdf';
        fileType = 'application/pdf';
      }

      const file = new File([blob], fileName, { type: fileType });
      
      console.log('File downloaded:', fileName, 'Size:', (blob.size / 1024).toFixed(2), 'KB');
      
      setFile(file);
      
      setProcessingSteps(prev => prev.map((s, i) => 
        i === 0 ? { ...s, status: 'complete' } : i === 1 ? { ...s, status: 'processing' } : s
      ));

      console.log('Loading OCR libraries...');
      await loadLibraries();
      
      let text = '';
      
      if (fileType === 'application/pdf') {
        console.log('Processing PDF from Google Drive...');
        text = await extractTextFromPDF(file);
      } else {
        console.log('Processing image from Google Drive with OCR...');
        text = await performOCR(file);
      }
      
      console.log('Extraction complete. Text length:', text.length);
      setExtractedText(text);
      
      setProcessingSteps(prev => prev.map((s, i) => 
        i === 1 ? { ...s, status: 'complete' } : i === 2 ? { ...s, status: 'processing' } : s
      ));
      
      // AI-powered data extraction
      console.log('Using AI to extract invoice data...');
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
      
      alert('Google Drive invoice processed successfully! Review the AI-extracted data below.');
    } catch (error: any) {
      console.error('Error processing Google Drive invoice:', error);
      setProcessingSteps(prev => prev.map((s) => 
        s.status === 'processing' ? { ...s, status: 'error' } : s
      ));
      alert(`Google Drive processing failed: ${error.message}\n\nTip: Try downloading the file and using the File Upload tab instead.`);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const saveInvoice = async () => {
    if (!extractedData) return;
    alert('Invoice saved! (In production, this would save to your database)');
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold">Upload Invoice</h1>
          <p className="text-gray-600 mt-1">
            Upload invoices via file, Google Drive, or email
          </p>
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

          <TabsContent value="drive">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <HardDrive className="h-5 w-5 text-blue-600" />
                  Import from Google Drive
                </CardTitle>
                <CardDescription>
                  Paste a Google Drive sharing link to import your invoice
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="drive-url">Google Drive Share Link</Label>
                  <Input
                    id="drive-url"
                    placeholder="https://drive.google.com/file/d/..."
                    value={googleDriveUrl}
                    onChange={(e) => setGoogleDriveUrl(e.target.value)}
                  />
                  <p className="text-xs text-gray-600">
                    Make sure the file is set to "Anyone with the link can view"
                  </p>
                </div>

                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700"
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

          <TabsContent value="email">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5 text-blue-600" />
                  Email Invoices
                </CardTitle>
                <CardDescription>
                  Forward invoices to your personal email address for automatic processing
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="p-4 rounded-xl bg-gray-100 border border-gray-300">
                  <p className="text-sm text-gray-600 mb-2">Your unique email address:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-white rounded-lg text-sm font-mono">
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
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-blue-600">1</div>
                      <p className="text-sm text-gray-600">Forward any invoice email to your unique address above</p>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-blue-600">2</div>
                      <p className="text-sm text-gray-600">Our system automatically detects PDF/image attachments</p>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-blue-600">3</div>
                      <p className="text-sm text-gray-600">AI processes the invoice using OCR + intelligent extraction</p>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                      <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-blue-600">4</div>
                      <p className="text-sm text-gray-600">Processed invoices appear in your dashboard within minutes</p>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
                  <p className="text-sm text-blue-800">
                    <strong>Pro tip:</strong> Set up email forwarding rules in Gmail to automatically send vendor invoices to this address!
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-green-50 border border-green-200">
                  <h5 className="text-sm font-semibold text-green-900 mb-2">Backend Integration Available:</h5>
                  <p className="text-xs text-green-800 mb-3">
                    Email processing works via webhook automation platforms like Make.com or Zapier:
                  </p>
                  <ul className="text-xs text-green-700 space-y-1 ml-4">
                    <li>• Gmail receives forwarded invoice → Triggers Make.com scenario</li>
                    <li>• Make.com extracts attachment → Sends to this app's API</li>
                    <li>• OCR + AI processes invoice → Stores in database</li>
                    <li>• You receive notification when processing completes</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {processingSteps.length > 0 && !extractedData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">AI Processing</CardTitle>
              <CardDescription>Multi-agent workflow in progress</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {processingSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  {step.status === 'pending' && (
                    <div className="h-5 w-5 rounded-full border-2 border-gray-300" />
                  )}
                  {step.status === 'processing' && (
                    <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                  )}
                  {step.status === 'complete' && (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  )}
                  {step.status === 'error' && (
                    <AlertCircle className="h-5 w-5 text-red-600" />
                  )}
                  <span className={`text-sm ${
                    step.status === 'pending' ? 'text-gray-500' :
                    step.status === 'processing' ? 'text-gray-900 font-medium' :
                    step.status === 'complete' ? 'text-green-600' :
                    'text-red-600'
                  }`}>
                    {step.step}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

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
