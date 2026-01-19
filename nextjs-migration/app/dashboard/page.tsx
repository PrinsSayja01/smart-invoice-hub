"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClientComponentClient } from "@/lib/supabase";

interface DashboardStats {
  totalInvoices: number;
  pendingReview: number;
  totalAmount: number;
  flaggedInvoices: number;
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({
    totalInvoices: 0,
    pendingReview: 0,
    totalAmount: 0,
    flaggedInvoices: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth");
    }
  }, [status, router]);

  useEffect(() => {
    async function fetchStats() {
      if (!session?.user?.id) return;

      const supabase = createClientComponentClient();

      try {
        const { data: invoices, error } = await supabase
          .from("invoices")
          .select("*");

        if (error) throw error;

        const totalInvoices = invoices?.length || 0;
        const pendingReview =
          invoices?.filter((inv) => inv.compliance_status === "needs_review")
            .length || 0;
        const totalAmount =
          invoices?.reduce((sum, inv) => sum + (inv.total_amount || 0), 0) || 0;
        const flaggedInvoices =
          invoices?.filter((inv) => inv.is_flagged).length || 0;

        setStats({
          totalInvoices,
          pendingReview,
          totalAmount,
          flaggedInvoices,
        });
      } catch (error) {
        console.error("Error fetching stats:", error);
      } finally {
        setLoading(false);
      }
    }

    if (session) {
      fetchStats();
    }
  }, [session]);

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">Smart Invoice Hub</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {session?.user?.email}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="px-4 py-2 text-sm border rounded-lg hover:bg-muted transition"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold">
            Welcome, {session?.user?.name || "User"}!
          </h2>
          <p className="text-muted-foreground">
            Here's your invoice dashboard overview
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-card border rounded-xl p-6">
            <p className="text-sm text-muted-foreground">Total Invoices</p>
            <p className="text-3xl font-bold mt-2">{stats.totalInvoices}</p>
          </div>
          <div className="bg-card border rounded-xl p-6">
            <p className="text-sm text-muted-foreground">Pending Review</p>
            <p className="text-3xl font-bold mt-2">{stats.pendingReview}</p>
          </div>
          <div className="bg-card border rounded-xl p-6">
            <p className="text-sm text-muted-foreground">Total Amount</p>
            <p className="text-3xl font-bold mt-2">
              ${stats.totalAmount.toLocaleString()}
            </p>
          </div>
          <div className="bg-card border rounded-xl p-6">
            <p className="text-sm text-muted-foreground">Flagged</p>
            <p className="text-3xl font-bold mt-2">{stats.flaggedInvoices}</p>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-card border rounded-xl p-6">
          <h3 className="font-semibold mb-4">Quick Actions</h3>
          <div className="flex flex-wrap gap-4">
            <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition">
              Upload Invoice
            </button>
            <button className="px-4 py-2 border rounded-lg hover:bg-muted transition">
              View All Invoices
            </button>
            <button className="px-4 py-2 border rounded-lg hover:bg-muted transition">
              Generate Report
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
