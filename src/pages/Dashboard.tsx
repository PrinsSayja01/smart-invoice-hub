import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { FileText, Upload, TrendingUp, AlertTriangle, Loader2, Sparkles, ArrowRight, BarChart3 } from 'lucide-react';
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
      <div className="space-y-8">
        {/* Hero Cover Section */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary/80 to-accent p-8 text-primary-foreground">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4xIj48Y2lyY2xlIGN4PSIzMCIgY3k9IjMwIiByPSIyIi8+PC9nPjwvZz48L3N2Zz4=')] opacity-30" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-5 w-5" />
              <span className="text-sm font-medium opacity-90">AI-Powered Invoice Management</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-2">
              Welcome back, {user?.email?.split('@')[0] || 'there'}! 👋
            </h1>
            <p className="text-lg opacity-90 max-w-xl">
              Your intelligent invoice hub is ready. Upload, analyze, and manage invoices with AI assistance.
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              <Button 
                onClick={() => navigate('/dashboard/upload')}
                className="bg-white text-primary hover:bg-white/90 shadow-lg"
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload Invoice
              </Button>
              <Button 
                onClick={() => navigate('/dashboard/chat')}
                variant="outline"
                className="border-white/30 text-white hover:bg-white/10 backdrop-blur-sm"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Ask AI Assistant
              </Button>
            </div>
          </div>
          {/* Decorative elements */}
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -right-5 -bottom-10 h-32 w-32 rounded-full bg-accent/30 blur-2xl" />
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-l-4 border-l-primary">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Invoices</CardTitle>
              <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                <FileText className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.totalInvoices}</div>
              <p className="text-xs text-muted-foreground mt-1">All processed invoices</p>
            </CardContent>
          </Card>

          <Card className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-l-4 border-l-warning">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending Review</CardTitle>
              <div className="p-2 rounded-lg bg-warning/10 text-warning group-hover:bg-warning group-hover:text-warning-foreground transition-colors">
                <AlertTriangle className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.pendingReview}</div>
              <p className="text-xs text-muted-foreground mt-1">Needs your attention</p>
            </CardContent>
          </Card>

          <Card className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-l-4 border-l-success">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Amount</CardTitle>
              <div className="p-2 rounded-lg bg-success/10 text-success group-hover:bg-success group-hover:text-success-foreground transition-colors">
                <TrendingUp className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                ${stats.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Combined invoice value</p>
            </CardContent>
          </Card>

          <Card className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-l-4 border-l-destructive">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Flagged Issues</CardTitle>
              <div className="p-2 rounded-lg bg-destructive/10 text-destructive group-hover:bg-destructive group-hover:text-destructive-foreground transition-colors">
                <AlertTriangle className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.flaggedInvoices}</div>
              <p className="text-xs text-muted-foreground mt-1">Invoices with issues</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions & Getting Started */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                Quick Actions
              </CardTitle>
              <CardDescription>Common tasks and shortcuts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button 
                className="w-full justify-between group" 
                variant="ghost"
                onClick={() => navigate('/dashboard/upload')}
              >
                <span className="flex items-center">
                  <Upload className="mr-3 h-4 w-4 text-primary" />
                  Upload New Invoice
                </span>
                <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Button>
              <Button 
                className="w-full justify-between group" 
                variant="ghost"
                onClick={() => navigate('/dashboard/invoices')}
              >
                <span className="flex items-center">
                  <FileText className="mr-3 h-4 w-4 text-primary" />
                  View All Invoices
                </span>
                <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Button>
              <Button 
                className="w-full justify-between group" 
                variant="ghost"
                onClick={() => navigate('/dashboard/reports')}
              >
                <span className="flex items-center">
                  <TrendingUp className="mr-3 h-4 w-4 text-primary" />
                  View Reports
                </span>
                <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Button>
              <Button 
                className="w-full justify-between group" 
                variant="ghost"
                onClick={() => navigate('/dashboard/chat')}
              >
                <span className="flex items-center">
                  <Sparkles className="mr-3 h-4 w-4 text-primary" />
                  AI Assistant
                </span>
                <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-muted/50 to-muted hover:shadow-lg transition-shadow">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI-Powered Features
              </CardTitle>
              <CardDescription>Let AI do the heavy lifting</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Our AI automatically extracts key information, detects anomalies, and provides instant insights about your invoices.
              </p>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <div className="h-2 w-2 rounded-full bg-success" />
                  <span>Smart data extraction</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <div className="h-2 w-2 rounded-full bg-success" />
                  <span>Duplicate detection</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <div className="h-2 w-2 rounded-full bg-success" />
                  <span>Natural language queries</span>
                </div>
              </div>
              <Button onClick={() => navigate('/dashboard/chat')} className="w-full">
                <Sparkles className="mr-2 h-4 w-4" />
                Try AI Assistant
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
