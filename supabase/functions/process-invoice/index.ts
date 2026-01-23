import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileUrl, fileName, fileType } = await req.json();

    // Basic validation
    if (!fileUrl || !fileName || !fileType) {
      return new Response(
        JSON.stringify({ error: "Missing file data" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const allowedTypes = ["application/pdf", "image/png", "image/jpeg"];
    if (!allowedTypes.includes(fileType)) {
      return new Response(
        JSON.stringify({ error: "Unsupported file type" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Simulate processing (no AI, just metadata)
    const result = {
      file_name: fileName,
      file_type: fileType,
      file_url: fileUrl,
      status: "uploaded",
      processed_at: new Date().toISOString(),
      message: "File uploaded successfully",
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Edge function error:", error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});
