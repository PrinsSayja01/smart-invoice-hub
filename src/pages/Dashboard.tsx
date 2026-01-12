import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import {
  FileText,
  Upload,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
  MessageSquare,
  TrendingUp,
  Calendar,
  Loader2,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';

interface DashboardStats {
  totalInvoices: number;
  monthlyInvoices: number;
  flaggedInvoices: number;
  compliantInvoices: number;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    totalInvoices: 0,
    monthlyInvoices: 0,
    flaggedInvoices: 0,
    compliantInvoices: 0,
  });
  const [loading, setLoading] = useState(true);
  const [recentInvoices, setRecentInvoices] = useState<any[]>([]);

  useEffect(() => {
    if (user) {
      fetchStats();
      fetchRecentInvoices();
    }
  }, [user]);

  const fetchStats = async () => {
    try {
      const now = new Date();
      const monthStart = startOfMonth(now);
      const monthEnd = endOfMonth(now);

      // Total invoices
      const { count: totalCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user!.id);

      // Monthly invoices
      const { count: monthlyCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .gte('created_at', monthStart.toISOString())
        .lte('created_at', monthEnd.toISOString());

      // Flagged invoices
      const { count: flaggedCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .eq('is_flagged', true);

      // Compliant invoices
      const { count: compliantCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .eq('compliance_status', 'compliant');

      setStats({
        totalInvoices: totalCount || 0,
        monthlyInvoices: monthlyCount || 0,
        flaggedInvoices: flaggedCount || 0,
        compliantInvoices: compliantCount || 0,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecentInvoices = async () => {
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })
      .limit(5);

    setRecentInvoices(data || []);
  };

  const statCards = [
    {
      title: 'Total Invoices',
      value: stats.totalInvoices,
      icon: FileText,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
    },
    {
      title: 'This Month',
      value: stats.monthlyInvoices,
      icon: Calendar,
      color: 'text-info',
      bgColor: 'bg-info/10',
    },
    {
      title: 'Flagged',
      value: stats.flaggedInvoices,
      icon: AlertTriangle,
      color: 'text-warning',
      bgColor: 'bg-warning/10',
    },
    {
      title: 'Compliant',
      value: stats.compliantInvoices,
      icon: CheckCircle2,
      color: 'text-success',
      bgColor: 'bg-success/10',
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-display font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back! Here's an overview of your invoice processing.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <Card key={stat.title} className="glass-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                    {loading ? (
                      <Loader2 className="h-6 w-6 animate-spin mt-2" />
                    ) : (
                      <p className="text-3xl font-display font-bold mt-1">{stat.value}</p>
                    )}
                  </div>
                  <div className={`p-3 rounded-xl ${stat.bgColor}`}>
                    <stat.icon className={`h-6 w-6 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="grid gap-4 md:grid-cols-3">
          <Link to="/dashboard/upload">
            <Card className="glass-card hover:border-primary/50 transition-all cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                    <Upload className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Upload Invoice</h3>
                    <p className="text-sm text-muted-foreground">Process a new invoice</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link to="/dashboard/reports">
            <Card className="glass-card hover:border-primary/50 transition-all cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-info/10 group-hover:bg-info/20 transition-colors">
                    <BarChart3 className="h-6 w-6 text-info" />
                  </div>
                  <div>
                    <h3 className="font-semibold">View Reports</h3>
                    <p className="text-sm text-muted-foreground">Analytics & insights</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link to="/dashboard/chat">
            <Card className="glass-card hover:border-primary/50 transition-all cursor-pointer group">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-accent/10 group-hover:bg-accent/20 transition-colors">
                    <MessageSquare className="h-6 w-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold">AI Assistant</h3>
                    <p className="text-sm text-muted-foreground">Ask about your invoices</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Recent Invoices */}
        <Card className="glass-card">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Recent Invoices</CardTitle>
                <CardDescription>Your latest processed invoices</CardDescription>
              </div>
              <Button variant="outline" asChild>
                <Link to="/dashboard/invoices">View All</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recentInvoices.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                <p className="text-muted-foreground">No invoices yet</p>
                <Button className="mt-4" asChild>
                  <Link to="/dashboard/upload">Upload your first invoice</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {recentInvoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="p-2 rounded-lg bg-card">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{invoice.vendor_name || invoice.file_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {invoice.invoice_number || 'No number'} •{' '}
                          {format(new Date(invoice.created_at), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {invoice.total_amount && (
                        <p className="font-semibold">
                          {invoice.currency} {Number(invoice.total_amount).toLocaleString()}
                        </p>
                      )}
                      <div
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          invoice.compliance_status === 'compliant'
                            ? 'bg-success/10 text-success'
                            : invoice.compliance_status === 'non_compliant'
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-warning/10 text-warning'
                        }`}
                      >
                        {invoice.compliance_status?.replace('_', ' ')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
