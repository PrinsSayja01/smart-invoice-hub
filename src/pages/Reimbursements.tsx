import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";

export default function Reimbursements() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Reimbursements</h1>
          <p className="text-muted-foreground mt-1">Submit and approve employee reimbursements (skeleton page).</p>
        </div>
        <Card className="glass-card"><CardContent className="p-6 text-muted-foreground">Uses public.reimbursements table. Add UI for creating claims + approval workflow.</CardContent></Card>
      </div>
    </DashboardLayout>
  );
}
