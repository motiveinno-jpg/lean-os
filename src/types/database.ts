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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ai_interactions: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          model: string | null
          query: string
          response: string | null
          tokens_used: number | null
          tool_calls: Json | null
          user_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          id?: string
          model?: string | null
          query: string
          response?: string | null
          tokens_used?: number | null
          tool_calls?: Json | null
          user_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          model?: string | null
          query?: string
          response?: string | null
          tokens_used?: number | null
          tool_calls?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_interactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_interactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_pending_actions: {
        Row: {
          action_type: string
          approved_by: string | null
          company_id: string
          created_at: string | null
          decided_at: string | null
          description: string
          entity_id: string | null
          entity_type: string
          id: string
          payload: Json
          status: string | null
          user_id: string | null
        }
        Insert: {
          action_type: string
          approved_by?: string | null
          company_id: string
          created_at?: string | null
          decided_at?: string | null
          description: string
          entity_id?: string | null
          entity_type: string
          id?: string
          payload: Json
          status?: string | null
          user_id?: string | null
        }
        Update: {
          action_type?: string
          approved_by?: string | null
          company_id?: string
          created_at?: string | null
          decided_at?: string | null
          description?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          payload?: Json
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_pending_actions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_pending_actions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_pending_actions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_policies: {
        Row: {
          auto_approve: boolean | null
          auto_approve_threshold: number | null
          company_id: string
          created_at: string | null
          entity_type: string
          id: string
          max_amount: number | null
          min_amount: number | null
          required_role: string | null
        }
        Insert: {
          auto_approve?: boolean | null
          auto_approve_threshold?: number | null
          company_id: string
          created_at?: string | null
          entity_type: string
          id?: string
          max_amount?: number | null
          min_amount?: number | null
          required_role?: string | null
        }
        Update: {
          auto_approve?: boolean | null
          auto_approve_threshold?: number | null
          company_id?: string
          created_at?: string | null
          entity_type?: string
          id?: string
          max_amount?: number | null
          min_amount?: number | null
          required_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_policies_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          amount: number | null
          attachments: string[] | null
          company_id: string
          created_at: string | null
          current_stage: number | null
          description: string | null
          id: string
          policy_id: string | null
          request_id: string | null
          request_type: string
          requester_id: string
          status: string | null
          title: string
          total_stages: number | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          attachments?: string[] | null
          company_id: string
          created_at?: string | null
          current_stage?: number | null
          description?: string | null
          id?: string
          policy_id?: string | null
          request_id?: string | null
          request_type?: string
          requester_id: string
          status?: string | null
          title: string
          total_stages?: number | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          attachments?: string[] | null
          company_id?: string
          created_at?: string | null
          current_stage?: number | null
          description?: string | null
          id?: string
          policy_id?: string | null
          request_id?: string | null
          request_type?: string
          requester_id?: string
          status?: string | null
          title?: string
          total_stages?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "approval_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_steps: {
        Row: {
          approver_id: string
          comment: string | null
          created_at: string | null
          decided_at: string | null
          id: string
          request_id: string
          stage: number
          stage_name: string | null
          status: string | null
        }
        Insert: {
          approver_id: string
          comment?: string | null
          created_at?: string | null
          decided_at?: string | null
          id?: string
          request_id: string
          stage?: number
          stage_name?: string | null
          status?: string | null
        }
        Update: {
          approver_id?: string
          comment?: string | null
          created_at?: string | null
          decided_at?: string | null
          id?: string
          request_id?: string
          stage?: number
          stage_name?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_steps_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_steps_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          check_in: string | null
          check_out: string | null
          company_id: string
          created_at: string | null
          date: string
          employee_id: string
          id: string
          note: string | null
          overtime_hours: number | null
          status: string | null
          work_hours: number | null
        }
        Insert: {
          check_in?: string | null
          check_out?: string | null
          company_id: string
          created_at?: string | null
          date: string
          employee_id: string
          id?: string
          note?: string | null
          overtime_hours?: number | null
          status?: string | null
          work_hours?: number | null
        }
        Update: {
          check_in?: string | null
          check_out?: string | null
          company_id?: string
          created_at?: string | null
          date?: string
          employee_id?: string
          id?: string
          note?: string | null
          overtime_hours?: number | null
          status?: string | null
          work_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          after_json: Json | null
          before_json: Json | null
          company_id: string
          created_at: string | null
          entity_id: string
          entity_type: string
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          after_json?: Json | null
          before_json?: Json | null
          company_id: string
          created_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          after_json?: Json | null
          before_json?: Json | null
          company_id?: string
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_discovery_results: {
        Row: {
          company_id: string
          created_at: string | null
          estimated_monthly_cost: number | null
          id: string
          name: string
          pattern_description: string | null
          source_transaction_ids: string[] | null
          status: string | null
          suggested_type: string
          vault_account_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          estimated_monthly_cost?: number | null
          id?: string
          name: string
          pattern_description?: string | null
          source_transaction_ids?: string[] | null
          status?: string | null
          suggested_type: string
          vault_account_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          estimated_monthly_cost?: number | null
          id?: string
          name?: string
          pattern_description?: string | null
          source_transaction_ids?: string[] | null
          status?: string | null
          suggested_type?: string
          vault_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auto_discovery_results_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_discovery_results_vault_account_id_fkey"
            columns: ["vault_account_id"]
            isOneToOne: false
            referencedRelation: "vault_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_credentials: {
        Row: {
          company_id: string
          created_at: string | null
          credentials: Json
          id: string
          service: string
          updated_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          credentials?: Json
          id?: string
          service: string
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          credentials?: Json
          id?: string
          service?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_credentials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_logs: {
        Row: {
          action: string
          company_id: string
          created_at: string | null
          details: Json | null
          id: string
          service: string
          status: string
        }
        Insert: {
          action: string
          company_id: string
          created_at?: string | null
          details?: Json | null
          id?: string
          service: string
          status?: string
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          service?: string
          status?: string
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          company_id: string
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          result_summary: Json | null
          run_type: string
          started_at: string
          status: string
          triggered_by: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          result_summary?: Json | null
          run_type: string
          started_at?: string
          status?: string
          triggered_by?: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          result_summary?: Json | null
          run_type?: string
          started_at?: string
          status?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_accounts: {
        Row: {
          account_number: string
          alias: string | null
          balance: number | null
          bank_name: string
          company_id: string
          created_at: string | null
          id: string
          is_primary: boolean | null
          role: string
        }
        Insert: {
          account_number: string
          alias?: string | null
          balance?: number | null
          bank_name: string
          company_id: string
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          role?: string
        }
        Update: {
          account_number?: string
          alias?: string | null
          balance?: number | null
          bank_name?: string
          company_id?: string
          created_at?: string | null
          id?: string
          is_primary?: boolean | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_classification_rules: {
        Row: {
          assign_category: string | null
          assign_classification: string | null
          assign_deal_id: string | null
          auto_generated: boolean | null
          company_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_fixed_cost: boolean | null
          last_learned_at: string | null
          learned_from_count: number | null
          match_field: string
          match_type: string
          match_value: string
          priority: number | null
          rule_name: string
        }
        Insert: {
          assign_category?: string | null
          assign_classification?: string | null
          assign_deal_id?: string | null
          auto_generated?: boolean | null
          company_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_fixed_cost?: boolean | null
          last_learned_at?: string | null
          learned_from_count?: number | null
          match_field: string
          match_type: string
          match_value: string
          priority?: number | null
          rule_name: string
        }
        Update: {
          assign_category?: string | null
          assign_classification?: string | null
          assign_deal_id?: string | null
          auto_generated?: boolean | null
          company_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_fixed_cost?: boolean | null
          last_learned_at?: string | null
          learned_from_count?: number | null
          match_field?: string
          match_type?: string
          match_value?: string
          priority?: number | null
          rule_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_classification_rules_assign_deal_id_fkey"
            columns: ["assign_deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_classification_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          amount: number
          balance_after: number | null
          bank_account_id: string | null
          card_transaction_id: string | null
          category: string | null
          classification: string | null
          company_id: string
          counterparty: string | null
          created_at: string | null
          deal_id: string | null
          description: string | null
          id: string
          is_fixed_cost: boolean | null
          mapped_at: string | null
          mapped_by: string | null
          mapping_status: string | null
          memo: string | null
          raw_data: Json | null
          source: string | null
          tax_invoice_id: string | null
          transaction_date: string
          type: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          bank_account_id?: string | null
          card_transaction_id?: string | null
          category?: string | null
          classification?: string | null
          company_id: string
          counterparty?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          id?: string
          is_fixed_cost?: boolean | null
          mapped_at?: string | null
          mapped_by?: string | null
          mapping_status?: string | null
          memo?: string | null
          raw_data?: Json | null
          source?: string | null
          tax_invoice_id?: string | null
          transaction_date: string
          type: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          bank_account_id?: string | null
          card_transaction_id?: string | null
          category?: string | null
          classification?: string | null
          company_id?: string
          counterparty?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          id?: string
          is_fixed_cost?: boolean | null
          mapped_at?: string | null
          mapped_by?: string | null
          mapping_status?: string | null
          memo?: string | null
          raw_data?: Json | null
          source?: string | null
          tax_invoice_id?: string | null
          transaction_date?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_card_transaction_id_fkey"
            columns: ["card_transaction_id"]
            isOneToOne: false
            referencedRelation: "card_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_mapped_by_fkey"
            columns: ["mapped_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_tax_invoice_id_fkey"
            columns: ["tax_invoice_id"]
            isOneToOne: false
            referencedRelation: "tax_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          company_id: string
          created_at: string | null
          event_type: string
          id: string
          metadata: Json | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      card_transactions: {
        Row: {
          amount: number
          approval_number: string | null
          card_id: string | null
          category: string | null
          classification: string | null
          company_id: string
          created_at: string | null
          currency: string | null
          deal_id: string | null
          id: string
          installments: number | null
          is_deductible: boolean | null
          is_fixed_cost: boolean | null
          mapped_at: string | null
          mapped_by: string | null
          mapping_status: string | null
          memo: string | null
          merchant_category: string | null
          merchant_name: string | null
          raw_data: Json | null
          receipt_url: string | null
          source: string | null
          tax_invoice_id: string | null
          transaction_date: string
        }
        Insert: {
          amount?: number
          approval_number?: string | null
          card_id?: string | null
          category?: string | null
          classification?: string | null
          company_id: string
          created_at?: string | null
          currency?: string | null
          deal_id?: string | null
          id?: string
          installments?: number | null
          is_deductible?: boolean | null
          is_fixed_cost?: boolean | null
          mapped_at?: string | null
          mapped_by?: string | null
          mapping_status?: string | null
          memo?: string | null
          merchant_category?: string | null
          merchant_name?: string | null
          raw_data?: Json | null
          receipt_url?: string | null
          source?: string | null
          tax_invoice_id?: string | null
          transaction_date: string
        }
        Update: {
          amount?: number
          approval_number?: string | null
          card_id?: string | null
          category?: string | null
          classification?: string | null
          company_id?: string
          created_at?: string | null
          currency?: string | null
          deal_id?: string | null
          id?: string
          installments?: number | null
          is_deductible?: boolean | null
          is_fixed_cost?: boolean | null
          mapped_at?: string | null
          mapped_by?: string | null
          mapping_status?: string | null
          memo?: string | null
          merchant_category?: string | null
          merchant_name?: string | null
          raw_data?: Json | null
          receipt_url?: string | null
          source?: string | null
          tax_invoice_id?: string | null
          transaction_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_transactions_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "corporate_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_transactions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_transactions_mapped_by_fkey"
            columns: ["mapped_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_transactions_tax_invoice_id_fkey"
            columns: ["tax_invoice_id"]
            isOneToOne: false
            referencedRelation: "tax_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_snapshot: {
        Row: {
          company_id: string
          current_balance: number | null
          monthly_fixed_cost: number | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          current_balance?: number | null
          monthly_fixed_cost?: number | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          current_balance?: number | null
          monthly_fixed_cost?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_snapshot_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      certificate_logs: {
        Row: {
          certificate_number: string
          certificate_type: string
          company_id: string
          created_at: string | null
          employee_id: string
          id: string
          issued_by: string
          pdf_url: string | null
          purpose: string | null
        }
        Insert: {
          certificate_number: string
          certificate_type: string
          company_id: string
          created_at?: string | null
          employee_id: string
          id?: string
          issued_by: string
          pdf_url?: string | null
          purpose?: string | null
        }
        Update: {
          certificate_number?: string
          certificate_type?: string
          company_id?: string
          created_at?: string | null
          employee_id?: string
          id?: string
          issued_by?: string
          pdf_url?: string | null
          purpose?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificate_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_logs_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificate_logs_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_action_cards: {
        Row: {
          card_type: string
          channel_id: string
          created_at: string | null
          id: string
          message_id: string
          reference_id: string
          reference_table: string
          status: string | null
          summary_json: Json | null
        }
        Insert: {
          card_type: string
          channel_id: string
          created_at?: string | null
          id?: string
          message_id: string
          reference_id: string
          reference_table: string
          status?: string | null
          summary_json?: Json | null
        }
        Update: {
          card_type?: string
          channel_id?: string
          created_at?: string | null
          id?: string
          message_id?: string
          reference_id?: string
          reference_table?: string
          status?: string | null
          summary_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_action_cards_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_action_cards_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channels: {
        Row: {
          allow_guests: boolean | null
          company_id: string
          created_at: string | null
          deal_id: string | null
          description: string | null
          id: string
          invite_token: string | null
          is_archived: boolean | null
          is_dm: boolean | null
          name: string
          partner_id: string | null
          project_id: string | null
          sub_deal_id: string | null
          type: string | null
        }
        Insert: {
          allow_guests?: boolean | null
          company_id: string
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          id?: string
          invite_token?: string | null
          is_archived?: boolean | null
          is_dm?: boolean | null
          name: string
          partner_id?: string | null
          project_id?: string | null
          sub_deal_id?: string | null
          type?: string | null
        }
        Update: {
          allow_guests?: boolean | null
          company_id?: string
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          id?: string
          invite_token?: string | null
          is_archived?: boolean | null
          is_dm?: boolean | null
          name?: string
          partner_id?: string | null
          project_id?: string | null
          sub_deal_id?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_channels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_channels_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_channels_sub_deal_id_fkey"
            columns: ["sub_deal_id"]
            isOneToOne: false
            referencedRelation: "sub_deals"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_events: {
        Row: {
          channel_id: string
          created_at: string | null
          data_json: Json | null
          event_type: string
          id: string
        }
        Insert: {
          channel_id: string
          created_at?: string | null
          data_json?: Json | null
          event_type: string
          id?: string
        }
        Update: {
          channel_id?: string
          created_at?: string | null
          data_json?: Json | null
          event_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_events_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_files: {
        Row: {
          channel_id: string
          created_at: string | null
          file_name: string
          file_size: number | null
          file_url: string
          id: string
          message_id: string
          mime_type: string | null
        }
        Insert: {
          channel_id: string
          created_at?: string | null
          file_name: string
          file_size?: number | null
          file_url: string
          id?: string
          message_id: string
          mime_type?: string | null
        }
        Update: {
          channel_id?: string
          created_at?: string | null
          file_name?: string
          file_size?: number | null
          file_url?: string
          id?: string
          message_id?: string
          mime_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_files_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_files_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_members: {
        Row: {
          channel_id: string
          id: string
          joined_at: string | null
          role: string | null
          user_id: string
        }
        Insert: {
          channel_id: string
          id?: string
          joined_at?: string | null
          role?: string | null
          user_id: string
        }
        Update: {
          channel_id?: string
          id?: string
          joined_at?: string | null
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_mentions: {
        Row: {
          channel_id: string
          created_at: string | null
          id: string
          mentioned_user_id: string
          message_id: string
          read: boolean | null
        }
        Insert: {
          channel_id: string
          created_at?: string | null
          id?: string
          mentioned_user_id: string
          message_id: string
          read?: boolean | null
        }
        Update: {
          channel_id?: string
          created_at?: string | null
          id?: string
          mentioned_user_id?: string
          message_id?: string
          read?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_mentions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_mentions_mentioned_user_id_fkey"
            columns: ["mentioned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_mentions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          channel_id: string
          content: string
          created_at: string | null
          deleted_at: string | null
          edited_at: string | null
          id: string
          metadata: Json | null
          pinned: boolean | null
          reply_to_id: string | null
          sender_id: string
          thread_id: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          channel_id: string
          content: string
          created_at?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          metadata?: Json | null
          pinned?: boolean | null
          reply_to_id?: string | null
          sender_id: string
          thread_id?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          channel_id?: string
          content?: string
          created_at?: string | null
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          metadata?: Json | null
          pinned?: boolean | null
          reply_to_id?: string | null
          sender_id?: string
          thread_id?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_participants: {
        Row: {
          channel_id: string
          id: string
          invite_token: string | null
          invited_at: string | null
          last_read_at: string | null
          role: string | null
          user_id: string
        }
        Insert: {
          channel_id: string
          id?: string
          invite_token?: string | null
          invited_at?: string | null
          last_read_at?: string | null
          role?: string | null
          user_id: string
        }
        Update: {
          channel_id?: string
          id?: string
          invite_token?: string | null
          invited_at?: string | null
          last_read_at?: string | null
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_participants_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_reactions: {
        Row: {
          created_at: string | null
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      closing_checklist_items: {
        Row: {
          checklist_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          description: string | null
          evidence_note: string | null
          evidence_url: string | null
          id: string
          is_completed: boolean | null
          is_required: boolean | null
          sort_order: number | null
          title: string
        }
        Insert: {
          checklist_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          description?: string | null
          evidence_note?: string | null
          evidence_url?: string | null
          id?: string
          is_completed?: boolean | null
          is_required?: boolean | null
          sort_order?: number | null
          title: string
        }
        Update: {
          checklist_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          description?: string | null
          evidence_note?: string | null
          evidence_url?: string | null
          id?: string
          is_completed?: boolean | null
          is_required?: boolean | null
          sort_order?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "closing_checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "closing_checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closing_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      closing_checklists: {
        Row: {
          company_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          id: string
          locked_at: string | null
          locked_by: string | null
          month: string
          notes: string | null
          status: string | null
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          month: string
          notes?: string | null
          status?: string | null
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          month?: string
          notes?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "closing_checklists_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closing_checklists_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          business_category: string | null
          business_number: string | null
          business_type: string | null
          cert_settings: Json | null
          created_at: string | null
          current_plan: string | null
          fax: string | null
          id: string
          industry: string | null
          logo_url: string | null
          name: string
          phone: string | null
          representative: string | null
          seal_url: string | null
          stripe_customer_id: string | null
          trial_ends_at: string | null
        }
        Insert: {
          address?: string | null
          business_category?: string | null
          business_number?: string | null
          business_type?: string | null
          cert_settings?: Json | null
          created_at?: string | null
          current_plan?: string | null
          fax?: string | null
          id?: string
          industry?: string | null
          logo_url?: string | null
          name: string
          phone?: string | null
          representative?: string | null
          seal_url?: string | null
          stripe_customer_id?: string | null
          trial_ends_at?: string | null
        }
        Update: {
          address?: string | null
          business_category?: string | null
          business_number?: string | null
          business_type?: string | null
          cert_settings?: Json | null
          created_at?: string | null
          current_plan?: string | null
          fax?: string | null
          id?: string
          industry?: string | null
          logo_url?: string | null
          name?: string
          phone?: string | null
          representative?: string | null
          seal_url?: string | null
          stripe_customer_id?: string | null
          trial_ends_at?: string | null
        }
        Relationships: []
      }
      company_integrations: {
        Row: {
          cert_dn: string | null
          company_id: string
          created_at: string | null
          id: string
          last_synced_at: string | null
          login_id: string | null
          login_pw_encrypted: string | null
          metadata: Json | null
          service_name: string | null
          service_type: string
          status: string | null
          sync_error: string | null
          updated_at: string | null
        }
        Insert: {
          cert_dn?: string | null
          company_id: string
          created_at?: string | null
          id?: string
          last_synced_at?: string | null
          login_id?: string | null
          login_pw_encrypted?: string | null
          metadata?: Json | null
          service_name?: string | null
          service_type: string
          status?: string | null
          sync_error?: string | null
          updated_at?: string | null
        }
        Update: {
          cert_dn?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          last_synced_at?: string | null
          login_id?: string | null
          login_pw_encrypted?: string | null
          metadata?: Json | null
          service_name?: string | null
          service_type?: string
          status?: string | null
          sync_error?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_integrations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_archives: {
        Row: {
          amount: number | null
          auto_renewal: boolean | null
          company_id: string
          contract_type: string
          counterparty: string | null
          created_at: string | null
          created_by: string | null
          end_date: string | null
          file_urls: string[] | null
          id: string
          notes: string | null
          renewal_notice_days: number | null
          start_date: string | null
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          auto_renewal?: boolean | null
          company_id: string
          contract_type?: string
          counterparty?: string | null
          created_at?: string | null
          created_by?: string | null
          end_date?: string | null
          file_urls?: string[] | null
          id?: string
          notes?: string | null
          renewal_notice_days?: number | null
          start_date?: string | null
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          auto_renewal?: boolean | null
          company_id?: string
          contract_type?: string
          counterparty?: string | null
          created_at?: string | null
          created_by?: string | null
          end_date?: string | null
          file_urls?: string[] | null
          id?: string
          notes?: string | null
          renewal_notice_days?: number | null
          start_date?: string | null
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_archives_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_archives_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_cards: {
        Row: {
          card_company: string
          card_name: string
          card_number: string | null
          company_id: string
          created_at: string | null
          holder_name: string | null
          id: string
          is_active: boolean | null
          monthly_limit: number | null
        }
        Insert: {
          card_company?: string
          card_name: string
          card_number?: string | null
          company_id: string
          created_at?: string | null
          holder_name?: string | null
          id?: string
          is_active?: boolean | null
          monthly_limit?: number | null
        }
        Update: {
          card_company?: string
          card_name?: string
          card_number?: string | null
          company_id?: string
          created_at?: string | null
          holder_name?: string | null
          id?: string
          is_active?: boolean | null
          monthly_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "corporate_cards_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_assignments: {
        Row: {
          assigned_at: string | null
          deal_id: string
          handover_notes: string | null
          id: string
          is_active: boolean | null
          removed_at: string | null
          role: string | null
          user_id: string
        }
        Insert: {
          assigned_at?: string | null
          deal_id: string
          handover_notes?: string | null
          id?: string
          is_active?: boolean | null
          removed_at?: string | null
          role?: string | null
          user_id: string
        }
        Update: {
          assigned_at?: string | null
          deal_id?: string
          handover_notes?: string | null
          id?: string
          is_active?: boolean | null
          removed_at?: string | null
          role?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_assignments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_classifications: {
        Row: {
          color: string | null
          company_id: string
          created_at: string | null
          id: string
          is_system: boolean | null
          name: string
          sort_order: number | null
        }
        Insert: {
          color?: string | null
          company_id: string
          created_at?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          sort_order?: number | null
        }
        Update: {
          color?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_classifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_cost_schedule: {
        Row: {
          amount: number
          approved: boolean | null
          approved_at: string | null
          approved_by: string | null
          company_id: string | null
          condition_text: string | null
          created_at: string | null
          deal_node_id: string | null
          due_date: string | null
          id: string
          split_group: string | null
          status: string | null
          sub_deal_id: string | null
          vendor_id: string | null
        }
        Insert: {
          amount: number
          approved?: boolean | null
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string | null
          condition_text?: string | null
          created_at?: string | null
          deal_node_id?: string | null
          due_date?: string | null
          id?: string
          split_group?: string | null
          status?: string | null
          sub_deal_id?: string | null
          vendor_id?: string | null
        }
        Update: {
          amount?: number
          approved?: boolean | null
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string | null
          condition_text?: string | null
          created_at?: string | null
          deal_node_id?: string | null
          due_date?: string | null
          id?: string
          split_group?: string | null
          status?: string | null
          sub_deal_id?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_cost_schedule_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_cost_schedule_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_cost_schedule_deal_node_id_fkey"
            columns: ["deal_node_id"]
            isOneToOne: false
            referencedRelation: "deal_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_cost_schedule_sub_deal_id_fkey"
            columns: ["sub_deal_id"]
            isOneToOne: false
            referencedRelation: "sub_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_cost_schedule_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_files: {
        Row: {
          category: string | null
          company_id: string
          created_at: string | null
          deal_id: string
          file_name: string
          file_size: number | null
          file_type: string | null
          file_url: string | null
          id: string
          sequence_number: number | null
          uploaded_by: string | null
        }
        Insert: {
          category?: string | null
          company_id: string
          created_at?: string | null
          deal_id: string
          file_name: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          sequence_number?: number | null
          uploaded_by?: string | null
        }
        Update: {
          category?: string | null
          company_id?: string
          created_at?: string | null
          deal_id?: string
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          sequence_number?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_files_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_files_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_milestones: {
        Row: {
          completed_at: string | null
          created_at: string | null
          deal_id: string
          due_date: string
          id: string
          name: string
          sort_order: number | null
          status: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          deal_id: string
          due_date: string
          id?: string
          name: string
          sort_order?: number | null
          status?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          deal_id?: string
          due_date?: string
          id?: string
          name?: string
          sort_order?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_milestones_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_nodes: {
        Row: {
          actual_cost: number | null
          created_at: string | null
          deadline: string | null
          deal_id: string | null
          expected_cost: number | null
          id: string
          name: string
          parent_id: string | null
          revenue_amount: number | null
          status: string | null
        }
        Insert: {
          actual_cost?: number | null
          created_at?: string | null
          deadline?: string | null
          deal_id?: string | null
          expected_cost?: number | null
          id?: string
          name: string
          parent_id?: string | null
          revenue_amount?: number | null
          status?: string | null
        }
        Update: {
          actual_cost?: number | null
          created_at?: string | null
          deadline?: string | null
          deal_id?: string | null
          expected_cost?: number | null
          id?: string
          name?: string
          parent_id?: string | null
          revenue_amount?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_nodes_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "deal_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_revenue_schedule: {
        Row: {
          amount: number
          condition_text: string | null
          created_at: string | null
          deal_id: string | null
          due_date: string | null
          expected_account: string | null
          expected_sender: string | null
          id: string
          keyword_hint: string | null
          label: string | null
          received_at: string | null
          split_group: string | null
          status: string | null
          type: string | null
        }
        Insert: {
          amount: number
          condition_text?: string | null
          created_at?: string | null
          deal_id?: string | null
          due_date?: string | null
          expected_account?: string | null
          expected_sender?: string | null
          id?: string
          keyword_hint?: string | null
          label?: string | null
          received_at?: string | null
          split_group?: string | null
          status?: string | null
          type?: string | null
        }
        Update: {
          amount?: number
          condition_text?: string | null
          created_at?: string | null
          deal_id?: string | null
          due_date?: string | null
          expected_account?: string | null
          expected_sender?: string | null
          id?: string
          keyword_hint?: string | null
          label?: string | null
          received_at?: string | null
          split_group?: string | null
          status?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_revenue_schedule_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          archived_at: string | null
          bank_account_id: string | null
          classification: string | null
          company_id: string | null
          contract_total: number | null
          created_at: string | null
          deal_number: string | null
          document_sequence: number | null
          end_date: string | null
          id: string
          internal_manager_id: string | null
          is_dormant: boolean | null
          last_activity_at: string | null
          name: string
          partner_id: string | null
          priority: string | null
          risk_level: string | null
          start_date: string | null
          status: string | null
        }
        Insert: {
          archived_at?: string | null
          bank_account_id?: string | null
          classification?: string | null
          company_id?: string | null
          contract_total?: number | null
          created_at?: string | null
          deal_number?: string | null
          document_sequence?: number | null
          end_date?: string | null
          id?: string
          internal_manager_id?: string | null
          is_dormant?: boolean | null
          last_activity_at?: string | null
          name: string
          partner_id?: string | null
          priority?: string | null
          risk_level?: string | null
          start_date?: string | null
          status?: string | null
        }
        Update: {
          archived_at?: string | null
          bank_account_id?: string | null
          classification?: string | null
          company_id?: string | null
          contract_total?: number | null
          created_at?: string | null
          deal_number?: string | null
          document_sequence?: number | null
          end_date?: string | null
          id?: string
          internal_manager_id?: string | null
          is_dormant?: boolean | null
          last_activity_at?: string | null
          name?: string
          partner_id?: string | null
          priority?: string | null
          risk_level?: string | null
          start_date?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_internal_manager_id_fkey"
            columns: ["internal_manager_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_approvals: {
        Row: {
          approver_id: string
          comment: string | null
          created_at: string | null
          document_id: string
          id: string
          signed_at: string | null
          status: string | null
        }
        Insert: {
          approver_id: string
          comment?: string | null
          created_at?: string | null
          document_id: string
          id?: string
          signed_at?: string | null
          status?: string | null
        }
        Update: {
          approver_id?: string
          comment?: string | null
          created_at?: string | null
          document_id?: string
          id?: string
          signed_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "doc_approvals_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_approvals_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_revisions: {
        Row: {
          author_id: string | null
          changes_json: Json
          comment: string | null
          created_at: string | null
          document_id: string
          id: string
          version: number
        }
        Insert: {
          author_id?: string | null
          changes_json: Json
          comment?: string | null
          created_at?: string | null
          document_id: string
          id?: string
          version: number
        }
        Update: {
          author_id?: string | null
          changes_json?: Json
          comment?: string | null
          created_at?: string | null
          document_id?: string
          id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "doc_revisions_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_revisions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_templates: {
        Row: {
          category: string | null
          company_id: string
          content_json: Json
          created_at: string | null
          id: string
          is_active: boolean | null
          is_custom: boolean | null
          name: string
          type: string
          variables: Json | null
          version: number | null
        }
        Insert: {
          category?: string | null
          company_id: string
          content_json?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_custom?: boolean | null
          name: string
          type: string
          variables?: Json | null
          version?: number | null
        }
        Update: {
          category?: string | null
          company_id?: string
          content_json?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_custom?: boolean | null
          name?: string
          type?: string
          variables?: Json | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "doc_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      document_notifications: {
        Row: {
          company_id: string
          document_id: string | null
          event_type: string
          id: string
          metadata: Json | null
          recipient_email: string | null
          sent_at: string | null
        }
        Insert: {
          company_id: string
          document_id?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          recipient_email?: string | null
          sent_at?: string | null
        }
        Update: {
          company_id?: string
          document_id?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          recipient_email?: string | null
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_notifications_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      document_share_feedback: {
        Row: {
          comment: string | null
          created_at: string
          decision: string
          id: string
          responder_email: string | null
          responder_name: string | null
          share_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          decision: string
          id?: string
          responder_email?: string | null
          responder_name?: string | null
          share_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          decision?: string
          id?: string
          responder_email?: string | null
          responder_name?: string | null
          share_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_share_feedback_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "document_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      document_share_views: {
        Row: {
          id: string
          share_id: string
          viewed_at: string
          viewer_ip: string | null
          viewer_ua: string | null
        }
        Insert: {
          id?: string
          share_id: string
          viewed_at?: string
          viewer_ip?: string | null
          viewer_ua?: string | null
        }
        Update: {
          id?: string
          share_id?: string
          viewed_at?: string
          viewer_ip?: string | null
          viewer_ua?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_share_views_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "document_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      document_shares: {
        Row: {
          allow_feedback: boolean
          company_id: string
          created_at: string
          created_by: string | null
          document_id: string
          expires_at: string | null
          id: string
          is_active: boolean
          last_viewed_at: string | null
          share_token: string
          view_count: number
        }
        Insert: {
          allow_feedback?: boolean
          company_id: string
          created_at?: string
          created_by?: string | null
          document_id: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_viewed_at?: string | null
          share_token?: string
          view_count?: number
        }
        Update: {
          allow_feedback?: boolean
          company_id?: string
          created_at?: string
          created_by?: string | null
          document_id?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          last_viewed_at?: string | null
          share_token?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_shares_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_shares_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_shares_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          amount: number | null
          auto_classified_type: string | null
          company_id: string
          content_json: Json
          content_type: string | null
          contract_amount: number | null
          contract_end_date: string | null
          contract_start_date: string | null
          contract_template_type: string | null
          counterparty: string | null
          created_at: string | null
          created_by: string | null
          deal_id: string | null
          document_number: string | null
          extracted_fields: Json | null
          file_size: number | null
          file_url: string | null
          full_text: string | null
          id: string
          issued_at: string | null
          locked_at: string | null
          mime_type: string | null
          name: string
          partner_id: string | null
          seal_applied: boolean | null
          status: string | null
          template_id: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          amount?: number | null
          auto_classified_type?: string | null
          company_id: string
          content_json?: Json
          content_type?: string | null
          contract_amount?: number | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          contract_template_type?: string | null
          counterparty?: string | null
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          document_number?: string | null
          extracted_fields?: Json | null
          file_size?: number | null
          file_url?: string | null
          full_text?: string | null
          id?: string
          issued_at?: string | null
          locked_at?: string | null
          mime_type?: string | null
          name: string
          partner_id?: string | null
          seal_applied?: boolean | null
          status?: string | null
          template_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          amount?: number | null
          auto_classified_type?: string | null
          company_id?: string
          content_json?: Json
          content_type?: string | null
          contract_amount?: number | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          contract_template_type?: string | null
          counterparty?: string | null
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          document_number?: string | null
          extracted_fields?: Json | null
          file_size?: number | null
          file_url?: string | null
          full_text?: string | null
          id?: string
          issued_at?: string | null
          locked_at?: string | null
          mime_type?: string | null
          name?: string
          partner_id?: string | null
          seal_applied?: boolean | null
          status?: string | null
          template_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "doc_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_contracts: {
        Row: {
          company_id: string
          contract_type: string
          created_at: string | null
          employee_id: string
          end_date: string | null
          file_url: string | null
          id: string
          probation_end_date: string | null
          salary: number | null
          start_date: string
          status: string | null
          terms_json: Json | null
          updated_at: string | null
          work_hours_per_week: number | null
        }
        Insert: {
          company_id: string
          contract_type?: string
          created_at?: string | null
          employee_id: string
          end_date?: string | null
          file_url?: string | null
          id?: string
          probation_end_date?: string | null
          salary?: number | null
          start_date: string
          status?: string | null
          terms_json?: Json | null
          updated_at?: string | null
          work_hours_per_week?: number | null
        }
        Update: {
          company_id?: string
          contract_type?: string
          created_at?: string | null
          employee_id?: string
          end_date?: string | null
          file_url?: string | null
          id?: string
          probation_end_date?: string | null
          salary?: number | null
          start_date?: string
          status?: string | null
          terms_json?: Json | null
          updated_at?: string | null
          work_hours_per_week?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_contracts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_files: {
        Row: {
          category: string
          company_id: string
          created_at: string | null
          employee_id: string
          file_name: string
          file_size: number | null
          file_url: string
          id: string
          mime_type: string | null
          notes: string | null
          storage_path: string
          updated_at: string | null
          verified: boolean | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          category: string
          company_id: string
          created_at?: string | null
          employee_id: string
          file_name: string
          file_size?: number | null
          file_url: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          storage_path: string
          updated_at?: string | null
          verified?: boolean | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          category?: string
          company_id?: string
          created_at?: string | null
          employee_id?: string
          file_name?: string
          file_size?: number | null
          file_url?: string
          id?: string
          mime_type?: string | null
          notes?: string | null
          storage_path?: string
          updated_at?: string | null
          verified?: boolean | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_files_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_files_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_files_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_invitations: {
        Row: {
          accepted_at: string | null
          company_id: string
          created_at: string | null
          email: string
          expires_at: string | null
          id: string
          invite_token: string
          invited_by: string | null
          name: string | null
          role: string | null
          status: string | null
        }
        Insert: {
          accepted_at?: string | null
          company_id: string
          created_at?: string | null
          email: string
          expires_at?: string | null
          id?: string
          invite_token?: string
          invited_by?: string | null
          name?: string | null
          role?: string | null
          status?: string | null
        }
        Update: {
          accepted_at?: string | null
          company_id?: string
          created_at?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          invite_token?: string
          invited_by?: string | null
          name?: string | null
          role?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          account_number: string | null
          address: string | null
          bank_account: string | null
          bank_holder: string | null
          bank_name: string | null
          birth_date: string | null
          company_id: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          contract_type: string | null
          created_at: string | null
          department: string | null
          email: string | null
          emergency_contact: string | null
          emergency_phone: string | null
          employee_number: string | null
          employment_type: string | null
          hire_date: string | null
          id: string
          is_4_insurance: boolean | null
          job_grade: string | null
          job_role: string | null
          job_title: string | null
          meal_allowance_included: boolean | null
          name: string
          onboarding_completed_at: string | null
          phone: string | null
          position: string | null
          retirement_accrual: number | null
          salary: number | null
          saved_signature: Json | null
          status: string | null
          user_id: string | null
          working_hours: string | null
        }
        Insert: {
          account_number?: string | null
          address?: string | null
          bank_account?: string | null
          bank_holder?: string | null
          bank_name?: string | null
          birth_date?: string | null
          company_id?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          contract_type?: string | null
          created_at?: string | null
          department?: string | null
          email?: string | null
          emergency_contact?: string | null
          emergency_phone?: string | null
          employee_number?: string | null
          employment_type?: string | null
          hire_date?: string | null
          id?: string
          is_4_insurance?: boolean | null
          job_grade?: string | null
          job_role?: string | null
          job_title?: string | null
          meal_allowance_included?: boolean | null
          name: string
          onboarding_completed_at?: string | null
          phone?: string | null
          position?: string | null
          retirement_accrual?: number | null
          salary?: number | null
          saved_signature?: Json | null
          status?: string | null
          user_id?: string | null
          working_hours?: string | null
        }
        Update: {
          account_number?: string | null
          address?: string | null
          bank_account?: string | null
          bank_holder?: string | null
          bank_name?: string | null
          birth_date?: string | null
          company_id?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          contract_type?: string | null
          created_at?: string | null
          department?: string | null
          email?: string | null
          emergency_contact?: string | null
          emergency_phone?: string | null
          employee_number?: string | null
          employment_type?: string | null
          hire_date?: string | null
          id?: string
          is_4_insurance?: boolean | null
          job_grade?: string | null
          job_role?: string | null
          job_title?: string | null
          meal_allowance_included?: boolean | null
          name?: string
          onboarding_completed_at?: string | null
          phone?: string | null
          position?: string | null
          retirement_accrual?: number | null
          salary?: number | null
          saved_signature?: Json | null
          status?: string | null
          user_id?: string | null
          working_hours?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_approvals: {
        Row: {
          approver_id: string
          comment: string | null
          company_id: string
          created_at: string | null
          decided_at: string | null
          expense_id: string
          id: string
          level: number | null
          status: string | null
        }
        Insert: {
          approver_id: string
          comment?: string | null
          company_id: string
          created_at?: string | null
          decided_at?: string | null
          expense_id: string
          id?: string
          level?: number | null
          status?: string | null
        }
        Update: {
          approver_id?: string
          comment?: string | null
          company_id?: string
          created_at?: string | null
          decided_at?: string | null
          expense_id?: string
          id?: string
          level?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_approvals_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_approvals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_approvals_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expense_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_requests: {
        Row: {
          amount: number
          bank_transaction_id: string | null
          card_transaction_id: string | null
          category: string | null
          company_id: string
          created_at: string | null
          deal_id: string | null
          description: string | null
          employee_id: string | null
          id: string
          paid_at: string | null
          receipt_urls: string[] | null
          request_type: string | null
          requester_id: string
          status: string | null
          tax_invoice_id: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          bank_transaction_id?: string | null
          card_transaction_id?: string | null
          category?: string | null
          company_id: string
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          employee_id?: string | null
          id?: string
          paid_at?: string | null
          receipt_urls?: string[] | null
          request_type?: string | null
          requester_id: string
          status?: string | null
          tax_invoice_id?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          bank_transaction_id?: string | null
          card_transaction_id?: string | null
          category?: string | null
          company_id?: string
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          employee_id?: string | null
          id?: string
          paid_at?: string | null
          receipt_urls?: string[] | null
          request_type?: string | null
          requester_id?: string
          status?: string | null
          tax_invoice_id?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          admin_note: string | null
          category: string
          company_id: string
          created_at: string | null
          description: string | null
          id: string
          priority: number | null
          status: string | null
          title: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          category: string
          company_id: string
          created_at?: string | null
          description?: string | null
          id?: string
          priority?: number | null
          status?: string | null
          title: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          admin_note?: string | null
          category?: string
          company_id?: string
          created_at?: string | null
          description?: string | null
          id?: string
          priority?: number | null
          status?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_access_logs: {
        Row: {
          action: string
          company_id: string
          created_at: string | null
          id: string
          ip_address: string | null
          resource_id: string | null
          resource_type: string | null
          user_id: string
        }
        Insert: {
          action: string
          company_id: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_id: string
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string | null
          id?: string
          ip_address?: string | null
          resource_id?: string | null
          resource_type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "finance_access_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "finance_access_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_items: {
        Row: {
          account_type: string | null
          amount: number | null
          category: string
          company_id: string
          created_at: string | null
          deal_id: string | null
          due_date: string | null
          id: string
          month: string
          name: string
          project_name: string | null
          risk_label: string | null
          source: string | null
          status: string | null
        }
        Insert: {
          account_type?: string | null
          amount?: number | null
          category: string
          company_id: string
          created_at?: string | null
          deal_id?: string | null
          due_date?: string | null
          id?: string
          month: string
          name: string
          project_name?: string | null
          risk_label?: string | null
          source?: string | null
          status?: string | null
        }
        Update: {
          account_type?: string | null
          amount?: number | null
          category?: string
          company_id?: string
          created_at?: string | null
          deal_id?: string | null
          due_date?: string | null
          id?: string
          month?: string
          name?: string
          project_name?: string | null
          risk_label?: string | null
          source?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      growth_targets: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          period: string
          target_profit: number | null
          target_revenue: number | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          id?: string
          period: string
          target_profit?: number | null
          target_revenue?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          period?: string
          target_profit?: number | null
          target_revenue?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "growth_targets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      hometax_sync_log: {
        Row: {
          company_id: string
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          invoices_created: number | null
          invoices_fetched: number | null
          invoices_updated: number | null
          request_payload: Json | null
          response_payload: Json | null
          started_at: string | null
          status: string
          sync_type: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          invoices_created?: number | null
          invoices_fetched?: number | null
          invoices_updated?: number | null
          request_payload?: Json | null
          response_payload?: Json | null
          started_at?: string | null
          status?: string
          sync_type: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          invoices_created?: number | null
          invoices_fetched?: number | null
          invoices_updated?: number | null
          request_payload?: Json | null
          response_payload?: Json | null
          started_at?: string | null
          status?: string
          sync_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "hometax_sync_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_contract_package_items: {
        Row: {
          created_at: string | null
          document_id: string | null
          id: string
          package_id: string
          signature_data: Json | null
          signed_at: string | null
          sort_order: number | null
          status: string
          template_id: string | null
          title: string
        }
        Insert: {
          created_at?: string | null
          document_id?: string | null
          id?: string
          package_id: string
          signature_data?: Json | null
          signed_at?: string | null
          sort_order?: number | null
          status?: string
          template_id?: string | null
          title: string
        }
        Update: {
          created_at?: string | null
          document_id?: string | null
          id?: string
          package_id?: string
          signature_data?: Json | null
          signed_at?: string | null
          sort_order?: number | null
          status?: string
          template_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_contract_package_items_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_contract_package_items_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "hr_contract_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_contract_package_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "doc_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_contract_packages: {
        Row: {
          company_id: string
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          employee_id: string
          expires_at: string | null
          id: string
          notes: string | null
          sent_at: string | null
          sign_token: string | null
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          employee_id: string
          expires_at?: string | null
          id?: string
          notes?: string | null
          sent_at?: string | null
          sign_token?: string | null
          status?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          employee_id?: string
          expires_at?: string | null
          id?: string
          notes?: string | null
          sent_at?: string | null
          sign_token?: string | null
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_contract_packages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_contract_packages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_contract_packages_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          billing_period_end: string | null
          billing_period_start: string | null
          company_id: string
          created_at: string | null
          currency: string | null
          description: string | null
          id: string
          invoice_number: string | null
          paid_at: string | null
          status: string | null
          stripe_invoice_id: string | null
          stripe_invoice_url: string | null
          subscription_id: string | null
          tax_amount: number
          toss_order_id: string | null
          toss_payment_key: string | null
          total_amount: number
        }
        Insert: {
          amount: number
          billing_period_end?: string | null
          billing_period_start?: string | null
          company_id: string
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          invoice_number?: string | null
          paid_at?: string | null
          status?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_url?: string | null
          subscription_id?: string | null
          tax_amount?: number
          toss_order_id?: string | null
          toss_payment_key?: string | null
          total_amount: number
        }
        Update: {
          amount?: number
          billing_period_end?: string | null
          billing_period_start?: string | null
          company_id?: string
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          invoice_number?: string | null
          paid_at?: string | null
          status?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_url?: string | null
          subscription_id?: string | null
          tax_amount?: number
          toss_order_id?: string | null
          toss_payment_key?: string | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_balances: {
        Row: {
          company_id: string
          employee_id: string
          id: string
          remaining_days: number | null
          total_days: number | null
          used_days: number | null
          year: number
        }
        Insert: {
          company_id: string
          employee_id: string
          id?: string
          remaining_days?: number | null
          total_days?: number | null
          used_days?: number | null
          year: number
        }
        Update: {
          company_id?: string
          employee_id?: string
          id?: string
          remaining_days?: number | null
          total_days?: number | null
          used_days?: number | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_balances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_balances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_promotion_notices: {
        Row: {
          company_id: string
          created_at: string | null
          deadline: string | null
          email_to: string | null
          employee_id: string
          employee_response: string | null
          id: string
          notice_type: string
          responded_at: string | null
          sent_at: string | null
          sent_via: string | null
          unused_days: number
          year: number
        }
        Insert: {
          company_id: string
          created_at?: string | null
          deadline?: string | null
          email_to?: string | null
          employee_id: string
          employee_response?: string | null
          id?: string
          notice_type: string
          responded_at?: string | null
          sent_at?: string | null
          sent_via?: string | null
          unused_days: number
          year: number
        }
        Update: {
          company_id?: string
          created_at?: string | null
          deadline?: string | null
          email_to?: string | null
          employee_id?: string
          employee_response?: string | null
          id?: string
          notice_type?: string
          responded_at?: string | null
          sent_at?: string | null
          sent_via?: string | null
          unused_days?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_promotion_notices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_promotion_notices_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          company_id: string
          created_at: string | null
          days: number
          employee_id: string
          end_date: string
          end_time: string | null
          id: string
          leave_type: string
          leave_unit: string | null
          reason: string | null
          start_date: string
          start_time: string | null
          status: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          created_at?: string | null
          days: number
          employee_id: string
          end_date: string
          end_time?: string | null
          id?: string
          leave_type: string
          leave_unit?: string | null
          reason?: string | null
          start_date: string
          start_time?: string | null
          status?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string | null
          days?: number
          employee_id?: string
          end_date?: string
          end_time?: string | null
          id?: string
          leave_type?: string
          leave_unit?: string | null
          reason?: string | null
          start_date?: string
          start_time?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_payments: {
        Row: {
          bank_transaction_id: string | null
          created_at: string | null
          id: string
          interest_amount: number | null
          loan_id: string
          notes: string | null
          payment_date: string
          payment_number: number | null
          principal_amount: number | null
          total_amount: number
        }
        Insert: {
          bank_transaction_id?: string | null
          created_at?: string | null
          id?: string
          interest_amount?: number | null
          loan_id: string
          notes?: string | null
          payment_date: string
          payment_number?: number | null
          principal_amount?: number | null
          total_amount: number
        }
        Update: {
          bank_transaction_id?: string | null
          created_at?: string | null
          id?: string
          interest_amount?: number | null
          loan_id?: string
          notes?: string | null
          payment_date?: string
          payment_number?: number | null
          principal_amount?: number | null
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "loan_payments_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_payments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          bank_account_id: string | null
          company_id: string
          created_at: string | null
          id: string
          interest_day: number | null
          interest_rate: number | null
          lender: string
          loan_type: string | null
          maturity_date: string | null
          name: string
          notes: string | null
          original_amount: number
          payment_day: number | null
          remaining_balance: number
          start_date: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          bank_account_id?: string | null
          company_id: string
          created_at?: string | null
          id?: string
          interest_day?: number | null
          interest_rate?: number | null
          lender: string
          loan_type?: string | null
          maturity_date?: string | null
          name: string
          notes?: string | null
          original_amount?: number
          payment_day?: number | null
          remaining_balance?: number
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          bank_account_id?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          interest_day?: number | null
          interest_rate?: number | null
          lender?: string
          loan_type?: string | null
          maturity_date?: string | null
          name?: string
          notes?: string | null
          original_amount?: number
          payment_day?: number | null
          remaining_balance?: number
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loans_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_financials: {
        Row: {
          bank_balance: number | null
          company_id: string
          created_at: string | null
          fixed_cost: number | null
          id: string
          month: string
          net_cashflow: number | null
          revenue: number | null
          source: string | null
          total_expense: number | null
          total_income: number | null
          updated_at: string | null
          variable_cost: number | null
        }
        Insert: {
          bank_balance?: number | null
          company_id: string
          created_at?: string | null
          fixed_cost?: number | null
          id?: string
          month: string
          net_cashflow?: number | null
          revenue?: number | null
          source?: string | null
          total_expense?: number | null
          total_income?: number | null
          updated_at?: string | null
          variable_cost?: number | null
        }
        Update: {
          bank_balance?: number | null
          company_id?: string
          created_at?: string | null
          fixed_cost?: number | null
          id?: string
          month?: string
          net_cashflow?: number | null
          revenue?: number | null
          source?: string | null
          total_expense?: number | null
          total_income?: number | null
          updated_at?: string | null
          variable_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_financials_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          company_id: string
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_read: boolean | null
          link: string | null
          message: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_checklist_items: {
        Row: {
          company_id: string
          completed: boolean | null
          completed_at: string | null
          employee_id: string
          id: string
          item_key: string
          label: string
        }
        Insert: {
          company_id: string
          completed?: boolean | null
          completed_at?: string | null
          employee_id: string
          id?: string
          item_key: string
          label: string
        }
        Update: {
          company_id?: string
          completed?: boolean | null
          completed_at?: string | null
          employee_id?: string
          id?: string
          item_key?: string
          label?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_checklist_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_checklist_items_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_invitations: {
        Row: {
          accepted_at: string | null
          company_id: string
          created_at: string | null
          deal_id: string | null
          email: string
          expires_at: string | null
          id: string
          invite_token: string
          name: string | null
          role: string | null
          status: string | null
        }
        Insert: {
          accepted_at?: string | null
          company_id: string
          created_at?: string | null
          deal_id?: string | null
          email: string
          expires_at?: string | null
          id?: string
          invite_token?: string
          name?: string | null
          role?: string | null
          status?: string | null
        }
        Update: {
          accepted_at?: string | null
          company_id?: string
          created_at?: string | null
          deal_id?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          invite_token?: string
          name?: string | null
          role?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_invitations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          account_number: string | null
          address: string | null
          bank_name: string | null
          business_number: string | null
          classification: string | null
          company_id: string
          company_name: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          default_expense_category: string | null
          id: string
          is_active: boolean | null
          name: string
          notes: string | null
          preferred_invoice_day: number | null
          representative: string | null
          source_deal_id: string | null
          tags: string[] | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          account_number?: string | null
          address?: string | null
          bank_name?: string | null
          business_number?: string | null
          classification?: string | null
          company_id: string
          company_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          default_expense_category?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          notes?: string | null
          preferred_invoice_day?: number | null
          representative?: string | null
          source_deal_id?: string | null
          tags?: string[] | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          account_number?: string | null
          address?: string | null
          bank_name?: string | null
          business_number?: string | null
          classification?: string | null
          company_id?: string
          company_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          default_expense_category?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          notes?: string | null
          preferred_invoice_day?: number | null
          representative?: string | null
          source_deal_id?: string | null
          tags?: string[] | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partners_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partners_source_deal_id_fkey"
            columns: ["source_deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      partnership_inquiries: {
        Row: {
          company_name: string
          contact_name: string
          created_at: string | null
          email: string
          id: string
          message: string
          phone: string | null
          status: string | null
        }
        Insert: {
          company_name: string
          contact_name: string
          created_at?: string | null
          email: string
          id?: string
          message: string
          phone?: string | null
          status?: string | null
        }
        Update: {
          company_name?: string
          contact_name?: string
          created_at?: string | null
          email?: string
          id?: string
          message?: string
          phone?: string | null
          status?: string | null
        }
        Relationships: []
      }
      payment_batches: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          batch_type: string
          company_id: string
          created_at: string | null
          executed_at: string | null
          id: string
          item_count: number | null
          n8n_execution_id: string | null
          name: string
          status: string | null
          total_amount: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          batch_type?: string
          company_id: string
          created_at?: string | null
          executed_at?: string | null
          id?: string
          item_count?: number | null
          n8n_execution_id?: string | null
          name: string
          status?: string | null
          total_amount?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          batch_type?: string
          company_id?: string
          created_at?: string | null
          executed_at?: string | null
          id?: string
          item_count?: number | null
          n8n_execution_id?: string | null
          name?: string
          status?: string | null
          total_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_batches_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_queue: {
        Row: {
          amount: number
          approval_request_id: string | null
          approved_at: string | null
          approved_by: string | null
          attachments: string[] | null
          bank_account_id: string | null
          batch_id: string | null
          category: string | null
          comment: string | null
          company_id: string
          cost_schedule_id: string | null
          created_at: string | null
          deal_id: string | null
          description: string | null
          executed_at: string | null
          id: string
          is_recurring: boolean | null
          n8n_execution_id: string | null
          payment_type: string | null
          recipient_account: string | null
          recipient_bank: string | null
          recipient_name: string | null
          recurring_rule_id: string | null
          status: string | null
          transfer_ref: string | null
        }
        Insert: {
          amount: number
          approval_request_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachments?: string[] | null
          bank_account_id?: string | null
          batch_id?: string | null
          category?: string | null
          comment?: string | null
          company_id: string
          cost_schedule_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          executed_at?: string | null
          id?: string
          is_recurring?: boolean | null
          n8n_execution_id?: string | null
          payment_type?: string | null
          recipient_account?: string | null
          recipient_bank?: string | null
          recipient_name?: string | null
          recurring_rule_id?: string | null
          status?: string | null
          transfer_ref?: string | null
        }
        Update: {
          amount?: number
          approval_request_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachments?: string[] | null
          bank_account_id?: string | null
          batch_id?: string | null
          category?: string | null
          comment?: string | null
          company_id?: string
          cost_schedule_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          executed_at?: string | null
          id?: string
          is_recurring?: boolean | null
          n8n_execution_id?: string | null
          payment_type?: string | null
          recipient_account?: string | null
          recipient_bank?: string | null
          recipient_name?: string | null
          recurring_rule_id?: string | null
          status?: string | null
          transfer_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_queue_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_queue_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_queue_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_queue_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "payment_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_queue_cost_schedule_id_fkey"
            columns: ["cost_schedule_id"]
            isOneToOne: false
            referencedRelation: "deal_cost_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_queue_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_items: {
        Row: {
          bank_account: string | null
          bank_name: string | null
          base_salary: number
          batch_id: string
          created_at: string | null
          deductions_total: number | null
          employee_id: string
          employment_insurance: number | null
          health_insurance: number | null
          id: string
          income_tax: number | null
          local_income_tax: number | null
          national_pension: number | null
          net_pay: number
          status: string | null
        }
        Insert: {
          bank_account?: string | null
          bank_name?: string | null
          base_salary?: number
          batch_id: string
          created_at?: string | null
          deductions_total?: number | null
          employee_id: string
          employment_insurance?: number | null
          health_insurance?: number | null
          id?: string
          income_tax?: number | null
          local_income_tax?: number | null
          national_pension?: number | null
          net_pay?: number
          status?: string | null
        }
        Update: {
          bank_account?: string | null
          bank_name?: string | null
          base_salary?: number
          batch_id?: string
          created_at?: string | null
          deductions_total?: number | null
          employee_id?: string
          employment_insurance?: number | null
          health_insurance?: number | null
          id?: string
          income_tax?: number | null
          local_income_tax?: number | null
          national_pension?: number | null
          net_pay?: number
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "payment_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_items_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_tracking: {
        Row: {
          company_id: string
          created_at: string | null
          created_by: string | null
          currency: string | null
          document_id: string | null
          id: string
          last_viewed_at: string | null
          note: string | null
          quote_title: string
          recipient_company: string | null
          recipient_email: string
          recipient_name: string
          responded_at: string | null
          response_note: string | null
          sent_at: string
          status: string
          total_amount: number | null
          tracking_token: string
          updated_at: string | null
          valid_until: string | null
          view_count: number | null
          viewed_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          document_id?: string | null
          id?: string
          last_viewed_at?: string | null
          note?: string | null
          quote_title: string
          recipient_company?: string | null
          recipient_email: string
          recipient_name: string
          responded_at?: string | null
          response_note?: string | null
          sent_at?: string
          status?: string
          total_amount?: number | null
          tracking_token: string
          updated_at?: string | null
          valid_until?: string | null
          view_count?: number | null
          viewed_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          document_id?: string | null
          id?: string
          last_viewed_at?: string | null
          note?: string | null
          quote_title?: string
          recipient_company?: string | null
          recipient_email?: string
          recipient_name?: string
          responded_at?: string | null
          response_note?: string | null
          sent_at?: string
          status?: string
          total_amount?: number | null
          tracking_token?: string
          updated_at?: string | null
          valid_until?: string | null
          view_count?: number | null
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_tracking_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_tracking_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_payments: {
        Row: {
          amount: number
          auto_transfer_account_id: string | null
          auto_transfer_date: number | null
          auto_transfer_memo: string | null
          bank_account_id: string | null
          category: string
          company_id: string
          created_at: string | null
          day_of_month: number | null
          frequency: string | null
          id: string
          is_active: boolean | null
          last_generated_at: string | null
          name: string
          next_due_date: string | null
          recipient_account: string | null
          recipient_bank: string | null
          recipient_name: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          auto_transfer_account_id?: string | null
          auto_transfer_date?: number | null
          auto_transfer_memo?: string | null
          bank_account_id?: string | null
          category?: string
          company_id: string
          created_at?: string | null
          day_of_month?: number | null
          frequency?: string | null
          id?: string
          is_active?: boolean | null
          last_generated_at?: string | null
          name: string
          next_due_date?: string | null
          recipient_account?: string | null
          recipient_bank?: string | null
          recipient_name?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          auto_transfer_account_id?: string | null
          auto_transfer_date?: number | null
          auto_transfer_memo?: string | null
          bank_account_id?: string | null
          category?: string
          company_id?: string
          created_at?: string | null
          day_of_month?: number | null
          frequency?: string | null
          id?: string
          is_active?: boolean | null
          last_generated_at?: string | null
          name?: string
          next_due_date?: string | null
          recipient_account?: string | null
          recipient_bank?: string | null
          recipient_name?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      referral_codes: {
        Row: {
          code: string
          company_id: string
          created_at: string | null
          credit_earned: number | null
          id: string
          is_active: boolean | null
          referred_count: number | null
        }
        Insert: {
          code: string
          company_id: string
          created_at?: string | null
          credit_earned?: number | null
          id?: string
          is_active?: boolean | null
          referred_count?: number | null
        }
        Update: {
          code?: string
          company_id?: string
          created_at?: string | null
          credit_earned?: number | null
          id?: string
          is_active?: boolean | null
          referred_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      routing_rules: {
        Row: {
          bank_account_id: string
          company_id: string
          cost_type: string
          created_at: string | null
          id: string
          priority: number | null
        }
        Insert: {
          bank_account_id: string
          company_id: string
          cost_type: string
          created_at?: string | null
          id?: string
          priority?: number | null
        }
        Update: {
          bank_account_id?: string
          company_id?: string
          cost_type?: string
          created_at?: string | null
          id?: string
          priority?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "routing_rules_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_history: {
        Row: {
          approved_by: string | null
          change_reason: string | null
          company_id: string
          created_at: string | null
          effective_date: string
          employee_id: string
          id: string
          previous_salary: number | null
          salary: number
        }
        Insert: {
          approved_by?: string | null
          change_reason?: string | null
          company_id: string
          created_at?: string | null
          effective_date: string
          employee_id: string
          id?: string
          previous_salary?: number | null
          salary: number
        }
        Update: {
          approved_by?: string | null
          change_reason?: string | null
          company_id?: string
          created_at?: string | null
          effective_date?: string
          employee_id?: string
          id?: string
          previous_salary?: number | null
          salary?: number
        }
        Relationships: [
          {
            foreignKeyName: "salary_history_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_history_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "salary_history_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_requests: {
        Row: {
          company_id: string
          created_at: string | null
          created_by: string | null
          document_id: string
          expires_at: string | null
          id: string
          ip_address: string | null
          sent_at: string | null
          signature_data: Json | null
          signed_at: string | null
          signer_email: string
          signer_name: string
          signer_phone: string | null
          status: string | null
          title: string
          viewed_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          created_by?: string | null
          document_id: string
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          sent_at?: string | null
          signature_data?: Json | null
          signed_at?: string | null
          signer_email: string
          signer_name: string
          signer_phone?: string | null
          status?: string | null
          title: string
          viewed_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          document_id?: string
          expires_at?: string | null
          id?: string
          ip_address?: string | null
          sent_at?: string | null
          signature_data?: Json | null
          signed_at?: string | null
          signer_email?: string
          signer_name?: string
          signer_phone?: string | null
          status?: string | null
          title?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signature_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_requests_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_requests_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_deals: {
        Row: {
          bank_account_id: string | null
          contract_amount: number | null
          created_at: string | null
          end_date: string | null
          id: string
          name: string
          parent_deal_id: string
          partner_id: string | null
          start_date: string | null
          status: string | null
          type: string | null
          vendor_id: string | null
        }
        Insert: {
          bank_account_id?: string | null
          contract_amount?: number | null
          created_at?: string | null
          end_date?: string | null
          id?: string
          name: string
          parent_deal_id: string
          partner_id?: string | null
          start_date?: string | null
          status?: string | null
          type?: string | null
          vendor_id?: string | null
        }
        Update: {
          bank_account_id?: string | null
          contract_amount?: number | null
          created_at?: string | null
          end_date?: string | null
          id?: string
          name?: string
          parent_deal_id?: string
          partner_id?: string | null
          start_date?: string | null
          status?: string | null
          type?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sub_deals_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_deals_parent_deal_id_fkey"
            columns: ["parent_deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_deals_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_deals_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          annual_discount: number | null
          base_price: number
          created_at: string | null
          features: Json | null
          id: string
          is_active: boolean | null
          max_employees: number | null
          max_seats: number | null
          name: string
          per_seat_price: number
          semiannual_discount: number | null
          slug: string
          sort_order: number | null
          stripe_price_annual: string | null
          stripe_price_monthly: string | null
          stripe_price_semiannual: string | null
          stripe_product_id: string | null
        }
        Insert: {
          annual_discount?: number | null
          base_price?: number
          created_at?: string | null
          features?: Json | null
          id?: string
          is_active?: boolean | null
          max_employees?: number | null
          max_seats?: number | null
          name: string
          per_seat_price?: number
          semiannual_discount?: number | null
          slug: string
          sort_order?: number | null
          stripe_price_annual?: string | null
          stripe_price_monthly?: string | null
          stripe_price_semiannual?: string | null
          stripe_product_id?: string | null
        }
        Update: {
          annual_discount?: number | null
          base_price?: number
          created_at?: string | null
          features?: Json | null
          id?: string
          is_active?: boolean | null
          max_employees?: number | null
          max_seats?: number | null
          name?: string
          per_seat_price?: number
          semiannual_discount?: number | null
          slug?: string
          sort_order?: number | null
          stripe_price_annual?: string | null
          stripe_price_monthly?: string | null
          stripe_price_semiannual?: string | null
          stripe_product_id?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          billing_cycle: string | null
          cancel_at_period_end: boolean | null
          cancel_reason: string | null
          cancel_requested_at: string | null
          canceled_at: string | null
          company_id: string
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan_id: string
          plan_slug: string | null
          seat_count: number
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          toss_billing_key: string | null
          toss_customer_key: string | null
          trial_ends_at: string | null
          updated_at: string | null
        }
        Insert: {
          billing_cycle?: string | null
          cancel_at_period_end?: boolean | null
          cancel_reason?: string | null
          cancel_requested_at?: string | null
          canceled_at?: string | null
          company_id: string
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id: string
          plan_slug?: string | null
          seat_count?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          toss_billing_key?: string | null
          toss_customer_key?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Update: {
          billing_cycle?: string | null
          cancel_at_period_end?: boolean | null
          cancel_reason?: string | null
          cancel_requested_at?: string | null
          canceled_at?: string | null
          company_id?: string
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id?: string
          plan_slug?: string | null
          seat_count?: number
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          toss_billing_key?: string | null
          toss_customer_key?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_jobs: {
        Row: {
          company_id: string
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          requested_by: string | null
          result: Json | null
          started_at: string | null
          status: string
          targets: string[] | null
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          targets?: string[] | null
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          requested_by?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          targets?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_invoice_queue: {
        Row: {
          action: string
          approved_at: string | null
          approved_by: string | null
          company_id: string
          created_at: string | null
          deal_id: string | null
          error_message: string | null
          id: string
          payload: Json
          processed_at: string | null
          revenue_schedule_id: string | null
          status: string
        }
        Insert: {
          action: string
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          created_at?: string | null
          deal_id?: string | null
          error_message?: string | null
          id?: string
          payload: Json
          processed_at?: string | null
          revenue_schedule_id?: string | null
          status?: string
        }
        Update: {
          action?: string
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string | null
          deal_id?: string | null
          error_message?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          revenue_schedule_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_invoice_queue_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_invoice_queue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_invoice_queue_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_invoice_queue_revenue_schedule_id_fkey"
            columns: ["revenue_schedule_id"]
            isOneToOne: false
            referencedRelation: "deal_revenue_schedule"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_invoices: {
        Row: {
          auto_issued: boolean | null
          company_id: string
          counterparty_bizno: string | null
          counterparty_name: string
          created_at: string | null
          deal_id: string | null
          expense_category: string | null
          hometax_synced_at: string | null
          id: string
          issue_date: string
          label: string | null
          modification_date: string | null
          modification_reason: string | null
          nts_confirm_no: string | null
          original_invoice_id: string | null
          partner_id: string | null
          preferred_date: string | null
          revenue_schedule_id: string | null
          source: string | null
          status: string | null
          supply_amount: number
          tax_amount: number
          total_amount: number
          type: string
          updated_at: string | null
        }
        Insert: {
          auto_issued?: boolean | null
          company_id: string
          counterparty_bizno?: string | null
          counterparty_name: string
          created_at?: string | null
          deal_id?: string | null
          expense_category?: string | null
          hometax_synced_at?: string | null
          id?: string
          issue_date: string
          label?: string | null
          modification_date?: string | null
          modification_reason?: string | null
          nts_confirm_no?: string | null
          original_invoice_id?: string | null
          partner_id?: string | null
          preferred_date?: string | null
          revenue_schedule_id?: string | null
          source?: string | null
          status?: string | null
          supply_amount: number
          tax_amount: number
          total_amount: number
          type: string
          updated_at?: string | null
        }
        Update: {
          auto_issued?: boolean | null
          company_id?: string
          counterparty_bizno?: string | null
          counterparty_name?: string
          created_at?: string | null
          deal_id?: string | null
          expense_category?: string | null
          hometax_synced_at?: string | null
          id?: string
          issue_date?: string
          label?: string | null
          modification_date?: string | null
          modification_reason?: string | null
          nts_confirm_no?: string | null
          original_invoice_id?: string | null
          partner_id?: string | null
          preferred_date?: string | null
          revenue_schedule_id?: string | null
          source?: string | null
          status?: string | null
          supply_amount?: number
          tax_amount?: number
          total_amount?: number
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tax_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_invoices_original_invoice_id_fkey"
            columns: ["original_invoice_id"]
            isOneToOne: false
            referencedRelation: "tax_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_invoices_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_invoices_revenue_schedule_id_fkey"
            columns: ["revenue_schedule_id"]
            isOneToOne: false
            referencedRelation: "deal_revenue_schedule"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_matches: {
        Row: {
          cost_schedule_id: string | null
          created_at: string | null
          id: string
          match_score: number | null
          revenue_schedule_id: string | null
          status: string | null
          transaction_id: string | null
        }
        Insert: {
          cost_schedule_id?: string | null
          created_at?: string | null
          id?: string
          match_score?: number | null
          revenue_schedule_id?: string | null
          status?: string | null
          transaction_id?: string | null
        }
        Update: {
          cost_schedule_id?: string | null
          created_at?: string | null
          id?: string
          match_score?: number | null
          revenue_schedule_id?: string | null
          status?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transaction_matches_cost_schedule_id_fkey"
            columns: ["cost_schedule_id"]
            isOneToOne: false
            referencedRelation: "deal_cost_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_matches_revenue_schedule_id_fkey"
            columns: ["revenue_schedule_id"]
            isOneToOne: false
            referencedRelation: "deal_revenue_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_matches_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number | null
          company_id: string | null
          counterparty: string | null
          created_at: string | null
          description: string | null
          id: string
          matched: boolean | null
          raw_data: Json | null
          transaction_date: string | null
          type: string | null
        }
        Insert: {
          amount?: number | null
          company_id?: string | null
          counterparty?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          matched?: boolean | null
          raw_data?: Json | null
          transaction_date?: string | null
          type?: string | null
        }
        Update: {
          amount?: number | null
          company_id?: string | null
          counterparty?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          matched?: boolean | null
          raw_data?: Json | null
          transaction_date?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_positions: {
        Row: {
          asset_type: string
          avg_price: number | null
          company_id: string
          created_at: string | null
          currency: string | null
          current_price: number | null
          id: string
          name: string
          quantity: number | null
          ticker: string | null
        }
        Insert: {
          asset_type: string
          avg_price?: number | null
          company_id: string
          created_at?: string | null
          currency?: string | null
          current_price?: number | null
          id?: string
          name: string
          quantity?: number | null
          ticker?: string | null
        }
        Update: {
          asset_type?: string
          avg_price?: number | null
          company_id?: string
          created_at?: string | null
          currency?: string | null
          current_price?: number | null
          id?: string
          name?: string
          quantity?: number | null
          ticker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "treasury_positions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      treasury_transactions: {
        Row: {
          amount: number
          created_at: string | null
          date: string
          id: string
          position_id: string
          price: number | null
          quantity: number | null
          type: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          date: string
          id?: string
          position_id: string
          price?: number | null
          quantity?: number | null
          type: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          date?: string
          id?: string
          position_id?: string
          price?: number | null
          quantity?: number | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "treasury_transactions_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "treasury_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_id: string | null
          avatar_url: string | null
          company_id: string | null
          created_at: string | null
          email: string
          id: string
          name: string | null
          role: string | null
        }
        Insert: {
          auth_id?: string | null
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string | null
          email: string
          id?: string
          name?: string | null
          role?: string | null
        }
        Update: {
          auth_id?: string | null
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_accounts: {
        Row: {
          billing_day: number | null
          company_id: string
          created_at: string | null
          encrypted_password: string | null
          id: string
          login_id: string | null
          login_password: string | null
          monthly_cost: number | null
          notes: string | null
          owner_id: string | null
          payment_method: string | null
          renewal_date: string | null
          service_name: string
          source: string | null
          status: string | null
          url: string | null
        }
        Insert: {
          billing_day?: number | null
          company_id: string
          created_at?: string | null
          encrypted_password?: string | null
          id?: string
          login_id?: string | null
          login_password?: string | null
          monthly_cost?: number | null
          notes?: string | null
          owner_id?: string | null
          payment_method?: string | null
          renewal_date?: string | null
          service_name: string
          source?: string | null
          status?: string | null
          url?: string | null
        }
        Update: {
          billing_day?: number | null
          company_id?: string
          created_at?: string | null
          encrypted_password?: string | null
          id?: string
          login_id?: string | null
          login_password?: string | null
          monthly_cost?: number | null
          notes?: string | null
          owner_id?: string | null
          payment_method?: string | null
          renewal_date?: string | null
          service_name?: string
          source?: string | null
          status?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_assets: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          location: string | null
          name: string
          notes: string | null
          purchase_date: string | null
          status: string | null
          type: string
          value: number | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          id?: string
          location?: string | null
          name: string
          notes?: string | null
          purchase_date?: string | null
          status?: string | null
          type: string
          value?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          location?: string | null
          name?: string
          notes?: string | null
          purchase_date?: string | null
          status?: string | null
          type?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_assets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_docs: {
        Row: {
          category: string
          company_id: string
          created_at: string | null
          expiry_date: string | null
          file_url: string | null
          id: string
          linked_deal_id: string | null
          name: string
          tags: string[] | null
        }
        Insert: {
          category: string
          company_id: string
          created_at?: string | null
          expiry_date?: string | null
          file_url?: string | null
          id?: string
          linked_deal_id?: string | null
          name: string
          tags?: string[] | null
        }
        Update: {
          category?: string
          company_id?: string
          created_at?: string | null
          expiry_date?: string | null
          file_url?: string | null
          id?: string
          linked_deal_id?: string | null
          name?: string
          tags?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_docs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_docs_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          account_number: string | null
          bank_name: string | null
          company_id: string | null
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          account_number?: string | null
          bank_name?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          account_number?: string | null
          bank_name?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendors_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      card_deduction_summary: {
        Row: {
          company_id: string | null
          deductible_amount: number | null
          estimated_vat_deduction: number | null
          month: string | null
          non_deductible_amount: number | null
          total_amount: number | null
          tx_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "card_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_invoice_monthly_summary: {
        Row: {
          company_id: string | null
          invoice_count: number | null
          month: string | null
          total_amount: number | null
          total_supply: number | null
          total_tax: number | null
          type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tax_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      fn_process_invoice_queue: { Args: never; Returns: number }
      get_company_plan_slug: { Args: never; Returns: string }
      get_my_company_id: { Args: never; Returns: string }
      has_min_plan: { Args: { min_plan: string }; Returns: boolean }
      increment_share_view_count: {
        Args: { share_id_param: string }
        Returns: undefined
      }
      is_company_owner: { Args: never; Returns: boolean }
      mark_dormant_deals: { Args: never; Returns: number }
      plan_rank: { Args: { slug: string }; Returns: number }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const

