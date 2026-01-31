import { BrowserRouter, Routes, Route } from "react-router-dom";
import Auth from "@/pages/Auth";
import AuthCallback from "@/pages/AuthCallback";
import Dashboard from "@/pages/Dashboard";
import UploadInvoice from "@/pages/UploadInvoice";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/auth/callback" element={<AuthCallback />} />

        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/invoice-upload" element={<UploadInvoice />} />

        {/* fallback */}
        <Route path="*" element={<Auth />} />
      </Routes>
    </BrowserRouter>
  );
}
