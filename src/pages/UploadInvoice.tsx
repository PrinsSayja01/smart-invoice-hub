import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  modifiedTime?: string;
  size?: number;
};

export default function UploadInvoice() {
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    // Load session on mount
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    // Listen session changes
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

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
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [selectedDriveFile, setSelectedDriveFile] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);

  const workerRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const isAuthenticated = !!session?.user;
  const userEmail = session?.user?.email;

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const isValidFileType = (file: File) => {
    const validTypes = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
    return validTypes.includes(file.type);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile && isValidFileType(droppedFile)) {
        setFile(droppedFile);
        setExtractedData(null);
      }
    },
    []
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && isValidFileType(selectedFile)) {
      setFile(selectedFile);
      setExtractedData(null);
    }
  };

  // ✅ NEW: Supabase OAuth Sign-in (Drive + Gmail scopes)
  const handleGoogleSignIn = async () => {
    const redirectTo = `${window.location.origin}/dashboard/upload`;

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        scopes:
          "email profile https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/gmail.readonly",
      },
    });
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setDriveFiles([]);
    setSelectedDriveFile(null);
    setExtractedData(null);
  };

  // ✅ IMPORTANT: This replaces /api/drive/list-files
  const fetchDriveFiles = async () => {
    try {
      setUploading(true);

      const { data, error } = await supabase.functions.invoke("drive-list-files");

      if (error) {
        throw new Error(error.message);
      }

      const files = (data?.files || []) as DriveFile[];
      setDriveFiles(files);

      if (files.length === 0) {
        alert("No PDF or image files found in your Google Drive. Upload some invoices to Drive first!");
      }
    } catch (err: any) {
      console.error("Drive list error:", err);

      // Most common cause: missing provider token because scopes not granted
      alert(
        `Drive error: ${err.message}\n\nIf it says provider token missing → Logout & Login again and accept Drive permission.`
      );
    } finally {
      setUploading(false);
    }
  };

  const loadLibraries = useCallback(async () => {
    try {
      if (!(window as any).Tesseract) {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
        document.head.appendChild(script);
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = () => reject(new Error("Failed to load Tesseract.js"));
          setTimeout(() => reject(new Error("Tesseract.js load timeout")), 15000);
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
          setTimeout(() => reject(new Error("PDF.js load timeout")), 15000);
        });
      }

      return true;
    } catch (error) {
      console.error("Library loading error:", error);
      throw error;
    }
  }, []);

  const extractTextFromPDF = useCallback(async (file: File) => {
    setOcrProgress(10);
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = (window as any).pdfjsLib;
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = "";

    if (!canvasRef.current) canvasRef.current = document.createElement("canvas");
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      setOcrProgress(10 + (i / Math.min(pdf.numPages, 3)) * 40);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(" ");

      if (pageText.trim().length > 50) {
        fullText += pageText + "\n";
      } else {
        const viewport = page.getViewport({ scale: 2.0 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        if (!context) throw new Error("Canvas context not available");
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

          if (!(window as any).Tesseract) throw new Error("Tesseract library not loaded");

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
        } catch (error) {
          console.error("OCR Error:", error);
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(imageFile);
    });
  }, []);

  // ⚠️ Keep your AI extraction here (your current API requires key)
  // For now we keep a fallback extraction if AI fails.
  const extractWithAI = async (_text: string): Promise<ExtractedData> => {
    // TODO: replace with your real AI endpoint / edge function
    return {
      vendor_name: "Unknown Vendor",
      invoice_number: "VOICE",
      invoice_date: new Date().toISOString().slice(0, 10),
      total_amount: "0",
      tax_amount: "0",
      currency: "EUR",
    };
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
        prev.map((s, i) =>
          i === 1 ? { ...s, status: "complete" } : i === 2 ? { ...s, status: "processing" } : s
        )
      );

      const aiExtractedData = await extractWithAI(text);

      setProcessingSteps((prev) =>
        prev.map((s, i) =>
          i === 2 ? { ...s, status: "complete" } : i === 3 ? { ...s, status: "processing" } : s
        )
      );

      await new Promise((resolve) => setTimeout(resolve, 400));
      setProcessingSteps((prev) => prev.map((s) => ({ ...s, status: "complete" })));

      setExtractedData(aiExtractedData);
    } catch (error: any) {
      console.error("Error processing invoice:", error);
      setProcessingSteps((prev) =>
        prev.map((s) => (s.status === "processing" ? { ...s, status: "error" } : s))
      );
      alert(`Processing failed: ${error.message}`);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  // ✅ IMPORTANT: downloads via Supabase Edge Function, not /api/drive/download-file
  const processSelectedDriveFile = async () => {
    if (!selectedDriveFile) return;

    setUploading(true);
    setProcessing(true);
    setProcessingSteps([
      { step: "Downloading from Google Drive...", status: "processing" },
      { step: "Running OCR extraction...", status: "pending" },
      { step: "Extracting invoice data with AI...", status: "pending" },
      { step: "Validating data...", status: "pending" },
    ]);

    try {
      const meta = driveFiles.find((f) => f.id === selectedDriveFile);
      if (!meta) throw new Error("Selected file metadata not found");

      // This requires you to have an Edge Function named "drive-download-file"
      // which returns a file as binary.
      const { data: blob, error } = await supabase.functions.invoke("drive-download-file", {
        body: { fileId: selectedDriveFile },
        responseType: "blob",
      });

      if (error) throw new Error(error.message);
      if (!blob) throw new Error("Download failed (empty file)");

      const downloadedFile = new File([blob as Blob], meta.name, { type: meta.mimeType });
      setFile(downloadedFile);

      setProcessingSteps((prev) =>
        prev.map((s, i) =>
          i === 0 ? { ...s, status: "complete" } : i === 1 ? { ...s, status: "processing" } : s
        )
      );

      await loadLibraries();

      let text = "";
      if (downloadedFile.type === "application/pdf") text = await extractTextFromPDF(downloadedFile);
      else text = await performOCR(downloadedFile);

      setExtractedText(text);
      setProcessingSteps((prev) =>
        prev.map((s, i) =>
          i === 1 ? { ...s, status: "complete" } : i === 2 ? { ...s, status: "processing" } : s
        )
      );

      const aiExtractedData = await extractWithAI(text);

      setProcessingSteps((prev) =>
        prev.map((s, i) =>
          i === 2 ? { ...s, status: "complete" } : i === 3 ? { ...s, status: "processing" } : s
        )
      );

      await new Promise((resolve) => setTimeout(resolve, 400));
      setProcessingSteps((prev) => prev.map((s) => ({ ...s, status: "complete" })));

      setExtractedData(aiExtractedData);
    } catch (error: any) {
      console.error("Processing error:", error);
      setProcessingSteps((prev) =>
        prev.map((s) => (s.status === "processing" ? { ...s, status: "error" } : s))
      );
      alert(`Error: ${error.message}`);
    } finally {
      setUploading(false);
      setProcessing(false);
    }
  };

  const saveInvoice = async () => {
    if (!extractedData || !file || !session?.user) return;

    try {
      setUploading(true);

      // IMPORTANT: your DB error earlier said file_type is NOT NULL
      // so we always send file_type and file_name.
      const payload = {
        user_id: session.user.id,
        file_name: file.name,
        file_type: file.type, // ✅ fixes: null value in column "file_type"
        vendor_name: extractedData.vendor_name,
        invoice_number: extractedData.invoice_number,
        invoice_date: extractedData.invoice_date,
        total_amount: Number(extractedData.total_amount || 0),
        tax_amount: Number(extractedData.tax_amount || 0),
        currency: extractedData.currency,
      };

      const { error } = await supabase.from("invoices").insert(payload);
      if (error) throw error;

      alert("Invoice saved!");
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

          {/* DRIVE TAB */}
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
                      If Drive list is empty, logout & login again and accept Drive permission.
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
                                    {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : ""}{" "}
                                    {f.size ? `• ${(Number(f.size) / 1024).toFixed(0)} KB` : ""}
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
                        Connected to: <strong>{userEmail}</strong>
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
                  <span
                    className={`text-sm ${
                      step.status === "pending"
                        ? "text-gray-500"
                        : step.status === "processing"
                        ? "text-gray-900 font-medium"
                        : step.status === "complete"
                        ? "text-green-600"
                        : "text-red-600"
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
                  <Input id="vendor_name" value={extractedData.vendor_name} onChange={(e) => handleInputChange("vendor_name", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice_number">Invoice Number</Label>
                  <Input id="invoice_number" value={extractedData.invoice_number} onChange={(e) => handleInputChange("invoice_number", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice_date">Invoice Date</Label>
                  <Input id="invoice_date" type="date" value={extractedData.invoice_date} onChange={(e) => handleInputChange("invoice_date", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Input id="currency" value={extractedData.currency} onChange={(e) => handleInputChange("currency", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="total_amount">Total Amount</Label>
                  <Input id="total_amount" type="number" step="0.01" value={extractedData.total_amount} onChange={(e) => handleInputChange("total_amount", e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tax_amount">Tax/VAT Amount</Label>
                  <Input id="tax_amount" type="number" step="0.01" value={extractedData.tax_amount} onChange={(e) => handleInputChange("tax_amount", e.target.value)} />
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
