import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { FileText, Upload, TrendingUp, AlertTriangle, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface DashboardStats {
  totalInvoices: number;
  pendingReview: number;
  totalAmount: number;
  flaggedInvoices: number;
}
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>({
    totalInvoices: 0,
    pendingReview: 0,
    totalAmount: 0,
    flaggedInvoices: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      if (!user) return;

      try {
        const { data: invoices, error } = await supabase
          .from('invoices')
          .select('*')
          .eq('user_id', user.id);

        if (error) throw error;

        const totalInvoices = invoices?.length || 0;
        const pendingReview = invoices?.filter(inv => inv.compliance_status === 'needs_review').length || 0;
        const totalAmount = invoices?.reduce((sum, inv) => sum + (inv.total_amount || 0), 0) || 0;
        const flaggedInvoices = invoices?.filter(inv => inv.is_flagged).length || 0;

        setStats({
          totalInvoices,
          pendingReview,
          totalAmount,
          flaggedInvoices,
        });
      } catch (error) {
        console.error('Error fetching stats:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [user]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back! Here's an overview of your invoice processing.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Invoices</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalInvoices}</div>
              <p className="text-xs text-muted-foreground">All processed invoices</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.pendingReview}</div>
              <p className="text-xs text-muted-foreground">Invoices needing attention</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${stats.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground">Combined invoice value</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Flagged</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.flaggedInvoices}</div>
              <p className="text-xs text-muted-foreground">Invoices with issues</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common tasks and shortcuts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                className="w-full justify-start" 
                variant="outline"
                onClick={() => navigate('/dashboard/upload')}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload New Invoice
              </Button>
              <Button 
                className="w-full justify-start" 
                variant="outline"
                onClick={() => navigate('/dashboard/invoices')}
              >
                <FileText className="mr-2 h-4 w-4" />
                View All Invoices
              </Button>
              <Button 
                className="w-full justify-start" 
                variant="outline"
                onClick={() => navigate('/dashboard/reports')}
              >
                <TrendingUp className="mr-2 h-4 w-4" />
                View Reports
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Getting Started</CardTitle>
              <CardDescription>New to Invoice AI?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Upload your first invoice to get started. Our AI will automatically extract 
                key information, detect potential issues, and help you manage your invoices efficiently.
              </p>
              <Button onClick={() => navigate('/dashboard/upload')}>
                <Upload className="mr-2 h-4 w-4" />
                Upload Your First Invoice
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
