import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import {
  Users,
  FileText,
  AlertTriangle,
  Trash2,
  Flag,
  CheckCircle2,
  Loader2,
  Shield,
} from 'lucide-react';
import { format } from 'date-fns';

interface UserProfile {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  created_at: string;
}

interface Invoice {
  id: string;
  user_id: string;
  file_name: string;
  vendor_name: string | null;
  total_amount: number | null;
  is_flagged: boolean;
  created_at: string;
  profiles?: { email: string; full_name: string } | null;
}

export default function Admin() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalInvoices: 0,
    flaggedInvoices: 0,
  });

  useEffect(() => {
    if (isAdmin) {
      fetchData();
    }
  }, [isAdmin]);

  const fetchData = async () => {
    try {
      // Fetch all profiles
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      // Fetch all invoices
      const { data: invoicesData } = await supabase
        .from('invoices')
        .select('*')
        .order('created_at', { ascending: false });

      const { count: flaggedCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('is_flagged', true);

      setUsers(profilesData || []);
      setInvoices(invoicesData || []);
      setStats({
        totalUsers: profilesData?.length || 0,
        totalInvoices: invoicesData?.length || 0,
        flaggedInvoices: flaggedCount || 0,
      });
    } catch (error) {
      console.error('Error fetching admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteInvoice = async (id: string) => {
    try {
      const { error } = await supabase.from('invoices').delete().eq('id', id);
      if (error) throw error;
      setInvoices(invoices.filter((inv) => inv.id !== id));
      toast({ title: 'Invoice deleted' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Delete failed', description: error.message });
    }
  };

  const handleToggleFlag = async (id: string, currentFlag: boolean) => {
    try {
      const { error } = await supabase
        .from('invoices')
        .update({ is_flagged: !currentFlag })
        .eq('id', id);
      if (error) throw error;
      setInvoices(
        invoices.map((inv) => (inv.id === id ? { ...inv, is_flagged: !currentFlag } : inv))
      );
      toast({ title: currentFlag ? 'Flag removed' : 'Invoice flagged' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Update failed', description: error.message });
    }
  };

  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center min-h-[50vh]">
          <Shield className="h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">Access Denied</h2>
          <p className="text-muted-foreground">You don't have admin privileges.</p>
        </div>
      </DashboardLayout>
    );
  }

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
          <h1 className="text-3xl font-display font-bold">Admin Panel</h1>
          <p className="text-muted-foreground mt-1">
            Manage users and invoices across the platform
          </p>
        </div>

        {/* Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="glass-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Users</p>
                  <p className="text-3xl font-display font-bold mt-1">{stats.totalUsers}</p>
                </div>
                <div className="p-3 rounded-xl bg-primary/10">
                  <Users className="h-6 w-6 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Total Invoices</p>
                  <p className="text-3xl font-display font-bold mt-1">{stats.totalInvoices}</p>
                </div>
                <div className="p-3 rounded-xl bg-info/10">
                  <FileText className="h-6 w-6 text-info" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Flagged Invoices</p>
                  <p className="text-3xl font-display font-bold mt-1">{stats.flaggedInvoices}</p>
                </div>
                <div className="p-3 rounded-xl bg-warning/10">
                  <AlertTriangle className="h-6 w-6 text-warning" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="invoices">
          <TabsList>
            <TabsTrigger value="invoices">All Invoices</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
          </TabsList>

          <TabsContent value="invoices" className="mt-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>All Invoices</CardTitle>
                <CardDescription>Manage invoices across all users</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">
                                {invoice.profiles?.full_name || 'Unknown'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {invoice.profiles?.email}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>{invoice.vendor_name || invoice.file_name}</TableCell>
                          <TableCell>
                            {invoice.total_amount
                              ? `$${Number(invoice.total_amount).toLocaleString()}`
                              : '-'}
                          </TableCell>
                          <TableCell>
                            {format(new Date(invoice.created_at), 'MMM d, yyyy')}
                          </TableCell>
                          <TableCell>
                            {invoice.is_flagged ? (
                              <Badge className="bg-warning/10 text-warning">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                Flagged
                              </Badge>
                            ) : (
                              <Badge className="bg-success/10 text-success">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Normal
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleToggleFlag(invoice.id, invoice.is_flagged)}
                              >
                                <Flag
                                  className={`h-4 w-4 ${
                                    invoice.is_flagged ? 'text-warning fill-warning' : ''
                                  }`}
                                />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteInvoice(invoice.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users" className="mt-6">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle>Registered Users</CardTitle>
                <CardDescription>All users on the platform</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Joined</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell className="font-medium">
                            {user.full_name || 'No name'}
                          </TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>
                            {format(new Date(user.created_at), 'MMM d, yyyy')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
