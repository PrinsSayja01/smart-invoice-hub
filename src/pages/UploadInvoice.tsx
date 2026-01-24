import { useState, useCallback, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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
  const [processingSteps, setProcessingSteps] = useState<
    { step: string; status: "pending" | "processing" | "complete" | "error" }[]
  >([]);
  const [uploadMethod, setUploadMethod] = useState<"file" | "drive" | "email">("file");
  const [extractedText, setExtractedText] = useState("");
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [selectedDriveFile, setSelectedDriveFile] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);

  const workerRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [sessionUserEmail, setSessionUserEmail] = useState<string | null>(null);
  const [providerToken, setProviderToken] = useState<string | null>(null);

  // ✅ Always load current session from Supabase (not localStorage hacks)
  useEffect(() => {
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      const s = data.session;

      setSessionUserEmail(s?.user?.email ?? null);
      setProviderToken((s as any)?.provider_token ?? null);
    };

    loadSession();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSessionUserEmail(newSession?.user?.email ?? null);
      setProviderToken((newSession as any)?.provider_token ?? null);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const isAuthenticated = !!sessionUserEmail;

  const isValidFileType = (f: File) => {
    const validTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
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

  // ✅ Correct Google login with scopes + prompt consent
  const handleGoogleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/dashboard/upload`,
        scopes:
          "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/gmail.readonly",
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
    setExtractedData(null);
    setFile(null);
  };

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
    const context = canvas.getContext("2d");

    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      setOcrProgress(10 + (i / pdf.numPages) * 40);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(" ");

      if (pageText.trim().length > 50) {
        fullText += pageText + "\n";
      } else {
        const viewport = page.getViewport({ scale: 2.0 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport }).promise;

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
          if (!(window as any).Tesseract) throw new Error("Tesseract not loaded");

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

  // ✅ Uses your Edge Function: process-invoice
  const extractWithAI = async (text: string) => {
    const { data, error } = await supabase.functions.invoke("process-invoice", {
      body: {
        fileName: file?.name ?? "unknown",
        fileType: file?.type ?? "application/octet-stream",
        extractedText: text,
      },
    });

    if (error) throw new Error(error.message || "AI extraction failed");
    return data as ExtractedData;
  };

  // ✅ Drive list via Edge Function drive-list
  const fetchDriveFiles = async () => {
    try {
      if (!providerToken) {
        alert("Provider token missing. Logout and login again and accept Drive permission.");
        return;
      }

      setUploading(true);

      const { data, error } = await supabase.functions.invoke("drive-list", {
        body: { providerToken },
      });

      if (error) throw new Error(error.message);

      // drive-list returns JSON with { files: [...] }
      const files = data?.files ?? [];
      setDriveFiles(files);

      if (!files.length) {
        alert("No PDF or image files found in your Drive.");
      }
    } catch (e: any) {
      alert(`Drive error: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  // ✅ Drive download via Edge Function drive-download
  const downloadDriveFileAsFile = async (fileId: string, name: string, mimeType: string) => {
    if (!providerToken) throw new Error("Provider token missing");

    const { data, error } = await supabase.functions.invoke("drive-download", {
      body: { providerToken, fileId },
    });

    if (error) throw new Error(error.message);

    const base64 = data?.base64;
    if (!base64) throw new Error("Download failed: missing base64");

    const byteString = atob(base64);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);

    const blob = new Blob([bytes], { type: mimeType });
    return new File([blob], name, { type: mimeType });
  };

  const processInvoice = async () => {
    if (!file) return;

    setUploading(true);
    setProcessing(true);
    setProcessingSteps([
      { step: "Uploading file...", status: "complete" },
      { step: "Running OCR extraction...", status: "processing" },
      { step: "Extracting with AI...", status: "pending" },
      { step: "Validating data...", status: "pending" },
    ]);

    try {
      await loadLibraries();

      let text = "";
      if (file.type === "application/pdf") text = await extractTextFromPDF(file);
      else text = await performOCR(file);

      setExtractedText(text);
      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 1 ? { ...s, status: "complete" } : i === 2 ? { ...s, status: "processing" } : s))
      );

      const aiExtracted = await extractWithAI(text);

      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 2 ? { ...s, status: "complete" } : i === 3 ? { ...s, status: "processing" } : s))
      );

      setProcessingSteps((prev) => prev.map((s) => ({ ...s, status: "complete" })));
      setExtractedData(aiExtracted);
      alert("Invoice processed successfully!");
    } catch (e: any) {
      console.error(e);
      setProcessingSteps((prev) => prev.map((s) => (s.status === "processing" ? { ...s, status: "error" } : s)));
      alert(`Processing failed: ${e.message}`);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const processSelectedDriveFile = async () => {
    if (!selectedDriveFile) return;

    setUploading(true);
    setProcessing(true);
    setProcessingSteps([
      { step: "Downloading from Google Drive...", status: "processing" },
      { step: "Running OCR extraction...", status: "pending" },
      { step: "Extracting with AI...", status: "pending" },
      { step: "Validating data...", status: "pending" },
    ]);

    try {
      const meta = driveFiles.find((f) => f.id === selectedDriveFile);
      if (!meta) throw new Error("Missing Drive file metadata");

      const downloaded = await downloadDriveFileAsFile(meta.id, meta.name, meta.mimeType);
      setFile(downloaded);

      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 0 ? { ...s, status: "complete" } : i === 1 ? { ...s, status: "processing" } : s))
      );

      await loadLibraries();

      let text = "";
      if (downloaded.type === "application/pdf") text = await extractTextFromPDF(downloaded);
      else text = await performOCR(downloaded);

      setExtractedText(text);

      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 1 ? { ...s, status: "complete" } : i === 2 ? { ...s, status: "processing" } : s))
      );

      const aiExtracted = await extractWithAI(text);

      setProcessingSteps((prev) =>
        prev.map((s, i) => (i === 2 ? { ...s, status: "complete" } : i === 3 ? { ...s, status: "processing" } : s))
      );

      setProcessingSteps((prev) => prev.map((s) => ({ ...s, status: "complete" })));
      setExtractedData(aiExtracted);
      alert("Invoice processed from Google Drive!");
    } catch (e: any) {
      alert(`Drive error: ${e.message}`);
      setProcessingSteps((prev) => prev.map((s) => (s.status === "processing" ? { ...s, status: "error" } : s)));
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  // ✅ Save invoice to Supabase Storage + invoices table (fix file_type NOT NULL)
  const saveInvoice = async () => {
    if (!extractedData || !file) return;

    try {
      setUploading(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) throw new Error("Not logged in");

      // 1) Upload file to Storage
      const ext = file.name.split(".").pop() || "bin";
      const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`;

      const { error: upErr } = await supabase.storage.from("invoices").upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });
      if (upErr) throw upErr;

      // 2) Insert DB row with required fields
      const { error: dbErr } = await supabase.from("invoices").insert({
        user_id: userId,
        file_name: file.name,
        file_path: storagePath,
        file_type: file.type, // ✅ FIX not-null
        vendor_name: extractedData.vendor_name || null,
        invoice_number: extractedData.invoice_number || null,
        invoice_date: extractedData.invoice_date || null,
        total_amount: extractedData.total_amount ? Number(extractedData.total_amount) : null,
        tax_amount: extractedData.tax_amount ? Number(extractedData.tax_amount) : null,
        currency: extractedData.currency || "USD",
      });

      if (dbErr) throw dbErr;

      alert("Invoice saved successfully!");
      resetForm();
    } catch (e: any) {
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

          {isAuthenticated && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs text-gray-500">Logged in as</p>
                <p className="text-sm font-medium">{sessionUserEmail}</p>
                <p className="text-xs text-gray-500">
                  Provider token: {providerToken ? "✅ available" : "❌ missing"}
                </p>
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
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileSelect} className="hidden" id="file-upload" />
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
                  </div>
                ) : (
                  <>
                    <Alert>
                      <AlertDescription>
                        Logged in as: <strong>{sessionUserEmail}</strong>
                        <div className="text-xs mt-1">Provider token: {providerToken ? "✅ available" : "❌ missing"}</div>
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
                              className={`p-3 border-b cursor-pointer hover:bg-gray-50 ${
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
                                {selectedDriveFile === f.id && <CheckCircle2 className="h-5 w-5 text-blue-600" />}
                              </div>
                            </div>
                          ))}
                        </div>

                        <Button className="w-full bg-blue-600 hover:bg-blue-700" onClick={processSelectedDriveFile} disabled={!selectedDriveFile || uploading || processing}>
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

          {/* EMAIL */}
          <TabsContent value="email">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5 text-blue-600" />
                  Gmail Integration
                </CardTitle>
                <CardDescription>Automatically process invoice emails from your Gmail</CardDescription>
              </CardHeader>
              <CardContent>
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
                  <div className="space-y-4">
                    <Alert>
                      <AlertDescription>
                        Connected to: <strong>{sessionUserEmail}</strong>
                      </AlertDescription>
                    </Alert>
                    <div className="text-center py-8 text-gray-500">
                      <Mail className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                      <p className="text-sm mb-2">Gmail integration coming soon!</p>
                      <p className="text-xs text-blue-600">Auto-scan inbox for invoice attachments</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Processing Steps */}
        {processingSteps.length > 0 && !extractedData && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">AI Processing</CardTitle>
              <CardDescription>Multi-agent workflow in progress</CardDescription>
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
                    <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${ocrProgress}%` }} />
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
              <CardDescription>Verify and correct the extracted information before saving</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Vendor Name</Label>
                  <Input value={extractedData.vendor_name} onChange={(e) => handleInputChange("vendor_name", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Invoice Number</Label>
                  <Input value={extractedData.invoice_number} onChange={(e) => handleInputChange("invoice_number", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Invoice Date</Label>
                  <Input type="date" value={extractedData.invoice_date} onChange={(e) => handleInputChange("invoice_date", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Input value={extractedData.currency} onChange={(e) => handleInputChange("currency", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Total Amount</Label>
                  <Input type="number" step="0.01" value={extractedData.total_amount} onChange={(e) => handleInputChange("total_amount", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Tax/VAT Amount</Label>
                  <Input type="number" step="0.01" value={extractedData.tax_amount} onChange={(e) => handleInputChange("tax_amount", e.target.value)} />
                </div>
              </div>

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
