import { Routes, Route } from "react-router-dom";
import Auth from "@/pages/Auth";
import UploadInvoice from "@/pages/UploadInvoice";
import AuthCallback from "@/pages/AuthCallback";

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-sm text-gray-600">404 — Page not found</div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Auth />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/invoice-upload" element={<UploadInvoice />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
