import { Routes, Route, Navigate } from "react-router-dom";
import Auth from "@/pages/Auth";
import UploadInvoice from "@/pages/UploadInvoice";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/auth" replace />} />
      <Route path="/auth" element={<Auth />} />

      {/* Your invoice upload page */}
      <Route path="/upload" element={<UploadInvoice />} />

      {/* Add your dashboard if you have it */}
      {/* <Route path="/dashboard" element={<Dashboard />} /> */}

      {/* Catch-all: stops Vercel 404 */}
      <Route path="*" element={<Navigate to="/auth" replace />} />
    </Routes>
  );
}
