import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-xl text-center space-y-4">
        <h1 className="text-3xl font-bold">Smart Invoice Hub</h1>
        <p className="text-muted-foreground">
          Upload invoices from File, Google Drive, Gmail and process them with OCR.
        </p>

        <div className="flex gap-3 justify-center">
          <Button onClick={() => navigate("/auth")}>Login</Button>
          <Button variant="outline" onClick={() => navigate("/invoice-upload")}>
            Upload Invoice
          </Button>
        </div>
      </div>
    </div>
  );
}
