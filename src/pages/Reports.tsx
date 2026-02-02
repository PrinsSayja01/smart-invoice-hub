import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import { Download, FileText, TrendingUp, DollarSign, Loader2 } from 'lucide-react';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface ReportData {
  monthlySpend: { month: string; amount: number }[];
  vendorBreakdown: { name: string; value: number }[];
  complianceStatus: { status: string; count: number }[];
  invoiceTypes: { type: string; count: number }[];
  totalSpend: number;
  averageInvoice: number;
  invoiceCount: number;
}

const COLORS = ['hsl(239, 84%, 67%)', 'hsl(172, 66%, 50%)', 'hsl(38, 92%, 50%)', 'hsl(280, 87%, 65%)'];

export default function Reports() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [reportData, setReportData] = useState<ReportData>({
    monthlySpend: [],
    vendorBreakdown: [],
    complianceStatus: [],
    invoiceTypes: [],
    totalSpend: 0,
    averageInvoice: 0,
    invoiceCount: 0,
  });

  useEffect(() => {
    if (user) {
      fetchReportData();
    }
  }, [user]);

  const fetchReportData = async () => {
    try {
      const { data: invoices } = await supabase
        .from('invoices')
        .select('*')
        .eq('user_id', user!.id);

      if (!invoices) return;

      // Calculate monthly spend for last 6 months
      const monthlySpend: { month: string; amount: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const date = subMonths(new Date(), i);
        const monthStart = startOfMonth(date);
        const monthEnd = endOfMonth(date);
        
        const monthInvoices = invoices.filter(inv => {
          const invDate = new Date(inv.created_at);
          return invDate >= monthStart && invDate <= monthEnd;
        });
        
        const total = monthInvoices.reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0);
        monthlySpend.push({
          month: format(date, 'MMM'),
          amount: total,
        });
      }

      // Vendor breakdown (top 5)
      const vendorTotals: { [key: string]: number } = {};
      invoices.forEach(inv => {
        const vendor = inv.vendor_name || 'Unknown';
        vendorTotals[vendor] = (vendorTotals[vendor] || 0) + (Number(inv.total_amount) || 0);
      });
      const vendorBreakdown = Object.entries(vendorTotals)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);

      // Compliance status
      const complianceCount: { [key: string]: number } = {
        compliant: 0,
        needs_review: 0,
        non_compliant: 0,
      };
      invoices.forEach(inv => {
        const status = inv.compliance_status || 'needs_review';
        complianceCount[status] = (complianceCount[status] || 0) + 1;
      });
      const complianceStatus = Object.entries(complianceCount)
        .map(([status, count]) => ({ status: status.replace('_', ' '), count }));

      // Invoice types
      const typeCount: { [key: string]: number } = {};
      invoices.forEach(inv => {
        const type = inv.invoice_type || 'other';
        typeCount[type] = (typeCount[type] || 0) + 1;
      });
      const invoiceTypes = Object.entries(typeCount)
        .map(([type, count]) => ({ type, count }));

      // Summary stats
      const totalSpend = invoices.reduce((sum, inv) => sum + (Number(inv.total_amount) || 0), 0);
      const averageInvoice = invoices.length > 0 ? totalSpend / invoices.length : 0;

      setReportData({
        monthlySpend,
        vendorBreakdown,
        complianceStatus,
        invoiceTypes,
        totalSpend,
        averageInvoice,
        invoiceCount: invoices.length,
      });
    } catch (error) {
      console.error('Error fetching report data:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = async () => {
    try {
      const { data: invoices } = await supabase
        .from('invoices')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });

      if (!invoices || invoices.length === 0) {
        toast({
          title: 'No data to export',
          description: 'Upload some invoices first.',
        });
        return;
      }

      const headers = [
        'Vendor',
        'Invoice Number',
        'Date',
        'Amount',
        'Tax',
        'Currency',
        'Type',
        'Risk',
        'Compliance',
        'Created At',
      ];

      const rows = invoices.map(inv => [
        inv.vendor_name || '',
        inv.invoice_number || '',
        inv.invoice_date || '',
        inv.total_amount || '',
        inv.tax_amount || '',
        inv.currency || '',
        inv.invoice_type || '',
        inv.risk_score || '',
        inv.compliance_status || '',
        format(new Date(inv.created_at), 'yyyy-MM-dd HH:mm:ss'),
      ]);

      const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      a.click();
      URL.revokeObjectURL(url);

      toast({
        title: 'Export complete',
        description: 'Your report has been downloaded.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Export failed',
        description: 'Could not generate the report.',
      });
    }
  };

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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold">Reports</h1>
            <p className="text-muted-foreground mt-1">
              Analytics and insights from your invoice data
            </p>
          </div>
          <Button onClick={exportToCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="glass-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Spend</p>
                  <p className="text-3xl font-display font-bold mt-1">
                    ${reportData.totalSpend.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-primary/10">
                  <DollarSign className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Average Invoice</p>
                  <p className="text-3xl font-display font-bold mt-1">
                    ${reportData.averageInvoice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-accent/10">
                  <TrendingUp className="h-6 w-6 text-accent" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Invoices</p>
                  <p className="text-3xl font-display font-bold mt-1">{reportData.invoiceCount}</p>
                </div>
                <div className="p-3 rounded-xl bg-info/10">
                  <FileText className="h-6 w-6 text-info" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Monthly Spend */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Monthly Spend</CardTitle>
              <CardDescription>Spending trend over the last 6 months</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={reportData.monthlySpend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="amount"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ fill: 'hsl(var(--primary))' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Vendor Breakdown */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Top Vendors</CardTitle>
              <CardDescription>Spend by vendor</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reportData.vendorBreakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" className="text-xs" />
                    <YAxis dataKey="name" type="category" className="text-xs" width={100} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Compliance Status */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Compliance Status</CardTitle>
              <CardDescription>Distribution of invoice compliance</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={reportData.complianceStatus}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="count"
                      nameKey="status"
                      label={({ status, count }) => `${status}: ${count}`}
                    >
                      {reportData.complianceStatus.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Invoice Types */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>Invoice Types</CardTitle>
              <CardDescription>Classification breakdown</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reportData.invoiceTypes}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="type" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="count" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
