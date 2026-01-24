# Invoice AI - Smart Invoice Hub

Welcome to Invoice AI! This is a simple tool to help people manage invoices easily. You can upload invoices, extract data from them, check for problems, and get reports. It's built to show what the full product could be like. The live site is at: [https://smart-invoice-hub-three.vercel.app/](https://smart-invoice-hub01.vercel.app/)

This README explains the project in easy words. It's for anyone who wants to know how it works, set it up, or try it.

## What is Invoice AI?

Invoice AI is a web app that helps users handle invoices with AI. It lets you sign up, upload files, process them, and ask questions to an AI chat. The goal is to make invoice work faster and safer. This version is ready for real users to test. It has login, invoice tools, AI helpers, and reports. It's hosted for free on Vercel.

At the end, we give:
- A live URL: [https://smart-invoice-hub-three.vercel.app/](https://smart-invoice-hub01.vercel.app/)
- Demo user: Use Google to log in
- Short setup guide: See below.

## Main Features

### 1. Login and User Accounts

- Sign in or sign up with Google (easy and fast).
- You can also use email and password if you want.
- Each user gets:
  - A profile page to see your info.
  - A dashboard to check how much you use the app.
  - Track tokens or usage (if we add limits).

### 2. User Dashboard

The main page shows:
- How many invoices you uploaded in total.
- Invoices processed this month.
- Any flagged (suspicious) invoices.
- Quick view of compliance (rules check).
- Buttons to:
  - Upload a new invoice.
  - See reports.
  - Chat with AI helper.

## How to Process Invoices

### Upload Invoices

- Upload PDFs or images (JPG/PNG).
- Use drag and drop for easy upload.
- Bonus (if added): Upload from email or Google Drive.

### Extract Data

After upload:
- The app reads the invoice with OCR (text from image).
- It finds:
  - Vendor name.
  - Invoice number.
  - Date.
  - Total amount.
  - Tax or VAT.
  - Currency.
- Shows the data to you.
- You can fix mistakes by hand before saving.
  
Note: If real OCR is hard, we use a fake one, but the whole process works.

## AI Helpers and Automation

This is the special part! We use AI agents (like smart rules or AI models) to help.

### The AI Workflow

1. **Ingestion Agent**: Checks the file and sends it to OCR.
2. **Classification Agent**: Says what type of invoice it is (services, goods, medical, or other). Also checks the language.
3. **Fraud Detection Agent**: Looks for problems like duplicates, weird amounts, or missing IDs. Gives a risk score: low, medium, or high.
4. **Tax Agent**: Checks tax rules (like VAT in EU or ZATCA). Says if it's okay or needs review. Uses simple rules.
5. **Reporting Agent**: Makes data ready for reports.

## AI Chatbot

Talk to the AI like a friend!
- Ask things like: "How many invoices this month?" or "Show suspicious ones."
- Or: "Which vendor has the highest spend?"
- Or: "What is my compliance status?"
- Or:"Generate a summary report"
- The chat uses real data from your account.
- We use AI like OpenAI or others, or fake answers with real info.

## Reports and Exports

- See summary reports: Monthly spend, vendors list, compliance info.
- Export to CSV file (easy to open in Excel).
- PDF export if possible.

## Admin Tools

For admins (special users):
- See all users.
- Check invoice counts.
- Delete or flag invoices.

## Tech Tools Used

- Front: Next.js (for nice, fast web pages).
- Back: Node.js or Python (pick one).
- Database: PostgreSQL or MongoDB (to store data).
- Host: Vercel (free and easy).

## How to Set Up and Deploy

1. Get the code from GitHub.
2. Install tools: Run `npm install` (for Next.js).
3. Set up database: Use free Supabase or local.
4. Add API keys for AI (like OpenAI).
5. Run locally: `npm run dev`.
6. Deploy: Push to Vercel, it auto-builds.

## What Works and What's Next

- Works: Sign up, upload invoice, extract data, AI checks, chat, reports.
- Mocked: Some OCR and tax rules are simple fakes.
- Extend: Add real OCR, more AI, paid plans for production.

This app is easy for anyone to try. Open the link, sign in, upload an invoice, and see! If you have questions, check the code or ask. Thanks for trying Invoice AI!
