import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

export default function GoogleDriveCallback() {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
      // Handle error
      window.opener?.postMessage({
        type: 'GOOGLE_DRIVE_ERROR',
        error: error,
      }, window.location.origin);
      window.close();
      return;
    }

    if (code && state) {
      // Send success message to opener
      window.opener?.postMessage({
        type: 'GOOGLE_DRIVE_CONNECTED',
        code,
        state,
      }, window.location.origin);
      
      // Close popup
      setTimeout(() => {
        window.close();
      }, 1000);
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <h1 className="text-xl font-semibold">Connecting Google Drive...</h1>
        <p className="text-muted-foreground">Please wait while we connect your account.</p>
      </div>
    </div>
  );
}
