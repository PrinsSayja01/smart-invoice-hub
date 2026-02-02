import { supabase } from "../lib/supabaseClient";

export async function listDriveFiles(providerToken: string) {
  const { data, error } = await supabase.functions.invoke("drive-list", {
    body: { providerToken },
  });

  if (error) throw new Error(`Drive list failed: ${error.message}`);
  return data;
}

export async function downloadDriveFile(providerToken: string, fileId: string) {
  const { data, error } = await supabase.functions.invoke("drive-download", {
    body: { providerToken, fileId },
  });

  if (error) throw new Error(`Drive download failed: ${error.message}`);
  if (!data?.base64) throw new Error("No base64 returned from drive-download");

  return data.base64 as string;
}

export function base64ToFile(base64: string, fileName: string, mimeType: string) {
  const byteString = atob(base64);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
  return new File([bytes], fileName, { type: mimeType || "application/octet-stream" });
}
