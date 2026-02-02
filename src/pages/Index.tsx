import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  FileText,
  Upload,
  Bot,
  Shield,
  BarChart3,
  Zap,
  CheckCircle2,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

const features = [
  {
    icon: Upload,
    title: 'Smart Upload',
    description: 'Drag and drop PDF or image invoices. Our AI extracts all key data automatically.',
  },
  {
    icon: Bot,
    title: 'Multi-Agent AI',
    description: 'Five specialized AI agents work together to classify, validate, and analyze invoices.',
  },
  {
    icon: Shield,
    title: 'Fraud Detection',
    description: 'Detect duplicate invoices, unusual amounts, and missing tax IDs automatically.',
  },
  {
    icon: BarChart3,
    title: 'Smart Reports',
    description: 'Get instant insights with spend analysis, vendor breakdowns, and compliance status.',
  },
];

const agents = [
  { name: 'Ingestion Agent', desc: 'Validates and prepares documents' },
  { name: 'Classification Agent', desc: 'Categorizes invoice types' },
  { name: 'Fraud Detection Agent', desc: 'Identifies anomalies' },
  { name: 'Compliance Agent', desc: 'Checks tax regulations' },
  { name: 'Reporting Agent', desc: 'Generates insights' },
];

export default function Index() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl gradient-primary">
              <FileText className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-display text-xl font-bold">Invoice AI</span>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" asChild>
              <Link to="/auth">Sign In</Link>
            </Button>
            <Button asChild className="gradient-primary">
              <Link to="/auth">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="container mx-auto text-center">
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-float" />
            <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '3s' }} />
          </div>
          
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Sparkles className="h-4 w-4" />
              Powered by Multi-Agent AI
            </div>
            
            <h1 className="text-5xl md:text-7xl font-display font-bold mb-6 leading-tight">
              Intelligent Invoice
              <br />
              <span className="gradient-text">Processing</span>
            </h1>
            
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
              Transform your invoice workflow with AI. Extract data, detect fraud, ensure compliance,
              and get insights—all automatically.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" asChild className="gradient-primary text-lg px-8">
                <Link to="/auth">
                  Start Free Trial
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="text-lg px-8">
                <a href="#features">See How It Works</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-20 px-4 bg-muted/30">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
              Everything You Need
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              A complete solution for invoice processing, from upload to insights
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, i) => (
              <Card key={i} className="glass-card hover:border-primary/50 transition-all group">
                <CardContent className="p-6">
                  <div className="p-3 rounded-xl bg-primary/10 w-fit mb-4 group-hover:bg-primary/20 transition-colors">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* AI Agents Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-display font-bold mb-6">
                5 AI Agents Working
                <br />
                <span className="gradient-text">Together For You</span>
              </h2>
              <p className="text-lg text-muted-foreground mb-8">
                Our multi-agent system ensures every invoice is thoroughly processed through specialized
                stages, from ingestion to final reporting.
              </p>
              
              <div className="space-y-4">
                {agents.map((agent, i) => (
                  <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-muted/50 hover:bg-muted transition-colors">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
                      {i + 1}
                    </div>
                    <div>
                      <p className="font-semibold">{agent.name}</p>
                      <p className="text-sm text-muted-foreground">{agent.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="relative">
              <div className="absolute inset-0 gradient-primary rounded-3xl blur-3xl opacity-20" />
              <Card className="relative glass-card p-8">
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-success/10">
                      <CheckCircle2 className="h-6 w-6 text-success" />
                    </div>
                    <div>
                      <p className="font-semibold">Invoice Processed</p>
                      <p className="text-sm text-muted-foreground">All agents completed</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl bg-muted/50">
                      <p className="text-sm text-muted-foreground">Vendor</p>
                      <p className="font-semibold">Acme Corp</p>
                    </div>
                    <div className="p-4 rounded-xl bg-muted/50">
                      <p className="text-sm text-muted-foreground">Amount</p>
                      <p className="font-semibold">$12,500.00</p>
                    </div>
                    <div className="p-4 rounded-xl bg-muted/50">
                      <p className="text-sm text-muted-foreground">Type</p>
                      <p className="font-semibold">Services</p>
                    </div>
                    <div className="p-4 rounded-xl bg-muted/50">
                      <p className="text-sm text-muted-foreground">Risk</p>
                      <p className="font-semibold text-success">Low</p>
                    </div>
                  </div>
                  
                  <div className="p-4 rounded-xl bg-success/10 border border-success/20">
                    <p className="text-sm text-success font-medium">
                      ✓ Compliant with tax regulations
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto">
          <Card className="gradient-primary p-12 text-center">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-primary-foreground mb-4">
              Ready to Transform Your Invoice Workflow?
            </h2>
            <p className="text-lg text-primary-foreground/80 max-w-2xl mx-auto mb-8">
              Join companies using Invoice AI to save time, reduce errors, and gain insights
              from their financial documents.
            </p>
            <Button size="lg" variant="secondary" asChild className="text-lg px-8">
              <Link to="/auth">
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12 px-4">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl gradient-primary">
                <FileText className="h-5 w-5 text-primary-foreground" />
              </div>
              <span className="font-display text-lg font-bold">Invoice AI</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2026 Invoice AI. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
