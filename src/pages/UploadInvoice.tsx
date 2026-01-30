import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function UploadInvoice() {
  const [driveFiles, setDriveFiles] = useState([]);
  const [gmailFiles, setGmailFiles] = useState([]);
  const [error, setError] = useState("");

  const loadDrive = async () => {
    setError("");

    const session = (await supabase.auth.getSession()).data.session;

    if (!session?.provider_token) {
      setError("Google token missing. Reconnect Google.");
      return;
    }

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drive-list`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerToken: session.provider_token,
        }),
      }
    );

    const data = await res.json();
    setDriveFiles(data.files || []);
  };

  const loadGmail = async () => {
    setError("");

    const session = (await supabase.auth.getSession()).data.session;

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gmail-list`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerToken: session.provider_token,
        }),
      }
    );

    const data = await res.json();
    setGmailFiles(data.files || []);
  };

  useEffect(() => {
    loadDrive();
    loadGmail();
  }, []);

  return (
    <div className="p-6 space-y-6">
      <Card className="p-4">
        <h2 className="text-xl font-bold">Invoices From Google Drive</h2>

        <Button onClick={loadDrive}>Reload Drive</Button>

        {driveFiles.map((f: any) => (
          <p key={f.id}>{f.name}</p>
        ))}
      </Card>

      <Card className="p-4">
        <h2 className="text-xl font-bold">Invoices From Gmail</h2>

        <Button onClick={loadGmail}>Reload Gmail</Button>

        {gmailFiles.map((m: any) => (
          <p key={m.id}>Message ID: {m.id}</p>
        ))}
      </Card>

      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}
