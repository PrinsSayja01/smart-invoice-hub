export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          agent_processing: Json | null
          compliance_status:
            | Database["public"]["Enums"]["compliance_status"]
            | null
          created_at: string
          currency: string | null
          file_name: string
          file_type: string
          file_url: string
          flag_reason: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          invoice_type: Database["public"]["Enums"]["invoice_type"] | null
          is_duplicate: boolean | null
          is_flagged: boolean | null
          language: string | null
          ocr_data: Json | null
          risk_score: Database["public"]["Enums"]["risk_level"] | null
          tax_amount: number | null
          total_amount: number | null
          updated_at: string
          user_id: string
          vendor_name: string | null
        
          anomaly_flags: Json | null
          approval: Database["public"]["Enums"]["approval_status"] | null
          approval_confidence: number | null
          approval_reasons: string[] | null
          category: string | null
          co2e_estimate: number | null
          compliance_issues: Json | null
          direction: Database["public"]["Enums"]["direction_type"] | null
          direction_confidence: number | null
          doc_class: Database["public"]["Enums"]["doc_type"] | null
          doc_class_confidence: number | null
          document_hash: string | null
          due_date: string | null
          emissions_confidence: number | null
          esg_category: string | null
          field_confidence: Json | null
          fraud_score: number | null
          jurisdiction: string | null
          needs_info_fields: string[] | null
          payment_payload: Json | null
          payment_qr_string: string | null
          payment_terms: string | null
          project_code: string | null
          vat_amount_computed: number | null
          vat_rate: number | null
}
        Insert: {
          agent_processing?: Json | null
          compliance_status?:
            | Database["public"]["Enums"]["compliance_status"]
            | null
          created_at?: string
          currency?: string | null
          file_name: string
          file_type: string
          file_url: string
          flag_reason?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: Database["public"]["Enums"]["invoice_type"] | null
          is_duplicate?: boolean | null
          is_flagged?: boolean | null
          language?: string | null
          ocr_data?: Json | null
          risk_score?: Database["public"]["Enums"]["risk_level"] | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string
          user_id: string
          vendor_name?: string | null
        
          anomaly_flags?: Json | null
          approval?: Database["public"]["Enums"]["approval_status"] | null
          approval_confidence?: number | null
          approval_reasons?: string[] | null
          category?: string | null
          co2e_estimate?: number | null
          compliance_issues?: Json | null
          direction?: Database["public"]["Enums"]["direction_type"] | null
          direction_confidence?: number | null
          doc_class?: Database["public"]["Enums"]["doc_type"] | null
          doc_class_confidence?: number | null
          document_hash?: string | null
          due_date?: string | null
          emissions_confidence?: number | null
          esg_category?: string | null
          field_confidence?: Json | null
          fraud_score?: number | null
          jurisdiction?: string | null
          needs_info_fields?: string[] | null
          payment_payload?: Json | null
          payment_qr_string?: string | null
          payment_terms?: string | null
          project_code?: string | null
          vat_amount_computed?: number | null
          vat_rate?: number | null
}
        Update: {
          agent_processing?: Json | null
          compliance_status?:
            | Database["public"]["Enums"]["compliance_status"]
            | null
          created_at?: string
          currency?: string | null
          file_name?: string
          file_type?: string
          file_url?: string
          flag_reason?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: Database["public"]["Enums"]["invoice_type"] | null
          is_duplicate?: boolean | null
          is_flagged?: boolean | null
          language?: string | null
          ocr_data?: Json | null
          risk_score?: Database["public"]["Enums"]["risk_level"] | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string
          user_id?: string
          vendor_name?: string | null
        
          anomaly_flags?: Json | null
          approval?: Database["public"]["Enums"]["approval_status"] | null
          approval_confidence?: number | null
          approval_reasons?: string[] | null
          category?: string | null
          co2e_estimate?: number | null
          compliance_issues?: Json | null
          direction?: Database["public"]["Enums"]["direction_type"] | null
          direction_confidence?: number | null
          doc_class?: Database["public"]["Enums"]["doc_type"] | null
          doc_class_confidence?: number | null
          document_hash?: string | null
          due_date?: string | null
          emissions_confidence?: number | null
          esg_category?: string | null
          field_confidence?: Json | null
          fraud_score?: number | null
          jurisdiction?: string | null
          needs_info_fields?: string[] | null
          payment_payload?: Json | null
          payment_qr_string?: string | null
          payment_terms?: string | null
          project_code?: string | null
          vat_amount_computed?: number | null
          vat_rate?: number | null
}
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      compliance_status: "compliant" | "needs_review" | "non_compliant"
      invoice_type: "services" | "goods" | "medical" | "other"
      risk_level: "low" | "medium" | "high"
      doc_type: "invoice" | "receipt" | "offer" | "prescription" | "sick_note" | "other"
      direction_type: "incoming" | "outgoing" | "unknown"
      approval_status: "pass" | "fail" | "needs_info" | "pending"
      payment_status: "draft" | "queued" | "processing" | "paid" | "failed" | "canceled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      compliance_status: ["compliant", "needs_review", "non_compliant"],
      invoice_type: ["services", "goods", "medical", "other"],
      risk_level: ["low", "medium", "high"],
    },
  },
} as const
