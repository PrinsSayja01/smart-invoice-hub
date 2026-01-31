import { Routes, Route } from "react-router-dom";
import Auth from "@/pages/Auth";
import AuthCallback from "@/pages/AuthCallback";
import UploadInvoice from "@/pages/UploadInvoice";
import Dashboard from "@/pages/Dashboard";
import Landing from "@/pages/Landing";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />         {/* ✅ HOME / LANDING */}
      <Route path="/auth" element={<Auth />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/invoice-upload" element={<UploadInvoice />} />
      <Route path="*" element={<Landing />} />         {/* prevents blank 404 */}
    </Routes>
  );
}
