import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";

export default function CorporateCards() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Corporate Cards</h1>
          <p className="text-muted-foreground mt-1">View corporate card transactions (skeleton page).</p>
        </div>
        <Card className="glass-card"><CardContent className="p-6 text-muted-foreground">Uses public.card_transactions table. Add a sync function to ingest from provider APIs.</CardContent></Card>
      </div>
    </DashboardLayout>
  );
}
