import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload, FileText, Image, X, Loader2, CheckCircle2, AlertCircle, Mail, HardDrive, LogIn, RefreshCw,
} from "lucide-react";

type ExtractedData = {
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: string;
  tax_amount: string;
  currency: string;
  invoice_type?: string;
  risk_score?: string;
  compliance_status?: string;
  is_flagged?: boolean;
  flag_reason?: string | null;
};

function base64ToBlob(base64: string, mimeType: string) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

export default function UploadInvoice() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);

  const [processingSteps, setProcessingSteps] = useState<
    { step: string; status: "pending" | "processing" | "complete" | "error" }[]
  >([]);

  const [uploadMethod, setUploadMethod] = useState<"file" | "drive" | "email">("file");
  const [extractedText, setExtractedText] = useState("");
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);

  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [selectedDriveFile, setSelectedDriveFile] = useState<string | null>(null);

  const [ocrProgress, setOcrProgress] = useState(0);

  const workerRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const isValidFileType = (f: File) => ["application/pdf", "image/jpeg", "image/png", "image/jpg"].includes(f.type);

  // ---- AUTH ----
  const handleGoogleSignIn = async () => {
    const redirectTo = `${window.location.origin}/invoice-upload`;

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        scopes:
          "email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/gmail.readonly",
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setDriveFiles([]);
    setSelectedDriveFile(null);
    resetForm();
  };

  const getProviderToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.provider_token || null;
  };

  const getUser = async () => {
    const { data } = await supabase.auth.getUser();
    return data.user || null;
  };

  // ---- DRAG/DROP ----
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

  // ---- OCR LIBS ----
  const loadLibraries = useCallback(async () => {
    if (!(window as any).Tesseract) {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      document.head.appendChild(script);
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load Tesseract.js"));
        setTimeout(() => reject(new Error("Tesseract.js load timeout")), 10000);
      });
    }

    if (!(window as any).pdfjsLib) {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      document.head.appendChild(script);
      await new Promise((resolve, reject) => {
        script.onload = () => {
          (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          resolve(null);
        };
        script.onerror = () => reject(new Error("Failed to load PDF.js"));
        setTimeout(() => reject(new Error("PDF.js load timeout")), 10000);
      });
    }
  }, []);

  const extractTextFromPDF = useCallback(async (pdfFile: File) => {
    setOcrProgress(10);
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdfjsLib = (window as any).pdfjsLib;
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = "";
    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      setOcrProgress(10 + (i / Math.min(pdf.numPages, 3)) * 70);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(" ");

      if (pageText.trim().length > 50) {
        fullText += pageText + "\n";
      } else {
        const viewport = page.getViewport({ scale: 2.0 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // @ts-ignore
        await page.render({ canvasContext: ctx, viewport }).promise;

        if (!workerRef.current) {
          workerRef.current = await (window as any).Tesseract.createWorker("eng");
        }
        const { data: { text } } = await workerRef.current.recognize(canvas);
        fullText += text + "\n";
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

          if (!workerRef.current) {
            workerRef.current = await (window as any).Tesseract.createWorker("eng", 1, {
              logger: (m: any) => {
                if (m.status === "recognizing text") {
                  setOcrProgress(10 + Math.round(m.progress * 80));
                }
              },
            });
          }

          const { data: { text } } = await workerRef.current.recognize(e.target?.result);
          setOcrProgress(100);
          resolve(text);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(imageFile);
    });
  }, []);

  // ---- PROCESS (calls Edge Function process-invoice) ----
  const processInvoice = async () => {
    if (!file) return;

    setUploading(true);
    setProcessing(true);
    setExtractedData(null);

    setProcessingSteps([
      { step: "Running OCR extraction...", status: "processing" },
      { step: "Parsing invoice fields (free engine)...", status: "pending" },
      { step: "Ready to save", status: "pending" },
    ]);

    try {
      await loadLibraries();

      let text = "";
      if (file.type === "application/pdf") text = await extractTextFromPDF(file);
      else text = await performOCR(file);

      setExtractedText(text);
      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 0 ? { ...s, status: "complete" } : i === 1 ? { ...s, status: "processing" } : s))
      );

      const { data, error } = await supabase.functions.invoke("process-invoice", {
        body: { fileName: file.name, fileType: file.type, extractedText: text },
      });

      if (error) throw error;

      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 1 ? { ...s, status: "complete" } : i === 2 ? { ...s, status: "complete" } : s))
      );

      // Convert to your UI format
      const mapped: ExtractedData = {
        vendor_name: data.vendor_name || "",
        invoice_number: data.invoice_number || "",
        invoice_date: data.invoice_date || "",
        total_amount: data.total_amount != null ? String(data.total_amount) : "",
        tax_amount: data.tax_amount != null ? String(data.tax_amount) : "",
        currency: data.currency || "EUR",
        invoice_type: data.invoice_type || "other",
        risk_score: data.risk_score || "low",
        compliance_status: data.compliance_status || "needs_review",
        is_flagged: !!data.is_flagged,
        flag_reason: data.flag_reason ?? null,
      };

      setExtractedData(mapped);
    } catch (err: any) {
      console.error(err);
      setProcessingSteps((prev) => prev.map((s) => (s.status === "processing" ? { ...s, status: "error" } : s)));
      alert(`Processing failed: ${err.message || err}`);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  // ---- GOOGLE DRIVE ----
  const fetchDriveFiles = async () => {
    const providerToken = await getProviderToken();
    if (!providerToken) {
      alert("Please login with Google first.");
      return;
    }

    try {
      setUploading(true);
      const { data, error } = await supabase.functions.invoke("drive-list", {
        body: { providerToken },
      });
      if (error) throw error;

      setDriveFiles(data.files || []);
      if (!data.files?.length) alert("No PDF/image files found in Drive.");
    } catch (e: any) {
      console.error(e);
      alert(`Drive error: ${e.message || e}`);
    } finally {
      setUploading(false);
    }
  };

  const processSelectedDriveFile = async () => {
    const providerToken = await getProviderToken();
    if (!providerToken || !selectedDriveFile) {
      alert("Login and select a file first.");
      return;
    }

    const meta = driveFiles.find((f) => f.id === selectedDriveFile);
    if (!meta) return;

    try {
      setUploading(true);
      setProcessing(true);
      setProcessingSteps([
        { step: "Downloading from Google Drive...", status: "processing" },
        { step: "Running OCR extraction...", status: "pending" },
        { step: "Parsing invoice fields (free engine)...", status: "pending" },
        { step: "Ready to save", status: "pending" },
      ]);

      const { data, error } = await supabase.functions.invoke("drive-download", {
        body: { providerToken, fileId: selectedDriveFile },
      });
      if (error) throw error;

      const mime = meta.mimeType || "application/pdf";
      const blob = base64ToBlob(data.base64, mime);
      const downloadedFile = new File([blob], meta.name, { type: mime });

      setFile(downloadedFile);
      setProcessingSteps((prev) => prev.map((s, i) => (i === 0 ? { ...s, status: "complete" } : s)));

      await loadLibraries();
      setProcessingSteps((prev) => prev.map((s, i) => (i === 1 ? { ...s, status: "processing" } : s)));

      let text = "";
      if (downloadedFile.type === "application/pdf") text = await extractTextFromPDF(downloadedFile);
      else text = await performOCR(downloadedFile);

      setExtractedText(text);
      setProcessingSteps((prev) =>
        prev.map((s, i) =>
          i === 1 ? { ...s, status: "complete" } : i === 2 ? { ...s, status: "processing" } : s
        )
      );

      const r = await supabase.functions.invoke("process-invoice", {
        body: { fileName: downloadedFile.name, fileType: downloadedFile.type, extractedText: text },
      });

      if (r.error) throw r.error;

      const mapped: ExtractedData = {
        vendor_name: r.data.vendor_name || "",
        invoice_number: r.data.invoice_number || "",
        invoice_date: r.data.invoice_date || "",
        total_amount: r.data.total_amount != null ? String(r.data.total_amount) : "",
        tax_amount: r.data.tax_amount != null ? String(r.data.tax_amount) : "",
        currency: r.data.currency || "EUR",
        invoice_type: r.data.invoice_type || "other",
        risk_score: r.data.risk_score || "low",
        compliance_status: r.data.compliance_status || "needs_review",
        is_flagged: !!r.data.is_flagged,
        flag_reason: r.data.flag_reason ?? null,
      };

      setProcessingSteps((prev) => prev.map((s) => ({ ...s, status: "complete" })));
      setExtractedData(mapped);
    } catch (e: any) {
      console.error(e);
      setProcessingSteps((prev) => prev.map((s) => (s.status === "processing" ? { ...s, status: "error" } : s)));
      alert(`Error: ${e.message || e}`);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  // ---- SAVE TO SUPABASE (Storage + DB) ----
  const saveInvoice = async () => {
    if (!file || !extractedData) return;

    try {
      setUploading(true);

      const user = await getUser();
      if (!user?.id) {
        alert("Please login first.");
        return;
      }

      // Upload file to Storage bucket "invoices"
      const storagePath = `${user.id}/${Date.now()}-${file.name}`;

      const { error: uploadErr } = await supabase.storage
        .from("invoices")
        .upload(storagePath, file, { upsert: true });

      if (uploadErr) throw uploadErr;

      const { data: pub } = supabase.storage.from("invoices").getPublicUrl(storagePath);
      const fileUrl = pub.publicUrl;

      // Insert invoice row
      const payload: any = {
        user_id: user.id,
        file_url: fileUrl,
        file_name: file.name,
        file_type: file.type,

        vendor_name: extractedData.vendor_name || null,
        invoice_number: extractedData.invoice_number || null,
        invoice_date: extractedData.invoice_date || null,
        total_amount: extractedData.total_amount ? Number(extractedData.total_amount) : null,
        tax_amount: extractedData.tax_amount ? Number(extractedData.tax_amount) : null,
        currency: extractedData.currency || "EUR",
        invoice_type: extractedData.invoice_type || "other",
        language: "en",

        risk_score: extractedData.risk_score || "low",
        compliance_status: extractedData.compliance_status || "needs_review",
        is_flagged: !!extractedData.is_flagged,
        flag_reason: extractedData.flag_reason ?? null,

        agent_processing: {
          ingestion: { fileName: file.name, fileType: file.type },
          notes: "free-parser",
        },
      };

      const { error: insertErr } = await supabase.from("invoices").insert(payload);
      if (insertErr) throw insertErr;

      alert("✅ Saved! File in Storage + row in invoices table.");
      resetForm();
    } catch (e: any) {
      console.error(e);
      alert(`❌ Save failed: ${e.message || e}`);
    } finally {
      setUploading(false);
    }
  };

  const handleInputChange = (field: keyof ExtractedData, value: string) => {
    if (!extractedData) return;
    setExtractedData({ ...extractedData, [field]: value });
  };

  const resetForm = () => {
    setFile(null);
    setExtractedData(null);
    setProcessingSteps([]);
    setExtractedText("");
    setSelectedDriveFile(null);
    setOcrProgress(0);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold">Upload Invoice</h1>
            <p className="text-gray-600 mt-1">Upload invoices via file, Google Drive, or email</p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleGoogleSignIn}>
              <LogIn className="h-4 w-4 mr-2" />
              Login Google
            </Button>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <X className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
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
              Gmail
            </TabsTrigger>
          </TabsList>

          {/* FILE */}
          <TabsContent value="file">
            <Card>
              <CardContent className="p-6">
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                    isDragging
                      ? "border-blue-500 bg-blue-50"
                      : file
                      ? "border-green-500 bg-green-50"
                      : "border-gray-300 hover:border-blue-400"
                  }`}
                >
                  {file ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-center gap-3">
                        {file.type === "application/pdf" ? (
                          <FileText className="h-12 w-12 text-blue-600" />
                        ) : (
                          <Image className="h-12 w-12 text-blue-600" />
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

          {/* DRIVE */}
          <TabsContent value="drive">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <HardDrive className="h-5 w-5 text-blue-600" />
                  Import from Your Google Drive
                </CardTitle>
                <CardDescription>Browse and process invoices from Drive</CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
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
                    <p className="text-xs text-gray-500 mt-3">Login Google first if it fails.</p>
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
                            selectedDriveFile === f.id ? "bg-blue-50 border-blue-300" : ""
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {f.mimeType === "application/pdf" ? (
                              <FileText className="h-5 w-5 text-red-600" />
                            ) : (
                              <Image className="h-5 w-5 text-blue-600" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{f.name}</p>
                              <p className="text-xs text-gray-500">
                                {new Date(f.modifiedTime).toLocaleDateString()} • {(Number(f.size || 0) / 1024).toFixed(0)} KB
                              </p>
                            </div>
                            {selectedDriveFile === f.id && <CheckCircle2 className="h-5 w-5 text-blue-600 flex-shrink-0" />}
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
              </CardContent>
            </Card>
          </TabsContent>

          {/* EMAIL (UI only – Gmail API next) */}
          <TabsContent value="email">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5 text-blue-600" />
                  Gmail Integration
                </CardTitle>
                <CardDescription>Login with Google to allow Gmail scope</CardDescription>
              </CardHeader>
              <CardContent>
                <Alert>
                  <AlertDescription>
                    Gmail scope is requested at login. Next step is adding a `gmail-list` Edge Function.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {processingSteps.length > 0 && !extractedData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Processing</CardTitle>
              <CardDescription>OCR + free extraction</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {processingSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  {step.status === "pending" && <div className="h-5 w-5 rounded-full border-2 border-gray-300" />}
                  {step.status === "processing" && <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />}
                  {step.status === "complete" && <CheckCircle2 className="h-5 w-5 text-green-600" />}
                  {step.status === "error" && <AlertCircle className="h-5 w-5 text-red-600" />}
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
                    <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${ocrProgress}%` }} />
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
              <CardDescription>Verify and correct before saving</CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Vendor</Label>
                  <Input value={extractedData.vendor_name} onChange={(e) => handleInputChange("vendor_name", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Invoice #</Label>
                  <Input value={extractedData.invoice_number} onChange={(e) => handleInputChange("invoice_number", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input type="date" value={extractedData.invoice_date} onChange={(e) => handleInputChange("invoice_date", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Input value={extractedData.currency} onChange={(e) => handleInputChange("currency", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Total</Label>
                  <Input type="number" value={extractedData.total_amount} onChange={(e) => handleInputChange("total_amount", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Tax/VAT</Label>
                  <Input type="number" value={extractedData.tax_amount} onChange={(e) => handleInputChange("tax_amount", e.target.value)} />
                </div>
              </div>

              {extractedText && (
                <details className="mt-4">
                  <summary className="text-sm font-semibold cursor-pointer">View extracted text</summary>
                  <pre className="mt-3 p-4 bg-gray-50 rounded-lg text-xs overflow-auto max-h-48 border-2 border-gray-200">
                    {extractedText}
                  </pre>
                </details>
              )}

              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={resetForm}>Cancel</Button>
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
