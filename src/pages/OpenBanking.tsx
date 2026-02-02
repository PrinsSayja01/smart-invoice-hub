import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";

export default function OpenBanking() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Open Banking</h1>
          <p className="text-muted-foreground mt-1">Sync transactions and reconcile invoices (skeleton page).</p>
        </div>
        <Card className="glass-card"><CardContent className="p-6 text-muted-foreground">Integration skeleton: implement bank connector in a Supabase Edge Function and store transactions.</CardContent></Card>
      </div>
    </DashboardLayout>
  );
}
