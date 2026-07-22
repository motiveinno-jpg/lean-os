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
      accounting_closing: {
        Row: {
          closing_date: string | null
          company_id: string
          note: string | null
          opening_lines: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          closing_date?: string | null
          company_id: string
          note?: string | null
          opening_lines?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          closing_date?: string | null
          company_id?: string
          note?: string | null
          opening_lines?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounting_closing_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_closing_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_briefings: {
        Row: {
          brief_date: string
          company_id: string
          content: string
          created_at: string
          id: string
        }
        Insert: {
          brief_date: string
          company_id: string
          content: string
          created_at?: string
          id?: string
        }
        Update: {
          brief_date?: string
          company_id?: string
          content?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_briefings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
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
      allowance_entries: {
        Row: {
          allowance_type_id: string
          amount: number
          calculated_minutes: number | null
          company_id: string
          count: number | null
          created_at: string
          edited_at: string | null
          edited_by: string | null
          employee_id: string
          id: string
          note: string | null
          payroll_month: string
          source: string
          updated_at: string
        }
        Insert: {
          allowance_type_id: string
          amount?: number
          calculated_minutes?: number | null
          company_id: string
          count?: number | null
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          employee_id: string
          id?: string
          note?: string | null
          payroll_month: string
          source?: string
          updated_at?: string
        }
        Update: {
          allowance_type_id?: string
          amount?: number
          calculated_minutes?: number | null
          company_id?: string
          count?: number | null
          created_at?: string
          edited_at?: string | null
          edited_by?: string | null
          employee_id?: string
          id?: string
          note?: string | null
          payroll_month?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "allowance_entries_allowance_type_id_fkey"
            columns: ["allowance_type_id"]
            isOneToOne: false
            referencedRelation: "allowance_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allowance_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allowance_entries_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allowance_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      allowance_types: {
        Row: {
          applies_to: string
          base_field: string | null
          calc_mode: string
          code: string
          company_id: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          is_legal_mandatory: boolean
          name: string
          rate_amount: number
          rate_type: string
          target_employee_ids: string[]
          updated_at: string
        }
        Insert: {
          applies_to?: string
          base_field?: string | null
          calc_mode: string
          code: string
          company_id: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_legal_mandatory?: boolean
          name: string
          rate_amount?: number
          rate_type: string
          target_employee_ids?: string[]
          updated_at?: string
        }
        Update: {
          applies_to?: string
          base_field?: string | null
          calc_mode?: string
          code?: string
          company_id?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_legal_mandatory?: boolean
          name?: string
          rate_amount?: number
          rate_type?: string
          target_employee_ids?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "allowance_types_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          author_email: string | null
          author_name: string | null
          category: string
          company_id: string | null
          content: string
          created_at: string
          id: string
          pinned: boolean
          title: string
          updated_at: string
        }
        Insert: {
          author_email?: string | null
          author_name?: string | null
          category?: string
          company_id?: string | null
          content: string
          created_at?: string
          id?: string
          pinned?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          author_email?: string | null
          author_name?: string | null
          category?: string
          company_id?: string | null
          content?: string
          created_at?: string
          id?: string
          pinned?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      applied_migrations: {
        Row: {
          applied_at: string
          version: string
        }
        Insert: {
          applied_at?: string
          version: string
        }
        Update: {
          applied_at?: string
          version?: string
        }
        Relationships: []
      }
      approval_comments: {
        Row: {
          body: string
          company_id: string
          created_at: string | null
          id: string
          request_id: string
          user_id: string
        }
        Insert: {
          body: string
          company_id: string
          created_at?: string | null
          id?: string
          request_id: string
          user_id: string
        }
        Update: {
          body?: string
          company_id?: string
          created_at?: string | null
          id?: string
          request_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_comments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_forms: {
        Row: {
          allow_requester_edit: boolean
          category: string | null
          company_id: string
          content_template: string | null
          created_at: string
          created_by: string | null
          description: string | null
          fields: Json
          id: string
          is_active: boolean
          name: string
          reference_user_ids: string[]
          stages: Json
          updated_at: string
          use_attachment: boolean
        }
        Insert: {
          allow_requester_edit?: boolean
          category?: string | null
          company_id: string
          content_template?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          fields?: Json
          id?: string
          is_active?: boolean
          name: string
          reference_user_ids?: string[]
          stages?: Json
          updated_at?: string
          use_attachment?: boolean
        }
        Update: {
          allow_requester_edit?: boolean
          category?: string | null
          company_id?: string
          content_template?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          fields?: Json
          id?: string
          is_active?: boolean
          name?: string
          reference_user_ids?: string[]
          stages?: Json
          updated_at?: string
          use_attachment?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "approval_forms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_forms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_policies: {
        Row: {
          allow_line_edit: boolean
          auto_approve: boolean | null
          auto_approve_threshold: number | null
          company_id: string
          created_at: string | null
          description_template: string | null
          entity_type: string
          fields: Json
          id: string
          is_active: boolean
          label: string | null
          max_amount: number | null
          min_amount: number | null
          name: string
          reference_user_ids: string[]
          requester_id: string | null
          required_role: string | null
          stages: Json | null
          updated_at: string | null
        }
        Insert: {
          allow_line_edit?: boolean
          auto_approve?: boolean | null
          auto_approve_threshold?: number | null
          company_id: string
          created_at?: string | null
          description_template?: string | null
          entity_type: string
          fields?: Json
          id?: string
          is_active?: boolean
          label?: string | null
          max_amount?: number | null
          min_amount?: number | null
          name?: string
          reference_user_ids?: string[]
          requester_id?: string | null
          required_role?: string | null
          stages?: Json | null
          updated_at?: string | null
        }
        Update: {
          allow_line_edit?: boolean
          auto_approve?: boolean | null
          auto_approve_threshold?: number | null
          company_id?: string
          created_at?: string | null
          description_template?: string | null
          entity_type?: string
          fields?: Json
          id?: string
          is_active?: boolean
          label?: string | null
          max_amount?: number | null
          min_amount?: number | null
          name?: string
          reference_user_ids?: string[]
          requester_id?: string | null
          required_role?: string | null
          stages?: Json | null
          updated_at?: string | null
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
          custom_fields: Json
          description: string | null
          form_id: string | null
          id: string
          policy_id: string | null
          reference_user_ids: string[]
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
          custom_fields?: Json
          description?: string | null
          form_id?: string | null
          id?: string
          policy_id?: string | null
          reference_user_ids?: string[]
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
          custom_fields?: Json
          description?: string | null
          form_id?: string | null
          id?: string
          policy_id?: string | null
          reference_user_ids?: string[]
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
            foreignKeyName: "approval_requests_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "approval_forms"
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
      attendance_edit_requests: {
        Row: {
          attendance_record_id: string
          company_id: string
          created_at: string | null
          id: string
          reason: string | null
          requested_by: string
          requested_changes: Json
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
        }
        Insert: {
          attendance_record_id: string
          company_id: string
          created_at?: string | null
          id?: string
          reason?: string | null
          requested_by: string
          requested_changes: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Update: {
          attendance_record_id?: string
          company_id?: string
          created_at?: string | null
          id?: string
          reason?: string | null
          requested_by?: string
          requested_changes?: Json
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_edit_requests_attendance_record_id_fkey"
            columns: ["attendance_record_id"]
            isOneToOne: false
            referencedRelation: "attendance_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_edit_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_edit_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_edit_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          attendance_type: string | null
          auto_clocked_out: boolean
          check_in: string | null
          check_out: string | null
          company_id: string
          created_at: string | null
          date: string
          edited_at: string | null
          edited_by: string | null
          employee_id: string
          holiday_minutes: number | null
          id: string
          is_holiday: boolean | null
          is_late: boolean | null
          late_minutes: number | null
          night_minutes: number | null
          note: string | null
          overtime_hours: number | null
          overtime_minutes: number | null
          overtime_request_id: string | null
          regular_minutes: number | null
          status: string | null
          work_hours: number | null
        }
        Insert: {
          attendance_type?: string | null
          auto_clocked_out?: boolean
          check_in?: string | null
          check_out?: string | null
          company_id: string
          created_at?: string | null
          date: string
          edited_at?: string | null
          edited_by?: string | null
          employee_id: string
          holiday_minutes?: number | null
          id?: string
          is_holiday?: boolean | null
          is_late?: boolean | null
          late_minutes?: number | null
          night_minutes?: number | null
          note?: string | null
          overtime_hours?: number | null
          overtime_minutes?: number | null
          overtime_request_id?: string | null
          regular_minutes?: number | null
          status?: string | null
          work_hours?: number | null
        }
        Update: {
          attendance_type?: string | null
          auto_clocked_out?: boolean
          check_in?: string | null
          check_out?: string | null
          company_id?: string
          created_at?: string | null
          date?: string
          edited_at?: string | null
          edited_by?: string | null
          employee_id?: string
          holiday_minutes?: number | null
          id?: string
          is_holiday?: boolean | null
          is_late?: boolean | null
          late_minutes?: number | null
          night_minutes?: number | null
          note?: string | null
          overtime_hours?: number | null
          overtime_minutes?: number | null
          overtime_request_id?: string | null
          regular_minutes?: number | null
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
            foreignKeyName: "attendance_records_edited_by_fkey"
            columns: ["edited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_overtime_request_id_fkey"
            columns: ["overtime_request_id"]
            isOneToOne: false
            referencedRelation: "overtime_requests"
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
            foreignKeyName: "bank_classification_rules_assign_deal_id_fkey"
            columns: ["assign_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "bank_classification_rules_assign_deal_id_fkey"
            columns: ["assign_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "bank_classification_rules_assign_deal_id_fkey"
            columns: ["assign_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "bank_classification_rules_assign_deal_id_fkey"
            columns: ["assign_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "bank_classification_rules_assign_deal_id_fkey"
            columns: ["assign_deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
          ai_attempted_at: string | null
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
          external_id: string | null
          id: string
          is_auto_transfer: boolean | null
          is_fixed_cost: boolean | null
          journal_entry_id: string | null
          mapped_at: string | null
          mapped_by: string | null
          mapping_status: string | null
          memo: string | null
          partner_id: string | null
          raw_data: Json | null
          settled_amount: number
          settlement_status: string
          source: string | null
          tags: string[] | null
          tax_invoice_id: string | null
          transaction_date: string
          type: string
          used_by_employee_id: string | null
        }
        Insert: {
          ai_attempted_at?: string | null
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
          external_id?: string | null
          id?: string
          is_auto_transfer?: boolean | null
          is_fixed_cost?: boolean | null
          journal_entry_id?: string | null
          mapped_at?: string | null
          mapped_by?: string | null
          mapping_status?: string | null
          memo?: string | null
          partner_id?: string | null
          raw_data?: Json | null
          settled_amount?: number
          settlement_status?: string
          source?: string | null
          tags?: string[] | null
          tax_invoice_id?: string | null
          transaction_date: string
          type: string
          used_by_employee_id?: string | null
        }
        Update: {
          ai_attempted_at?: string | null
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
          external_id?: string | null
          id?: string
          is_auto_transfer?: boolean | null
          is_fixed_cost?: boolean | null
          journal_entry_id?: string | null
          mapped_at?: string | null
          mapped_by?: string | null
          mapping_status?: string | null
          memo?: string | null
          partner_id?: string | null
          raw_data?: Json | null
          settled_amount?: number
          settlement_status?: string
          source?: string | null
          tags?: string[] | null
          tax_invoice_id?: string | null
          transaction_date?: string
          type?: string
          used_by_employee_id?: string | null
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
            foreignKeyName: "bank_transactions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "bank_transactions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "bank_transactions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "bank_transactions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "bank_transactions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "bank_transactions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
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
            foreignKeyName: "bank_transactions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
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
      board_columns: {
        Row: {
          company_id: string
          created_at: string
          id: string
          in_list: boolean
          name: string
          position: number
          settings: Json
          type: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          in_list?: boolean
          name?: string
          position?: number
          settings?: Json
          type?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          in_list?: boolean
          name?: string
          position?: number
          settings?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_columns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      board_comments: {
        Row: {
          attachments: Json
          author_id: string | null
          author_name: string | null
          company_id: string
          content: string
          created_at: string
          id: string
          mentioned_user_ids: string[] | null
          parent_comment_id: string | null
          post_id: string
        }
        Insert: {
          attachments?: Json
          author_id?: string | null
          author_name?: string | null
          company_id: string
          content: string
          created_at?: string
          id?: string
          mentioned_user_ids?: string[] | null
          parent_comment_id?: string | null
          post_id: string
        }
        Update: {
          attachments?: Json
          author_id?: string | null
          author_name?: string | null
          company_id?: string
          content?: string
          created_at?: string
          id?: string
          mentioned_user_ids?: string[] | null
          parent_comment_id?: string | null
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_comments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "board_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "board_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      board_groups: {
        Row: {
          color: string
          company_id: string
          created_at: string
          id: string
          name: string
          position: number
        }
        Insert: {
          color?: string
          company_id: string
          created_at?: string
          id?: string
          name?: string
          position?: number
        }
        Update: {
          color?: string
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "board_groups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      board_item_updates: {
        Row: {
          author_name: string | null
          author_user_id: string | null
          body: string
          company_id: string
          created_at: string
          deal_id: string
          id: string
          subitem_id: string | null
          workflow_item_id: string | null
        }
        Insert: {
          author_name?: string | null
          author_user_id?: string | null
          body: string
          company_id: string
          created_at?: string
          deal_id: string
          id?: string
          subitem_id?: string | null
          workflow_item_id?: string | null
        }
        Update: {
          author_name?: string | null
          author_user_id?: string | null
          body?: string
          company_id?: string
          created_at?: string
          deal_id?: string
          id?: string
          subitem_id?: string | null
          workflow_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "board_item_updates_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_item_updates_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "board_item_updates_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "board_item_updates_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "board_item_updates_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "board_item_updates_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "board_item_updates_subitem_id_fkey"
            columns: ["subitem_id"]
            isOneToOne: false
            referencedRelation: "project_subitems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_item_updates_workflow_item_id_fkey"
            columns: ["workflow_item_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id"]
          },
        ]
      }
      board_poll_votes: {
        Row: {
          company_id: string
          created_at: string
          id: string
          option_index: number
          post_id: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          option_index: number
          post_id: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          option_index?: number
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_poll_votes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_poll_votes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "board_posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_poll_votes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      board_posts: {
        Row: {
          attachments: Json
          author_email: string | null
          author_id: string | null
          author_name: string | null
          company_id: string
          content: string
          created_at: string
          event_date: string | null
          id: string
          pinned: boolean
          poll_anonymous: boolean
          poll_deadline: string | null
          poll_multi: boolean
          poll_options: Json
          poll_question: string | null
          title: string
          updated_at: string
        }
        Insert: {
          attachments?: Json
          author_email?: string | null
          author_id?: string | null
          author_name?: string | null
          company_id: string
          content: string
          created_at?: string
          event_date?: string | null
          id?: string
          pinned?: boolean
          poll_anonymous?: boolean
          poll_deadline?: string | null
          poll_multi?: boolean
          poll_options?: Json
          poll_question?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          attachments?: Json
          author_email?: string | null
          author_id?: string | null
          author_name?: string | null
          company_id?: string
          content?: string
          created_at?: string
          event_date?: string | null
          id?: string
          pinned?: boolean
          poll_anonymous?: boolean
          poll_deadline?: string | null
          poll_multi?: boolean
          poll_options?: Json
          poll_question?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "board_posts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      card_account_mappings: {
        Row: {
          account_id: string
          category: string
          company_id: string
          id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          category: string
          company_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          category?: string
          company_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_account_mappings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_account_mappings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      card_aliases: {
        Row: {
          alias: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          source_card_name: string
          updated_at: string
        }
        Insert: {
          alias: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          source_card_name: string
          updated_at?: string
        }
        Update: {
          alias?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          source_card_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_aliases_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      card_transactions: {
        Row: {
          amount: number
          approval_number: string | null
          bank_transaction_id: string | null
          card_id: string | null
          card_name: string | null
          category: string | null
          classification: string | null
          company_id: string
          created_at: string | null
          currency: string | null
          deal_id: string | null
          external_id: string | null
          id: string
          installments: number | null
          is_deductible: boolean | null
          is_fixed_cost: boolean | null
          journal_entry_id: string | null
          mapped_at: string | null
          mapped_by: string | null
          mapping_status: string | null
          memo: string | null
          merchant_category: string | null
          merchant_name: string | null
          raw_data: Json | null
          receipt_url: string | null
          source: string | null
          tags: string[] | null
          tax_invoice_id: string | null
          transaction_date: string
          used_by_employee_id: string | null
        }
        Insert: {
          amount?: number
          approval_number?: string | null
          bank_transaction_id?: string | null
          card_id?: string | null
          card_name?: string | null
          category?: string | null
          classification?: string | null
          company_id: string
          created_at?: string | null
          currency?: string | null
          deal_id?: string | null
          external_id?: string | null
          id?: string
          installments?: number | null
          is_deductible?: boolean | null
          is_fixed_cost?: boolean | null
          journal_entry_id?: string | null
          mapped_at?: string | null
          mapped_by?: string | null
          mapping_status?: string | null
          memo?: string | null
          merchant_category?: string | null
          merchant_name?: string | null
          raw_data?: Json | null
          receipt_url?: string | null
          source?: string | null
          tags?: string[] | null
          tax_invoice_id?: string | null
          transaction_date: string
          used_by_employee_id?: string | null
        }
        Update: {
          amount?: number
          approval_number?: string | null
          bank_transaction_id?: string | null
          card_id?: string | null
          card_name?: string | null
          category?: string | null
          classification?: string | null
          company_id?: string
          created_at?: string | null
          currency?: string | null
          deal_id?: string | null
          external_id?: string | null
          id?: string
          installments?: number | null
          is_deductible?: boolean | null
          is_fixed_cost?: boolean | null
          journal_entry_id?: string | null
          mapped_at?: string | null
          mapped_by?: string | null
          mapping_status?: string | null
          memo?: string | null
          merchant_category?: string | null
          merchant_name?: string | null
          raw_data?: Json | null
          receipt_url?: string | null
          source?: string | null
          tags?: string[] | null
          tax_invoice_id?: string | null
          transaction_date?: string
          used_by_employee_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "card_transactions_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "card_transactions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "card_transactions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "card_transactions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "card_transactions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "card_transactions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "card_transactions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
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
      cash_projections: {
        Row: {
          company_id: string
          generated_at: string | null
          generated_by: string | null
          id: string
          month: string
          projection_data: Json
        }
        Insert: {
          company_id: string
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          month: string
          projection_data?: Json
        }
        Update: {
          company_id?: string
          generated_at?: string | null
          generated_by?: string | null
          id?: string
          month?: string
          projection_data?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cash_projections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_projections_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_receipts: {
        Row: {
          amount: number
          approval_number: string | null
          bank_transaction_id: string | null
          company_id: string | null
          counterparty_bizno: string | null
          counterparty_name: string | null
          created_at: string | null
          deal_id: string | null
          document_key: string | null
          id: string
          identity_number: string | null
          identity_type: string | null
          issue_date: string
          issue_response: Json | null
          journal_entry_id: string | null
          memo: string | null
          nts_state_code: string | null
          purpose: string | null
          source: string | null
          status: string | null
          supply_amount: number | null
          tax_amount: number | null
          type: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          approval_number?: string | null
          bank_transaction_id?: string | null
          company_id?: string | null
          counterparty_bizno?: string | null
          counterparty_name?: string | null
          created_at?: string | null
          deal_id?: string | null
          document_key?: string | null
          id?: string
          identity_number?: string | null
          identity_type?: string | null
          issue_date: string
          issue_response?: Json | null
          journal_entry_id?: string | null
          memo?: string | null
          nts_state_code?: string | null
          purpose?: string | null
          source?: string | null
          status?: string | null
          supply_amount?: number | null
          tax_amount?: number | null
          type: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          approval_number?: string | null
          bank_transaction_id?: string | null
          company_id?: string | null
          counterparty_bizno?: string | null
          counterparty_name?: string | null
          created_at?: string | null
          deal_id?: string | null
          document_key?: string | null
          id?: string
          identity_number?: string | null
          identity_type?: string | null
          issue_date?: string
          issue_response?: Json | null
          journal_entry_id?: string | null
          memo?: string | null
          nts_state_code?: string | null
          purpose?: string | null
          source?: string | null
          status?: string | null
          supply_amount?: number | null
          tax_amount?: number | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_receipts_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_receipts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_receipts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_receipts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "cash_receipts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "cash_receipts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "cash_receipts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "cash_receipts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "cash_receipts_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
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
      chart_of_accounts: {
        Row: {
          account_type: string
          code: string
          company_id: string
          created_at: string
          id: string
          is_system: boolean
          name: string
          parent_id: string | null
        }
        Insert: {
          account_type: string
          code: string
          company_id: string
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          parent_id?: string | null
        }
        Update: {
          account_type?: string
          code?: string
          company_id?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
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
          created_by: string | null
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
          created_by?: string | null
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
          created_by?: string | null
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
            foreignKeyName: "chat_channels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
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
            foreignKeyName: "chat_channels_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "chat_channels_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "chat_channels_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "chat_channels_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "chat_channels_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "chat_channels_sub_deal_id_fkey"
            columns: ["sub_deal_id"]
            isOneToOne: false
            referencedRelation: "sub_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_channels_sub_deal_id_fkey"
            columns: ["sub_deal_id"]
            isOneToOne: false
            referencedRelation: "v_sub_deal_pnl"
            referencedColumns: ["sub_deal_id"]
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
          auto_verified: boolean | null
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
          verified_at: string | null
          verified_reason: string | null
        }
        Insert: {
          auto_verified?: boolean | null
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
          verified_at?: string | null
          verified_reason?: string | null
        }
        Update: {
          auto_verified?: boolean | null
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
          verified_at?: string | null
          verified_reason?: string | null
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
          auto_closed: boolean | null
          company_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          id: string
          locked_at: string | null
          locked_by: string | null
          month: string
          notes: string | null
          report_generated_at: string | null
          report_url: string | null
          status: string | null
        }
        Insert: {
          auto_closed?: boolean | null
          company_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          month: string
          notes?: string | null
          report_generated_at?: string | null
          report_url?: string | null
          status?: string | null
        }
        Update: {
          auto_closed?: boolean | null
          company_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          month?: string
          notes?: string | null
          report_generated_at?: string | null
          report_url?: string | null
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
      codef_usage: {
        Row: {
          action: string
          company_id: string | null
          created_at: string
          id: string
          meta: Json | null
          total_calls: number
          units: number
        }
        Insert: {
          action: string
          company_id?: string | null
          created_at?: string
          id?: string
          meta?: Json | null
          total_calls?: number
          units?: number
        }
        Update: {
          action?: string
          company_id?: string | null
          created_at?: string
          id?: string
          meta?: Json | null
          total_calls?: number
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "codef_usage_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          automation_settings: Json
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
          tax_settings: Json
          trial_ends_at: string | null
        }
        Insert: {
          address?: string | null
          automation_settings?: Json
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
          tax_settings?: Json
          trial_ends_at?: string | null
        }
        Update: {
          address?: string | null
          automation_settings?: Json
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
          tax_settings?: Json
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
      company_join_requests: {
        Row: {
          company_id: string
          created_at: string
          expires_at: string
          id: string
          message: string | null
          requester_auth_id: string
          requester_email: string
          requester_name: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          company_id: string
          created_at?: string
          expires_at?: string
          id?: string
          message?: string | null
          requester_auth_id: string
          requester_email: string
          requester_name?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          message?: string | null
          requester_auth_id?: string
          requester_email?: string
          requester_name?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_join_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_join_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          codef_client_id: string | null
          codef_client_secret: string | null
          codef_connected_at: string | null
          codef_connected_id: string | null
          company_id: string
          created_at: string | null
          hometax_password: string | null
          hometax_user_id: string | null
          id: string
          is_inclusive_wage: boolean | null
          is_under_5_employees: boolean | null
          last_cashreceipt_sync_at: string | null
          last_hometax_sync_at: string | null
          late_grace_minutes: number | null
          lunch_minutes: number | null
          monthly_standard_hours: number | null
          night_end_time: string | null
          night_start_time: string | null
          on_duty_pay_per_shift: number | null
          settings: Json | null
          slack_large_tx_threshold: number
          slack_notify_approval: boolean
          slack_notify_large_tx: boolean
          slack_notify_payment: boolean
          slack_webhook_url: string | null
          updated_at: string | null
          weekly_work_hours: number | null
          work_end_time: string | null
          work_start_time: string | null
          workdays_mask: number | null
        }
        Insert: {
          codef_client_id?: string | null
          codef_client_secret?: string | null
          codef_connected_at?: string | null
          codef_connected_id?: string | null
          company_id: string
          created_at?: string | null
          hometax_password?: string | null
          hometax_user_id?: string | null
          id?: string
          is_inclusive_wage?: boolean | null
          is_under_5_employees?: boolean | null
          last_cashreceipt_sync_at?: string | null
          last_hometax_sync_at?: string | null
          late_grace_minutes?: number | null
          lunch_minutes?: number | null
          monthly_standard_hours?: number | null
          night_end_time?: string | null
          night_start_time?: string | null
          on_duty_pay_per_shift?: number | null
          settings?: Json | null
          slack_large_tx_threshold?: number
          slack_notify_approval?: boolean
          slack_notify_large_tx?: boolean
          slack_notify_payment?: boolean
          slack_webhook_url?: string | null
          updated_at?: string | null
          weekly_work_hours?: number | null
          work_end_time?: string | null
          work_start_time?: string | null
          workdays_mask?: number | null
        }
        Update: {
          codef_client_id?: string | null
          codef_client_secret?: string | null
          codef_connected_at?: string | null
          codef_connected_id?: string | null
          company_id?: string
          created_at?: string | null
          hometax_password?: string | null
          hometax_user_id?: string | null
          id?: string
          is_inclusive_wage?: boolean | null
          is_under_5_employees?: boolean | null
          last_cashreceipt_sync_at?: string | null
          last_hometax_sync_at?: string | null
          late_grace_minutes?: number | null
          lunch_minutes?: number | null
          monthly_standard_hours?: number | null
          night_end_time?: string | null
          night_start_time?: string | null
          on_duty_pay_per_shift?: number | null
          settings?: Json | null
          slack_large_tx_threshold?: number
          slack_notify_approval?: boolean
          slack_notify_large_tx?: boolean
          slack_notify_payment?: boolean
          slack_webhook_url?: string | null
          updated_at?: string | null
          weekly_work_hours?: number | null
          work_end_time?: string | null
          work_start_time?: string | null
          workdays_mask?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
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
      contract_templates: {
        Row: {
          body_html: string | null
          body_markdown: string | null
          code: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          file_type: string | null
          file_url: string | null
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          sort_order: number
          updated_at: string
          variables: Json
        }
        Insert: {
          body_html?: string | null
          body_markdown?: string | null
          code?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          sort_order?: number
          updated_at?: string
          variables?: Json
        }
        Update: {
          body_html?: string | null
          body_markdown?: string | null
          code?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "contract_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_cards: {
        Row: {
          billing_day: number | null
          card_company: string
          card_name: string
          card_number: string | null
          card_type: string | null
          company_id: string
          created_at: string | null
          holder_name: string | null
          id: string
          is_active: boolean | null
          monthly_limit: number | null
          payment_day: number | null
        }
        Insert: {
          billing_day?: number | null
          card_company?: string
          card_name: string
          card_number?: string | null
          card_type?: string | null
          company_id: string
          created_at?: string | null
          holder_name?: string | null
          id?: string
          is_active?: boolean | null
          monthly_limit?: number | null
          payment_day?: number | null
        }
        Update: {
          billing_day?: number | null
          card_company?: string
          card_name?: string
          card_number?: string | null
          card_type?: string | null
          company_id?: string
          created_at?: string | null
          holder_name?: string | null
          id?: string
          is_active?: boolean | null
          monthly_limit?: number | null
          payment_day?: number | null
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
      db_integrity_checks: {
        Row: {
          id: number
          payload: Json
          run_at: string
          severity: string
        }
        Insert: {
          id?: number
          payload?: Json
          run_at?: string
          severity: string
        }
        Update: {
          id?: number
          payload?: Json
          run_at?: string
          severity?: string
        }
        Relationships: []
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
            foreignKeyName: "deal_assignments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_assignments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_assignments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_assignments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_assignments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
      deal_cost_adjustments: {
        Row: {
          amount: number
          company_id: string
          created_at: string
          created_by: string | null
          deal_id: string
          id: string
          memo: string | null
          occurred_on: string
        }
        Insert: {
          amount: number
          company_id: string
          created_at?: string
          created_by?: string | null
          deal_id: string
          id?: string
          memo?: string | null
          occurred_on?: string
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string
          id?: string
          memo?: string | null
          occurred_on?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_cost_adjustments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_cost_adjustments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_cost_adjustments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_cost_adjustments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_cost_adjustments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_cost_adjustments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_cost_adjustments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
            foreignKeyName: "deal_cost_schedule_sub_deal_id_fkey"
            columns: ["sub_deal_id"]
            isOneToOne: false
            referencedRelation: "v_sub_deal_pnl"
            referencedColumns: ["sub_deal_id"]
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
          {
            foreignKeyName: "deal_files_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_files_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_files_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_files_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_files_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      deal_milestones: {
        Row: {
          completed_at: string | null
          created_at: string | null
          deal_id: string
          due_date: string | null
          id: string
          name: string
          sort_order: number | null
          start_date: string | null
          status: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          deal_id: string
          due_date?: string | null
          id?: string
          name: string
          sort_order?: number | null
          start_date?: string | null
          status?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          deal_id?: string
          due_date?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          start_date?: string | null
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
          {
            foreignKeyName: "deal_milestones_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_milestones_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_milestones_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_milestones_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_milestones_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      deal_nodes: {
        Row: {
          actual_cost: number | null
          assignee_id: string | null
          completed_at: string | null
          created_at: string | null
          deadline: string | null
          deal_id: string | null
          description: string | null
          expected_cost: number | null
          group_name: string | null
          id: string
          name: string
          parent_id: string | null
          priority: string | null
          revenue_amount: number | null
          sort_order: number | null
          start_date: string | null
          status: string | null
        }
        Insert: {
          actual_cost?: number | null
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          deadline?: string | null
          deal_id?: string | null
          description?: string | null
          expected_cost?: number | null
          group_name?: string | null
          id?: string
          name: string
          parent_id?: string | null
          priority?: string | null
          revenue_amount?: number | null
          sort_order?: number | null
          start_date?: string | null
          status?: string | null
        }
        Update: {
          actual_cost?: number | null
          assignee_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          deadline?: string | null
          deal_id?: string | null
          description?: string | null
          expected_cost?: number | null
          group_name?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          priority?: string | null
          revenue_amount?: number | null
          sort_order?: number | null
          start_date?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_nodes_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_nodes_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_nodes_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_nodes_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_nodes_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_nodes_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_nodes_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
          {
            foreignKeyName: "deal_revenue_schedule_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_revenue_schedule_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_revenue_schedule_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_revenue_schedule_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_revenue_schedule_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      deals: {
        Row: {
          archived_at: string | null
          bank_account_id: string | null
          board_group_id: string | null
          checkin_cadence: string | null
          checkin_due_weekday: number | null
          classification: string | null
          column_values: Json
          company_id: string | null
          contract_total: number | null
          counterparty: string | null
          created_at: string | null
          custom_scope: Json | null
          deal_number: string | null
          document_sequence: number | null
          end_date: string | null
          goal_source: string | null
          id: string
          internal_manager_id: string | null
          is_dormant: boolean | null
          last_activity_at: string | null
          name: string
          next_action_text: string | null
          parent_deal_id: string | null
          partner_company_id: string | null
          partner_id: string | null
          priority: string | null
          program_id: string | null
          project_type: string
          risk_level: string | null
          stage: string | null
          start_date: string | null
          status: string | null
          target_amount: number | null
          target_label: string | null
          target_unit: string | null
          vat_type: string
        }
        Insert: {
          archived_at?: string | null
          bank_account_id?: string | null
          board_group_id?: string | null
          checkin_cadence?: string | null
          checkin_due_weekday?: number | null
          classification?: string | null
          column_values?: Json
          company_id?: string | null
          contract_total?: number | null
          counterparty?: string | null
          created_at?: string | null
          custom_scope?: Json | null
          deal_number?: string | null
          document_sequence?: number | null
          end_date?: string | null
          goal_source?: string | null
          id?: string
          internal_manager_id?: string | null
          is_dormant?: boolean | null
          last_activity_at?: string | null
          name: string
          next_action_text?: string | null
          parent_deal_id?: string | null
          partner_company_id?: string | null
          partner_id?: string | null
          priority?: string | null
          program_id?: string | null
          project_type?: string
          risk_level?: string | null
          stage?: string | null
          start_date?: string | null
          status?: string | null
          target_amount?: number | null
          target_label?: string | null
          target_unit?: string | null
          vat_type?: string
        }
        Update: {
          archived_at?: string | null
          bank_account_id?: string | null
          board_group_id?: string | null
          checkin_cadence?: string | null
          checkin_due_weekday?: number | null
          classification?: string | null
          column_values?: Json
          company_id?: string | null
          contract_total?: number | null
          counterparty?: string | null
          created_at?: string | null
          custom_scope?: Json | null
          deal_number?: string | null
          document_sequence?: number | null
          end_date?: string | null
          goal_source?: string | null
          id?: string
          internal_manager_id?: string | null
          is_dormant?: boolean | null
          last_activity_at?: string | null
          name?: string
          next_action_text?: string | null
          parent_deal_id?: string | null
          partner_company_id?: string | null
          partner_id?: string | null
          priority?: string | null
          program_id?: string | null
          project_type?: string
          risk_level?: string | null
          stage?: string | null
          start_date?: string | null
          status?: string | null
          target_amount?: number | null
          target_label?: string | null
          target_unit?: string | null
          vat_type?: string
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
            foreignKeyName: "deals_board_group_id_fkey"
            columns: ["board_group_id"]
            isOneToOne: false
            referencedRelation: "board_groups"
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
            foreignKeyName: "deals_parent_deal_id_fkey"
            columns: ["parent_deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_parent_deal_id_fkey"
            columns: ["parent_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deals_parent_deal_id_fkey"
            columns: ["parent_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deals_parent_deal_id_fkey"
            columns: ["parent_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deals_parent_deal_id_fkey"
            columns: ["parent_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deals_parent_deal_id_fkey"
            columns: ["parent_deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deals_partner_company_id_fkey"
            columns: ["partner_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          archived_at: string | null
          company_id: string
          created_at: string
          id: string
          name: string
          sort_order: number
        }
        Insert: {
          archived_at?: string | null
          company_id: string
          created_at?: string
          id?: string
          name: string
          sort_order?: number
        }
        Update: {
          archived_at?: string | null
          company_id?: string
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "departments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_approvals: {
        Row: {
          approver_id: string
          comment: string | null
          company_id: string | null
          created_at: string | null
          document_id: string
          id: string
          signed_at: string | null
          status: string | null
        }
        Insert: {
          approver_id: string
          comment?: string | null
          company_id?: string | null
          created_at?: string | null
          document_id: string
          id?: string
          signed_at?: string | null
          status?: string | null
        }
        Update: {
          approver_id?: string
          comment?: string | null
          company_id?: string | null
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
      document_files: {
        Row: {
          bucket: string | null
          category: string | null
          company_id: string
          created_at: string | null
          deal_id: string | null
          document_id: string | null
          file_name: string
          file_size: number | null
          file_url: string
          folder_id: string | null
          id: string
          mime_type: string | null
          parent_file_id: string | null
          storage_path: string | null
          tags: string[] | null
          updated_at: string | null
          uploaded_by: string | null
          vault_doc_id: string | null
          version: number | null
        }
        Insert: {
          bucket?: string | null
          category?: string | null
          company_id: string
          created_at?: string | null
          deal_id?: string | null
          document_id?: string | null
          file_name: string
          file_size?: number | null
          file_url: string
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          parent_file_id?: string | null
          storage_path?: string | null
          tags?: string[] | null
          updated_at?: string | null
          uploaded_by?: string | null
          vault_doc_id?: string | null
          version?: number | null
        }
        Update: {
          bucket?: string | null
          category?: string | null
          company_id?: string
          created_at?: string | null
          deal_id?: string | null
          document_id?: string | null
          file_name?: string
          file_size?: number | null
          file_url?: string
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          parent_file_id?: string | null
          storage_path?: string | null
          tags?: string[] | null
          updated_at?: string | null
          uploaded_by?: string | null
          vault_doc_id?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "document_files_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_files_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_files_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "document_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_files_parent_file_id_fkey"
            columns: ["parent_file_id"]
            isOneToOne: false
            referencedRelation: "document_files"
            referencedColumns: ["id"]
          },
        ]
      }
      document_folders: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          name: string
          parent_id: string | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_folders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "document_folders"
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
          source_document_id: string | null
          status: string | null
          sub_deal_id: string | null
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
          source_document_id?: string | null
          status?: string | null
          sub_deal_id?: string | null
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
          source_document_id?: string | null
          status?: string | null
          sub_deal_id?: string | null
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
            foreignKeyName: "documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "documents_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "documents_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_sub_deal_id_fkey"
            columns: ["sub_deal_id"]
            isOneToOne: false
            referencedRelation: "sub_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_sub_deal_id_fkey"
            columns: ["sub_deal_id"]
            isOneToOne: false
            referencedRelation: "v_sub_deal_pnl"
            referencedColumns: ["sub_deal_id"]
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
          admin_notes: Json | null
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
          employment_history: Json | null
          employment_type: string | null
          hire_date: string | null
          id: string
          is_4_insurance: boolean | null
          job_grade: string | null
          job_role: string | null
          job_title: string | null
          meal_allowance_included: boolean | null
          name: string
          non_taxable_amount: number | null
          onboarding_completed_at: string | null
          onboarding_docs: Json | null
          phone: string | null
          position: string | null
          resignation_date: string | null
          retirement_accrual: number | null
          salary: number | null
          saved_signature: Json | null
          status: string | null
          user_id: string | null
          work_end_time: string | null
          work_start_time: string | null
          working_hours: string | null
        }
        Insert: {
          account_number?: string | null
          address?: string | null
          admin_notes?: Json | null
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
          employment_history?: Json | null
          employment_type?: string | null
          hire_date?: string | null
          id?: string
          is_4_insurance?: boolean | null
          job_grade?: string | null
          job_role?: string | null
          job_title?: string | null
          meal_allowance_included?: boolean | null
          name: string
          non_taxable_amount?: number | null
          onboarding_completed_at?: string | null
          onboarding_docs?: Json | null
          phone?: string | null
          position?: string | null
          resignation_date?: string | null
          retirement_accrual?: number | null
          salary?: number | null
          saved_signature?: Json | null
          status?: string | null
          user_id?: string | null
          work_end_time?: string | null
          work_start_time?: string | null
          working_hours?: string | null
        }
        Update: {
          account_number?: string | null
          address?: string | null
          admin_notes?: Json | null
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
          employment_history?: Json | null
          employment_type?: string | null
          hire_date?: string | null
          id?: string
          is_4_insurance?: boolean | null
          job_grade?: string | null
          job_role?: string | null
          job_title?: string | null
          meal_allowance_included?: boolean | null
          name?: string
          non_taxable_amount?: number | null
          onboarding_completed_at?: string | null
          onboarding_docs?: Json | null
          phone?: string | null
          position?: string | null
          resignation_date?: string | null
          retirement_accrual?: number | null
          salary?: number | null
          saved_signature?: Json | null
          status?: string | null
          user_id?: string | null
          work_end_time?: string | null
          work_start_time?: string | null
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
      error_logs: {
        Row: {
          company_id: string | null
          context: Json | null
          created_at: string
          error_type: string | null
          id: string
          message: string
          resolved: boolean
          source: string | null
          stack: string | null
          url: string | null
          user_agent: string | null
          user_email: string | null
          user_name: string | null
        }
        Insert: {
          company_id?: string | null
          context?: Json | null
          created_at?: string
          error_type?: string | null
          id?: string
          message: string
          resolved?: boolean
          source?: string | null
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_name?: string | null
        }
        Update: {
          company_id?: string | null
          context?: Json | null
          created_at?: string
          error_type?: string | null
          id?: string
          message?: string
          resolved?: boolean
          source?: string | null
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_name?: string | null
        }
        Relationships: []
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
          detail_items: Json | null
          employee_id: string | null
          has_vat: boolean | null
          id: string
          note: string | null
          paid_at: string | null
          payment_due_date: string | null
          payment_method: string | null
          reason: string | null
          receipt_urls: string[] | null
          request_date: string | null
          request_type: string | null
          requester_id: string
          status: string | null
          tax_invoice_id: string | null
          title: string
          updated_at: string | null
          vat_amount: number | null
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
          detail_items?: Json | null
          employee_id?: string | null
          has_vat?: boolean | null
          id?: string
          note?: string | null
          paid_at?: string | null
          payment_due_date?: string | null
          payment_method?: string | null
          reason?: string | null
          receipt_urls?: string[] | null
          request_date?: string | null
          request_type?: string | null
          requester_id: string
          status?: string | null
          tax_invoice_id?: string | null
          title: string
          updated_at?: string | null
          vat_amount?: number | null
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
          detail_items?: Json | null
          employee_id?: string | null
          has_vat?: boolean | null
          id?: string
          note?: string | null
          paid_at?: string | null
          payment_due_date?: string | null
          payment_method?: string | null
          reason?: string | null
          receipt_urls?: string[] | null
          request_date?: string | null
          request_type?: string | null
          requester_id?: string
          status?: string | null
          tax_invoice_id?: string | null
          title?: string
          updated_at?: string | null
          vat_amount?: number | null
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
            foreignKeyName: "expense_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "expense_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "expense_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "expense_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "expense_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
          {
            foreignKeyName: "financial_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "financial_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "financial_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "financial_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "financial_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      fixed_costs: {
        Row: {
          amount: number
          category: string
          company_id: string
          created_at: string | null
          end_date: string | null
          id: string
          is_recurring: boolean
          name: string
          note: string | null
          payment_day: number
          start_date: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number
          category?: string
          company_id: string
          created_at?: string | null
          end_date?: string | null
          id?: string
          is_recurring?: boolean
          name: string
          note?: string | null
          payment_day?: number
          start_date?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          category?: string
          company_id?: string
          created_at?: string | null
          end_date?: string | null
          id?: string
          is_recurring?: boolean
          name?: string
          note?: string | null
          payment_day?: number
          start_date?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixed_costs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      holidays: {
        Row: {
          company_id: string
          created_at: string | null
          created_by: string | null
          date: string
          id: string
          name: string
          type: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          created_by?: string | null
          date: string
          id?: string
          name: string
          type?: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          date?: string
          id?: string
          name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "holidays_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holidays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      hometax_sync_jobs: {
        Row: {
          company_id: string
          completed_at: string | null
          created_at: string
          current_progress: Json | null
          end_date: string
          errors: Json
          id: string
          in_progress: boolean
          job_type: string
          last_lock_at: string | null
          notes: Json
          result_per_month: Json
          start_date: string
          started_at: string | null
          status: string
          total_response: number
          total_synced: number
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          created_at?: string
          current_progress?: Json | null
          end_date: string
          errors?: Json
          id?: string
          in_progress?: boolean
          job_type?: string
          last_lock_at?: string | null
          notes?: Json
          result_per_month?: Json
          start_date: string
          started_at?: string | null
          status?: string
          total_response?: number
          total_synced?: number
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          created_at?: string
          current_progress?: Json | null
          end_date?: string
          errors?: Json
          id?: string
          in_progress?: boolean
          job_type?: string
          last_lock_at?: string | null
          notes?: Json
          result_per_month?: Json
          start_date?: string
          started_at?: string | null
          status?: string
          total_response?: number
          total_synced?: number
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hometax_sync_jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hometax_sync_jobs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      invoice_settlements: {
        Row: {
          adjustment_reason: string | null
          amount: number
          bank_transaction_id: string | null
          company_id: string
          confidence: number | null
          created_at: string
          created_by: string | null
          id: string
          match_source: string
          match_type: string
          reason: string | null
          status: string
          tax_invoice_id: string
          updated_at: string
        }
        Insert: {
          adjustment_reason?: string | null
          amount: number
          bank_transaction_id?: string | null
          company_id: string
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          match_source?: string
          match_type?: string
          reason?: string | null
          status?: string
          tax_invoice_id: string
          updated_at?: string
        }
        Update: {
          adjustment_reason?: string | null
          amount?: number
          bank_transaction_id?: string | null
          company_id?: string
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          match_source?: string
          match_type?: string
          reason?: string | null
          status?: string
          tax_invoice_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_settlements_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_settlements_tax_invoice_id_fkey"
            columns: ["tax_invoice_id"]
            isOneToOne: false
            referencedRelation: "tax_invoices"
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
      journal_entries: {
        Row: {
          approved_by: string | null
          company_id: string
          confidence: number | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          description: string
          entry_date: string
          id: string
          is_approved: boolean
          linked_bank_tx_id: string | null
          linked_invoice_id: string | null
          linked_settlement_id: string | null
          reason: string | null
          reference_id: string | null
          reference_type: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          status: string
          sub_deal_id: string | null
          updated_at: string
          voucher_no: number | null
          voucher_type: string | null
        }
        Insert: {
          approved_by?: string | null
          company_id: string
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          description?: string
          entry_date: string
          id?: string
          is_approved?: boolean
          linked_bank_tx_id?: string | null
          linked_invoice_id?: string | null
          linked_settlement_id?: string | null
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string
          sub_deal_id?: string | null
          updated_at?: string
          voucher_no?: number | null
          voucher_type?: string | null
        }
        Update: {
          approved_by?: string | null
          company_id?: string
          confidence?: number | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          description?: string
          entry_date?: string
          id?: string
          is_approved?: boolean
          linked_bank_tx_id?: string | null
          linked_invoice_id?: string | null
          linked_settlement_id?: string | null
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          status?: string
          sub_deal_id?: string | null
          updated_at?: string
          voucher_no?: number | null
          voucher_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "journal_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "journal_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "journal_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "journal_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "journal_entries_linked_bank_tx_id_fkey"
            columns: ["linked_bank_tx_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_linked_invoice_id_fkey"
            columns: ["linked_invoice_id"]
            isOneToOne: false
            referencedRelation: "tax_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_linked_settlement_id_fkey"
            columns: ["linked_settlement_id"]
            isOneToOne: false
            referencedRelation: "invoice_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_linked_settlement_id_fkey"
            columns: ["linked_settlement_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_confirmed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_linked_settlement_id_fkey"
            columns: ["linked_settlement_id"]
            isOneToOne: false
            referencedRelation: "v_settlement_review_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_sub_deal_id_fkey"
            columns: ["sub_deal_id"]
            isOneToOne: false
            referencedRelation: "sub_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_sub_deal_id_fkey"
            columns: ["sub_deal_id"]
            isOneToOne: false
            referencedRelation: "v_sub_deal_pnl"
            referencedColumns: ["sub_deal_id"]
          },
        ]
      }
      journal_entry_audits: {
        Row: {
          action: string
          actor_id: string | null
          before: Json
          company_id: string
          created_at: string
          entry_id: string
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          before: Json
          company_id: string
          created_at?: string
          entry_id: string
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          before?: Json
          company_id?: string
          created_at?: string
          entry_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_audits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_audits_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          bank_account_id: string | null
          card_id: string | null
          company_id: string | null
          credit: number
          debit: number
          description: string
          entry_id: string
          id: string
          partner_id: string | null
        }
        Insert: {
          account_id: string
          bank_account_id?: string | null
          card_id?: string | null
          company_id?: string | null
          credit?: number
          debit?: number
          description?: string
          entry_id: string
          id?: string
          partner_id?: string | null
        }
        Update: {
          account_id?: string
          bank_account_id?: string | null
          card_id?: string | null
          company_id?: string | null
          credit?: number
          debit?: number
          description?: string
          entry_id?: string
          id?: string
          partner_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "corporate_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
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
      leave_grants: {
        Row: {
          company_id: string
          created_at: string | null
          created_by: string | null
          days: number
          employee_id: string
          grant_date: string
          grant_type: string
          id: string
          memo: string | null
          year: number
        }
        Insert: {
          company_id: string
          created_at?: string | null
          created_by?: string | null
          days: number
          employee_id: string
          grant_date: string
          grant_type?: string
          id?: string
          memo?: string | null
          year: number
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          days?: number
          employee_id?: string
          grant_date?: string
          grant_type?: string
          id?: string
          memo?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_grants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_grants_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_grants_employee_id_fkey"
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
          approval_steps: Json
          approved_at: string | null
          approved_by: string | null
          cc_user_ids: string[]
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
          requested_approver_id: string | null
          second_approved_at: string | null
          second_approved_by: string | null
          second_approver_id: string | null
          start_date: string
          start_time: string | null
          status: string | null
        }
        Insert: {
          approval_steps?: Json
          approved_at?: string | null
          approved_by?: string | null
          cc_user_ids?: string[]
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
          requested_approver_id?: string | null
          second_approved_at?: string | null
          second_approved_by?: string | null
          second_approver_id?: string | null
          start_date: string
          start_time?: string | null
          status?: string | null
        }
        Update: {
          approval_steps?: Json
          approved_at?: string | null
          approved_by?: string | null
          cc_user_ids?: string[]
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
          requested_approver_id?: string | null
          second_approved_at?: string | null
          second_approved_by?: string | null
          second_approver_id?: string | null
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
          {
            foreignKeyName: "leave_requests_requested_approver_id_fkey"
            columns: ["requested_approver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_second_approved_by_fkey"
            columns: ["second_approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_second_approver_id_fkey"
            columns: ["second_approver_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      notification_prefs: {
        Row: {
          company_id: string | null
          prefs: Json
          updated_at: string | null
          user_id: string
        }
        Insert: {
          company_id?: string | null
          prefs?: Json
          updated_at?: string | null
          user_id: string
        }
        Update: {
          company_id?: string | null
          prefs?: Json
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          company_id: string
          created_at: string
          daily_report_emails: string[]
          daily_report_enabled: boolean
          daily_report_phones: string[]
          daily_report_send_hour: number
          last_sent_at: string | null
          last_sent_status: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          daily_report_emails?: string[]
          daily_report_enabled?: boolean
          daily_report_phones?: string[]
          daily_report_send_hour?: number
          last_sent_at?: string | null
          last_sent_status?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          daily_report_emails?: string[]
          daily_report_enabled?: boolean
          daily_report_phones?: string[]
          daily_report_send_hour?: number
          last_sent_at?: string | null
          last_sent_status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
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
      operator_actions: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string
          context: Json | null
          created_at: string
          id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id: string
          context?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string
          context?: Json | null
          created_at?: string
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: []
      }
      operator_incidents: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          occurred_at: string
          prevention: string | null
          related_commit: string | null
          resolved_at: string | null
          root_cause: string | null
          severity: string
          symptoms: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          occurred_at?: string
          prevention?: string | null
          related_commit?: string | null
          resolved_at?: string | null
          root_cause?: string | null
          severity?: string
          symptoms?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          occurred_at?: string
          prevention?: string | null
          related_commit?: string | null
          resolved_at?: string | null
          root_cause?: string | null
          severity?: string
          symptoms?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      overtime_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approver_id: string | null
          company_id: string
          created_at: string
          employee_id: string
          id: string
          reason: string
          rejected_reason: string | null
          requested_date: string
          requested_end_time: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approver_id?: string | null
          company_id: string
          created_at?: string
          employee_id: string
          id?: string
          reason: string
          rejected_reason?: string | null
          requested_date: string
          requested_end_time: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approver_id?: string | null
          company_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          reason?: string
          rejected_reason?: string | null
          requested_date?: string
          requested_end_time?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "overtime_requests_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_requests_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_injections: {
        Row: {
          amount: number
          company_id: string
          created_at: string | null
          date: string
          id: string
          note: string | null
        }
        Insert: {
          amount?: number
          company_id: string
          created_at?: string | null
          date?: string
          id?: string
          note?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string | null
          date?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "owner_injections_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_aliases: {
        Row: {
          alias: string
          company_id: string
          confidence: number | null
          created_at: string
          id: string
          match_count: number
          partner_id: string
          source: string
        }
        Insert: {
          alias: string
          company_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          match_count?: number
          partner_id: string
          source?: string
        }
        Update: {
          alias?: string
          company_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          match_count?: number
          partner_id?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_aliases_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_communications: {
        Row: {
          comm_date: string
          comm_type: string
          company_id: string
          created_at: string
          id: string
          notes: string | null
          partner_id: string
          summary: string
          updated_at: string
        }
        Insert: {
          comm_date?: string
          comm_type: string
          company_id: string
          created_at?: string
          id?: string
          notes?: string | null
          partner_id: string
          summary: string
          updated_at?: string
        }
        Update: {
          comm_date?: string
          comm_type?: string
          company_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          partner_id?: string
          summary?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_communications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_communications_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
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
          {
            foreignKeyName: "partner_invitations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "partner_invitations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "partner_invitations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "partner_invitations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "partner_invitations_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      partners: {
        Row: {
          account_number: string | null
          address: string | null
          bank_name: string | null
          business_item: string | null
          business_number: string | null
          business_type: string | null
          classification: string | null
          code: number | null
          company_id: string
          company_name: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          default_expense_category: string | null
          dormancy_detected_at: string | null
          id: string
          is_active: boolean | null
          is_dormant: boolean | null
          name: string
          notes: string | null
          portal_token: string | null
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
          business_item?: string | null
          business_number?: string | null
          business_type?: string | null
          classification?: string | null
          code?: number | null
          company_id: string
          company_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          default_expense_category?: string | null
          dormancy_detected_at?: string | null
          id?: string
          is_active?: boolean | null
          is_dormant?: boolean | null
          name: string
          notes?: string | null
          portal_token?: string | null
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
          business_item?: string | null
          business_number?: string | null
          business_type?: string | null
          classification?: string | null
          code?: number | null
          company_id?: string
          company_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          default_expense_category?: string | null
          dormancy_detected_at?: string | null
          id?: string
          is_active?: boolean | null
          is_dormant?: boolean | null
          name?: string
          notes?: string | null
          portal_token?: string | null
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
          {
            foreignKeyName: "partners_source_deal_id_fkey"
            columns: ["source_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "partners_source_deal_id_fkey"
            columns: ["source_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "partners_source_deal_id_fkey"
            columns: ["source_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "partners_source_deal_id_fkey"
            columns: ["source_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "partners_source_deal_id_fkey"
            columns: ["source_deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
          {
            foreignKeyName: "payment_queue_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "payment_queue_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "payment_queue_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "payment_queue_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "payment_queue_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
          extras: Json | null
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
          extras?: Json | null
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
          extras?: Json | null
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
      payslip_overrides: {
        Row: {
          base_salary: number
          company_id: string
          created_at: string | null
          deduction_overrides: Json | null
          employee_id: string
          extras: Json | null
          id: string
          non_taxable_amount: number
          period_month: string
          updated_at: string | null
        }
        Insert: {
          base_salary?: number
          company_id: string
          created_at?: string | null
          deduction_overrides?: Json | null
          employee_id: string
          extras?: Json | null
          id?: string
          non_taxable_amount?: number
          period_month: string
          updated_at?: string | null
        }
        Update: {
          base_salary?: number
          company_id?: string
          created_at?: string | null
          deduction_overrides?: Json | null
          employee_id?: string
          extras?: Json | null
          id?: string
          non_taxable_amount?: number
          period_month?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payslip_overrides_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payslip_overrides_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      pdf_form_templates: {
        Row: {
          company_id: string
          content_html: string | null
          created_at: string
          created_by: string | null
          doc_type: string
          fields: Json
          file_path: string
          id: string
          is_active: boolean
          name: string
          page_count: number
          page_sizes: Json | null
          template_mode: string
          updated_at: string
        }
        Insert: {
          company_id: string
          content_html?: string | null
          created_at?: string
          created_by?: string | null
          doc_type: string
          fields?: Json
          file_path: string
          id?: string
          is_active?: boolean
          name: string
          page_count?: number
          page_sizes?: Json | null
          template_mode?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          content_html?: string | null
          created_at?: string
          created_by?: string | null
          doc_type?: string
          fields?: Json
          file_path?: string
          id?: string
          is_active?: boolean
          name?: string
          page_count?: number
          page_sizes?: Json | null
          template_mode?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdf_form_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pdf_form_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_definitions: {
        Row: {
          action: string
          description: string | null
          id: string
          label: string
          module: string
          sort_order: number | null
        }
        Insert: {
          action: string
          description?: string | null
          id?: string
          label: string
          module: string
          sort_order?: number | null
        }
        Update: {
          action?: string
          description?: string | null
          id?: string
          label?: string
          module?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      permission_group_members: {
        Row: {
          company_id: string
          created_at: string | null
          group_id: string
          id: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          group_id: string
          id?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          group_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_group_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_group_permissions: {
        Row: {
          created_at: string | null
          group_id: string
          id: string
          permission_id: string
        }
        Insert: {
          created_at?: string | null
          group_id: string
          id?: string
          permission_id: string
        }
        Update: {
          created_at?: string | null
          group_id?: string
          id?: string
          permission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_group_permissions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "permission_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_group_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permission_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_groups: {
        Row: {
          company_id: string
          created_at: string | null
          description: string | null
          icon: string | null
          id: string
          is_system: boolean | null
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "permission_groups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      programs: {
        Row: {
          company_id: string
          created_at: string
          deal_template: Json | null
          description: string | null
          id: string
          name: string
          status: string
          total_budget: number | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          deal_template?: Json | null
          description?: string | null
          id?: string
          name: string
          status?: string
          total_budget?: number | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deal_template?: Json | null
          description?: string | null
          id?: string
          name?: string
          status?: string
          total_budget?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "programs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      project_issues: {
        Row: {
          assignee_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          deal_id: string
          description: string | null
          due_date: string | null
          id: string
          resolution: string | null
          resolved_at: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          deal_id: string
          description?: string | null
          due_date?: string | null
          id?: string
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string
          description?: string | null
          due_date?: string | null
          id?: string
          resolution?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_issues_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_issues_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_issues_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_issues_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_issues_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_issues_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      project_kpi_entries: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          deal_id: string | null
          department_id: string | null
          entry_date: string
          id: string
          kpi_id: string | null
          memo: string | null
          value: number
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          department_id?: string | null
          entry_date: string
          id?: string
          kpi_id?: string | null
          memo?: string | null
          value: number
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          department_id?: string | null
          entry_date?: string
          id?: string
          kpi_id?: string | null
          memo?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_kpi_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_kpi_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_kpi_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_kpi_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_kpi_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_kpi_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_kpi_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_kpi_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_kpi_entries_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_kpi_entries_kpi_id_fkey"
            columns: ["kpi_id"]
            isOneToOne: false
            referencedRelation: "project_kpis"
            referencedColumns: ["id"]
          },
        ]
      }
      project_kpis: {
        Row: {
          company_id: string
          created_at: string
          deal_id: string
          direction: string
          id: string
          label: string
          owner_id: string | null
          sort_order: number
          source: string
          target_value: number
          unit: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          deal_id: string
          direction?: string
          id?: string
          label: string
          owner_id?: string | null
          sort_order?: number
          source?: string
          target_value: number
          unit?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          deal_id?: string
          direction?: string
          id?: string
          label?: string
          owner_id?: string | null
          sort_order?: number
          source?: string
          target_value?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_kpis_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_kpis_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_kpis_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_kpis_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_kpis_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_kpis_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_kpis_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_kpis_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_sprints: {
        Row: {
          company_id: string
          completed_at: string | null
          completed_points: number | null
          created_at: string
          created_by: string | null
          deal_id: string
          end_date: string | null
          goal: string | null
          id: string
          name: string
          sort_order: number
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          completed_points?: number | null
          created_at?: string
          created_by?: string | null
          deal_id: string
          end_date?: string | null
          goal?: string | null
          id?: string
          name: string
          sort_order?: number
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          completed_points?: number | null
          created_at?: string
          created_by?: string | null
          deal_id?: string
          end_date?: string | null
          goal?: string | null
          id?: string
          name?: string
          sort_order?: number
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_sprints_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_sprints_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_sprints_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_sprints_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_sprints_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_sprints_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_sprints_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_sprints_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      project_subitems: {
        Row: {
          column_values: Json
          company_id: string
          created_at: string
          deal_id: string
          id: string
          name: string
          position: number
          workflow_item_id: string | null
        }
        Insert: {
          column_values?: Json
          company_id: string
          created_at?: string
          deal_id: string
          id?: string
          name?: string
          position?: number
          workflow_item_id?: string | null
        }
        Update: {
          column_values?: Json
          company_id?: string
          created_at?: string
          deal_id?: string
          id?: string
          name?: string
          position?: number
          workflow_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_subitems_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_subitems_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_subitems_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_subitems_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_subitems_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_subitems_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_subitems_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_subitems_workflow_item_id_fkey"
            columns: ["workflow_item_id"]
            isOneToOne: false
            referencedRelation: "workflow_items"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tasks: {
        Row: {
          archived_at: string | null
          assignee_id: string | null
          assignee_ids: Json
          attachments: Json
          company_id: string
          created_at: string
          created_by: string | null
          deal_id: string
          description: string | null
          due_date: string | null
          id: string
          labels: Json
          parent_task_id: string | null
          position: number
          progress: number
          sprint_id: string | null
          start_date: string | null
          status: string
          story_points: number | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assignee_id?: string | null
          assignee_ids?: Json
          attachments?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          deal_id: string
          description?: string | null
          due_date?: string | null
          id?: string
          labels?: Json
          parent_task_id?: string | null
          position?: number
          progress?: number
          sprint_id?: string | null
          start_date?: string | null
          status?: string
          story_points?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assignee_id?: string | null
          assignee_ids?: Json
          attachments?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string
          description?: string | null
          due_date?: string | null
          id?: string
          labels?: Json
          parent_task_id?: string | null
          position?: number
          progress?: number
          sprint_id?: string | null
          start_date?: string | null
          status?: string
          story_points?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_tasks_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "project_sprints"
            referencedColumns: ["id"]
          },
        ]
      }
      project_updates: {
        Row: {
          body: string | null
          company_id: string
          created_at: string
          created_by: string | null
          deal_id: string
          did: string | null
          id: string
          issues: string | null
          kpi_snapshot: Json | null
          next_plan: string | null
          period_start: string | null
          status: string
          update_date: string
        }
        Insert: {
          body?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          deal_id: string
          did?: string | null
          id?: string
          issues?: string | null
          kpi_snapshot?: Json | null
          next_plan?: string | null
          period_start?: string | null
          status?: string
          update_date: string
        }
        Update: {
          body?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string
          did?: string | null
          id?: string
          issues?: string | null
          kpi_snapshot?: Json | null
          next_plan?: string | null
          period_start?: string | null
          status?: string
          update_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_updates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_updates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_updates_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_updates_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_updates_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_updates_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_updates_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_updates_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          company_id: string | null
          created_at: string | null
          endpoint: string
          id: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          company_id?: string | null
          created_at?: string | null
          endpoint: string
          id?: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          company_id?: string | null
          created_at?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_approvals: {
        Row: {
          approval_token: string
          company_id: string
          created_at: string
          created_by: string | null
          deal_id: string
          decided_at: string | null
          decision_note: string | null
          expires_at: string | null
          fully_signed_contract_url: string | null
          id: string
          our_signature_data_url: string | null
          our_signature_method: string | null
          our_signed_at: string | null
          our_signer_user_id: string | null
          partner_id: string | null
          payload: Json
          recipient_email: string | null
          recipient_name: string | null
          sent_at: string | null
          signature_data_url: string | null
          signature_method: string | null
          signed_at_external: string | null
          signed_contract_html: string | null
          signed_contract_url: string | null
          signer_ip: string | null
          signer_user_agent: string | null
          stage: string
          status: string
          sub_deal_id: string | null
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          approval_token: string
          company_id: string
          created_at?: string
          created_by?: string | null
          deal_id: string
          decided_at?: string | null
          decision_note?: string | null
          expires_at?: string | null
          fully_signed_contract_url?: string | null
          id?: string
          our_signature_data_url?: string | null
          our_signature_method?: string | null
          our_signed_at?: string | null
          our_signer_user_id?: string | null
          partner_id?: string | null
          payload?: Json
          recipient_email?: string | null
          recipient_name?: string | null
          sent_at?: string | null
          signature_data_url?: string | null
          signature_method?: string | null
          signed_at_external?: string | null
          signed_contract_html?: string | null
          signed_contract_url?: string | null
          signer_ip?: string | null
          signer_user_agent?: string | null
          stage: string
          status?: string
          sub_deal_id?: string | null
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          approval_token?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string
          decided_at?: string | null
          decision_note?: string | null
          expires_at?: string | null
          fully_signed_contract_url?: string | null
          id?: string
          our_signature_data_url?: string | null
          our_signature_method?: string | null
          our_signed_at?: string | null
          our_signer_user_id?: string | null
          partner_id?: string | null
          payload?: Json
          recipient_email?: string | null
          recipient_name?: string | null
          sent_at?: string | null
          signature_data_url?: string | null
          signature_method?: string | null
          signed_at_external?: string | null
          signed_contract_html?: string | null
          signed_contract_url?: string | null
          signer_ip?: string | null
          signer_user_agent?: string | null
          stage?: string
          status?: string
          sub_deal_id?: string | null
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_approvals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_approvals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_approvals_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_approvals_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "quote_approvals_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "quote_approvals_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "quote_approvals_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "quote_approvals_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "quote_approvals_our_signer_user_id_fkey"
            columns: ["our_signer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_approvals_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_approvals_sub_deal_id_fkey"
            columns: ["sub_deal_id"]
            isOneToOne: false
            referencedRelation: "sub_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_approvals_sub_deal_id_fkey"
            columns: ["sub_deal_id"]
            isOneToOne: false
            referencedRelation: "v_sub_deal_pnl"
            referencedColumns: ["sub_deal_id"]
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
      schedule_events: {
        Row: {
          all_day: boolean
          color: string
          company_id: string
          completed: boolean
          completed_at: string | null
          created_at: string
          description: string | null
          end_at: string | null
          id: string
          is_shared: boolean
          start_at: string
          title: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          all_day?: boolean
          color?: string
          company_id: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          id?: string
          is_shared?: boolean
          start_at: string
          title: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          all_day?: boolean
          color?: string
          company_id?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          id?: string
          is_shared?: boolean
          start_at?: string
          title?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_todos: {
        Row: {
          company_id: string
          created_at: string
          description: string | null
          done: boolean
          done_at: string | null
          due_date: string | null
          id: string
          position: number
          priority: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          description?: string | null
          done?: boolean
          done_at?: string | null
          due_date?: string | null
          id?: string
          position?: number
          priority?: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string | null
          done?: boolean
          done_at?: string | null
          due_date?: string | null
          id?: string
          position?: number
          priority?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_todos_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_todos_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_requests: {
        Row: {
          batch_id: string | null
          batch_seq: number | null
          company_id: string
          created_at: string | null
          created_by: string | null
          delivery_at: string | null
          delivery_detail: string | null
          delivery_status: string | null
          document_id: string | null
          expires_at: string | null
          fully_signed_contract_url: string | null
          id: string
          ip_address: string | null
          our_signature_data_url: string | null
          our_signature_method: string | null
          our_signed_at: string | null
          our_signed_contract_html: string | null
          our_signer_user_id: string | null
          partner_id: string | null
          reminder_count: number | null
          sent_at: string | null
          sign_token: string | null
          signature_data: Json | null
          signature_data_url: string | null
          signature_method: string | null
          signed_at: string | null
          signed_contract_html: string | null
          signed_contract_url: string | null
          signer_email: string
          signer_inputs: Json | null
          signer_name: string
          signer_phone: string | null
          status: string | null
          template_snapshot_html: string | null
          title: string
          viewed_at: string | null
        }
        Insert: {
          batch_id?: string | null
          batch_seq?: number | null
          company_id: string
          created_at?: string | null
          created_by?: string | null
          delivery_at?: string | null
          delivery_detail?: string | null
          delivery_status?: string | null
          document_id?: string | null
          expires_at?: string | null
          fully_signed_contract_url?: string | null
          id?: string
          ip_address?: string | null
          our_signature_data_url?: string | null
          our_signature_method?: string | null
          our_signed_at?: string | null
          our_signed_contract_html?: string | null
          our_signer_user_id?: string | null
          partner_id?: string | null
          reminder_count?: number | null
          sent_at?: string | null
          sign_token?: string | null
          signature_data?: Json | null
          signature_data_url?: string | null
          signature_method?: string | null
          signed_at?: string | null
          signed_contract_html?: string | null
          signed_contract_url?: string | null
          signer_email: string
          signer_inputs?: Json | null
          signer_name: string
          signer_phone?: string | null
          status?: string | null
          template_snapshot_html?: string | null
          title: string
          viewed_at?: string | null
        }
        Update: {
          batch_id?: string | null
          batch_seq?: number | null
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          delivery_at?: string | null
          delivery_detail?: string | null
          delivery_status?: string | null
          document_id?: string | null
          expires_at?: string | null
          fully_signed_contract_url?: string | null
          id?: string
          ip_address?: string | null
          our_signature_data_url?: string | null
          our_signature_method?: string | null
          our_signed_at?: string | null
          our_signed_contract_html?: string | null
          our_signer_user_id?: string | null
          partner_id?: string | null
          reminder_count?: number | null
          sent_at?: string | null
          sign_token?: string | null
          signature_data?: Json | null
          signature_data_url?: string | null
          signature_method?: string | null
          signed_at?: string | null
          signed_contract_html?: string | null
          signed_contract_url?: string | null
          signer_email?: string
          signer_inputs?: Json | null
          signer_name?: string
          signer_phone?: string | null
          status?: string | null
          template_snapshot_html?: string | null
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
          {
            foreignKeyName: "signature_requests_our_signer_user_id_fkey"
            columns: ["our_signer_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_requests_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_send_failures: {
        Row: {
          batch_id: string | null
          company_id: string
          error_code: string
          error_message: string
          failed_at: string
          id: string
          partner_id: string | null
          recipient_email: string
          recipient_name: string | null
          retried: boolean
          retried_at: string | null
          retried_request_id: string | null
          send_type: string
          signature_request_id: string | null
        }
        Insert: {
          batch_id?: string | null
          company_id: string
          error_code: string
          error_message: string
          failed_at?: string
          id?: string
          partner_id?: string | null
          recipient_email: string
          recipient_name?: string | null
          retried?: boolean
          retried_at?: string | null
          retried_request_id?: string | null
          send_type: string
          signature_request_id?: string | null
        }
        Update: {
          batch_id?: string | null
          company_id?: string
          error_code?: string
          error_message?: string
          failed_at?: string
          id?: string
          partner_id?: string | null
          recipient_email?: string
          recipient_name?: string | null
          retried?: boolean
          retried_at?: string | null
          retried_request_id?: string | null
          send_type?: string
          signature_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signature_send_failures_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_send_failures_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_send_failures_retried_request_id_fkey"
            columns: ["retried_request_id"]
            isOneToOne: false
            referencedRelation: "signature_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_send_failures_signature_request_id_fkey"
            columns: ["signature_request_id"]
            isOneToOne: false
            referencedRelation: "signature_requests"
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
          vat_type: string
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
          vat_type?: string
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
          vat_type?: string
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
            foreignKeyName: "sub_deals_parent_deal_id_fkey"
            columns: ["parent_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "sub_deals_parent_deal_id_fkey"
            columns: ["parent_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "sub_deals_parent_deal_id_fkey"
            columns: ["parent_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "sub_deals_parent_deal_id_fkey"
            columns: ["parent_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "sub_deals_parent_deal_id_fkey"
            columns: ["parent_deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
          monthly_cashbill_limit: number | null
          monthly_contract_limit: number | null
          monthly_credits: number | null
          monthly_tax_invoice_limit: number | null
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
          monthly_cashbill_limit?: number | null
          monthly_contract_limit?: number | null
          monthly_credits?: number | null
          monthly_tax_invoice_limit?: number | null
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
          monthly_cashbill_limit?: number | null
          monthly_contract_limit?: number | null
          monthly_credits?: number | null
          monthly_tax_invoice_limit?: number | null
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
      support_tickets: {
        Row: {
          answer: string | null
          answered_at: string | null
          answered_by: string | null
          category: string
          company_id: string
          content: string
          created_at: string
          id: string
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          category?: string
          company_id: string
          content: string
          created_at?: string
          id?: string
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          category?: string
          company_id?: string
          content?: string
          created_at?: string
          id?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_cooldowns: {
        Row: {
          company_id: string
          last_run_at: string
          sync_type: string
          updated_at: string
        }
        Insert: {
          company_id: string
          last_run_at?: string
          sync_type: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          last_run_at?: string
          sync_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_cooldowns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      sync_logs: {
        Row: {
          company_id: string
          created_at: string
          details: Json | null
          id: string
          status: string
          sync_type: string
          synced_by: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          details?: Json | null
          id?: string
          status?: string
          sync_type: string
          synced_by?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          status?: string
          sync_type?: string
          synced_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          body: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          parent_id: string | null
          task_id: string
        }
        Insert: {
          body: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          parent_id?: string | null
          task_id: string
        }
        Update: {
          body?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          parent_id?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "task_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_labels: {
        Row: {
          color: string
          company_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          color?: string
          company_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          color?: string
          company_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_labels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
            foreignKeyName: "tax_invoice_queue_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "tax_invoice_queue_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "tax_invoice_queue_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "tax_invoice_queue_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "tax_invoice_queue_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
          counterparty_business_item: string | null
          counterparty_business_type: string | null
          counterparty_email: string | null
          counterparty_name: string
          counterparty_representative: string | null
          created_at: string | null
          deal_id: string | null
          expense_category: string | null
          hometax_synced_at: string | null
          id: string
          issue_date: string
          item_name: string | null
          journal_entry_id: string | null
          label: string | null
          modification_date: string | null
          modification_reason: string | null
          nts_confirm_no: string | null
          nts_error_code: string | null
          nts_error_message: string | null
          nts_issue_status: string
          nts_issued_at: string | null
          nts_request_payload: Json | null
          nts_response_payload: Json | null
          original_invoice_id: string | null
          partner_id: string | null
          preferred_date: string | null
          revenue_schedule_id: string | null
          settled_amount: number
          settlement_status: string
          source: string | null
          status: string | null
          supply_amount: number
          tax_amount: number
          tax_kind: string
          total_amount: number
          type: string
          updated_at: string | null
        }
        Insert: {
          auto_issued?: boolean | null
          company_id: string
          counterparty_bizno?: string | null
          counterparty_business_item?: string | null
          counterparty_business_type?: string | null
          counterparty_email?: string | null
          counterparty_name: string
          counterparty_representative?: string | null
          created_at?: string | null
          deal_id?: string | null
          expense_category?: string | null
          hometax_synced_at?: string | null
          id?: string
          issue_date: string
          item_name?: string | null
          journal_entry_id?: string | null
          label?: string | null
          modification_date?: string | null
          modification_reason?: string | null
          nts_confirm_no?: string | null
          nts_error_code?: string | null
          nts_error_message?: string | null
          nts_issue_status?: string
          nts_issued_at?: string | null
          nts_request_payload?: Json | null
          nts_response_payload?: Json | null
          original_invoice_id?: string | null
          partner_id?: string | null
          preferred_date?: string | null
          revenue_schedule_id?: string | null
          settled_amount?: number
          settlement_status?: string
          source?: string | null
          status?: string | null
          supply_amount: number
          tax_amount: number
          tax_kind?: string
          total_amount: number
          type: string
          updated_at?: string | null
        }
        Update: {
          auto_issued?: boolean | null
          company_id?: string
          counterparty_bizno?: string | null
          counterparty_business_item?: string | null
          counterparty_business_type?: string | null
          counterparty_email?: string | null
          counterparty_name?: string
          counterparty_representative?: string | null
          created_at?: string | null
          deal_id?: string | null
          expense_category?: string | null
          hometax_synced_at?: string | null
          id?: string
          issue_date?: string
          item_name?: string | null
          journal_entry_id?: string | null
          label?: string | null
          modification_date?: string | null
          modification_reason?: string | null
          nts_confirm_no?: string | null
          nts_error_code?: string | null
          nts_error_message?: string | null
          nts_issue_status?: string
          nts_issued_at?: string | null
          nts_request_payload?: Json | null
          nts_response_payload?: Json | null
          original_invoice_id?: string | null
          partner_id?: string | null
          preferred_date?: string | null
          revenue_schedule_id?: string | null
          settled_amount?: number
          settlement_status?: string
          source?: string | null
          status?: string | null
          supply_amount?: number
          tax_amount?: number
          tax_kind?: string
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
            foreignKeyName: "tax_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "tax_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "tax_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "tax_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "tax_invoices_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "tax_invoices_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
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
          balance_after: number | null
          bank_name: string | null
          category: string | null
          company_id: string | null
          counterparty: string | null
          created_at: string | null
          description: string | null
          external_id: string | null
          id: string
          mapping_status: string | null
          matched: boolean | null
          memo: string | null
          raw_data: Json | null
          source: string | null
          transaction_date: string | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          balance_after?: number | null
          bank_name?: string | null
          category?: string | null
          company_id?: string | null
          counterparty?: string | null
          created_at?: string | null
          description?: string | null
          external_id?: string | null
          id?: string
          mapping_status?: string | null
          matched?: boolean | null
          memo?: string | null
          raw_data?: Json | null
          source?: string | null
          transaction_date?: string | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          balance_after?: number | null
          bank_name?: string | null
          category?: string | null
          company_id?: string | null
          counterparty?: string | null
          created_at?: string | null
          description?: string | null
          external_id?: string | null
          id?: string
          mapping_status?: string | null
          matched?: boolean | null
          memo?: string | null
          raw_data?: Json | null
          source?: string | null
          transaction_date?: string | null
          type?: string | null
          updated_at?: string | null
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
      tx_category_options: {
        Row: {
          company_id: string
          created_at: string
          id: string
          kind: string
          name: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          kind: string
          name: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tx_category_options_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          company_id: string
          created_at: string | null
          dashboard_widgets: Json | null
          flow_settings: Json
          id: string
          pinned_pages: Json | null
          role_preset: string | null
          sidebar_collapsed: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          dashboard_widgets?: Json | null
          flow_settings?: Json
          id?: string
          pinned_pages?: Json | null
          role_preset?: string | null
          sidebar_collapsed?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          dashboard_widgets?: Json | null
          flow_settings?: Json
          id?: string
          pinned_pages?: Json | null
          role_preset?: string | null
          sidebar_collapsed?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_tab_access: {
        Row: {
          allowed: boolean
          company_id: string
          created_at: string
          granted_by: string | null
          id: string
          route: string
          user_id: string
        }
        Insert: {
          allowed?: boolean
          company_id: string
          created_at?: string
          granted_by?: string | null
          id?: string
          route: string
          user_id: string
        }
        Update: {
          allowed?: boolean
          company_id?: string
          created_at?: string
          granted_by?: string | null
          id?: string
          route?: string
          user_id?: string
        }
        Relationships: []
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
          billing_cycle: string | null
          billing_day: number | null
          category: string | null
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
          billing_cycle?: string | null
          billing_day?: number | null
          category?: string | null
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
          billing_cycle?: string | null
          billing_day?: number | null
          category?: string | null
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
          attachment_url: string | null
          company_id: string
          created_at: string | null
          depreciation_method: string | null
          id: string
          location: string | null
          name: string
          notes: string | null
          purchase_date: string | null
          status: string | null
          type: string
          useful_life_months: number | null
          value: number | null
        }
        Insert: {
          attachment_url?: string | null
          company_id: string
          created_at?: string | null
          depreciation_method?: string | null
          id?: string
          location?: string | null
          name: string
          notes?: string | null
          purchase_date?: string | null
          status?: string | null
          type: string
          useful_life_months?: number | null
          value?: number | null
        }
        Update: {
          attachment_url?: string | null
          company_id?: string
          created_at?: string | null
          depreciation_method?: string | null
          id?: string
          location?: string | null
          name?: string
          notes?: string | null
          purchase_date?: string | null
          status?: string | null
          type?: string
          useful_life_months?: number | null
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
          {
            foreignKeyName: "vault_docs_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "vault_docs_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "vault_docs_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "vault_docs_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "vault_docs_linked_deal_id_fkey"
            columns: ["linked_deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
      workflow_items: {
        Row: {
          archived_at: string | null
          assignee_id: string | null
          board_group_id: string | null
          column_values: Json
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          linked_project_id: string | null
          position: number
          status: string | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assignee_id?: string | null
          board_group_id?: string | null
          column_values?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          linked_project_id?: string | null
          position?: number
          status?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assignee_id?: string | null
          board_group_id?: string | null
          column_values?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          linked_project_id?: string | null
          position?: number
          status?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_items_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_items_board_group_id_fkey"
            columns: ["board_group_id"]
            isOneToOne: false
            referencedRelation: "board_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_items_linked_project_id_fkey"
            columns: ["linked_project_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_items_linked_project_id_fkey"
            columns: ["linked_project_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "workflow_items_linked_project_id_fkey"
            columns: ["linked_project_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "workflow_items_linked_project_id_fkey"
            columns: ["linked_project_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "workflow_items_linked_project_id_fkey"
            columns: ["linked_project_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "workflow_items_linked_project_id_fkey"
            columns: ["linked_project_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
      v_deal_goal_actual: {
        Row: {
          actual_amount: number | null
          deal_id: string | null
        }
        Relationships: []
      }
      v_deal_kpi_auto: {
        Row: {
          deal_id: string | null
          output_count: number | null
          profit_actual: number | null
          revenue_actual: number | null
        }
        Relationships: []
      }
      v_deal_pnl: {
        Row: {
          adjustment_cost: number | null
          company_id: string | null
          deal_id: string | null
          direct_cost: number | null
          direct_cost_ratio: number | null
          margin: number | null
          revenue: number | null
          voucher_cost: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_deal_revenue_actual: {
        Row: {
          actual_amount: number | null
          deal_id: string | null
        }
        Relationships: []
      }
      v_partner_ar_ap: {
        Row: {
          company_id: string | null
          invoice_count: number | null
          outstanding: number | null
          partner_id: string | null
          total_billed: number | null
          total_settled: number | null
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
          {
            foreignKeyName: "tax_invoices_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      v_project_margin: {
        Row: {
          actual_direct_cost: number | null
          actual_margin: number | null
          company_id: string | null
          deal_id: string | null
          main_revenue: number | null
          name: string | null
          planned_margin: number | null
          sub_purchase_planned: number | null
          sub_sales_planned: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_settlement_confirmed: {
        Row: {
          amount: number | null
          bank_transaction_id: string | null
          company_id: string | null
          confidence: number | null
          counterparty: string | null
          counterparty_name: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          invoice_amount: number | null
          invoice_type: string | null
          issue_date: string | null
          match_source: string | null
          match_type: string | null
          reason: string | null
          status: string | null
          tax_invoice_id: string | null
          transaction_date: string | null
          txn_amount: number | null
          txn_type: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_settlements_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_settlements_tax_invoice_id_fkey"
            columns: ["tax_invoice_id"]
            isOneToOne: false
            referencedRelation: "tax_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      v_settlement_review_queue: {
        Row: {
          amount: number | null
          bank_transaction_id: string | null
          company_id: string | null
          confidence: number | null
          counterparty: string | null
          counterparty_name: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          invoice_amount: number | null
          invoice_type: string | null
          issue_date: string | null
          match_source: string | null
          match_type: string | null
          reason: string | null
          status: string | null
          tax_invoice_id: string | null
          transaction_date: string | null
          txn_amount: number | null
          txn_type: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_settlements_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_settlements_tax_invoice_id_fkey"
            columns: ["tax_invoice_id"]
            isOneToOne: false
            referencedRelation: "tax_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      v_sub_deal_pnl: {
        Row: {
          actual_cost: number | null
          deal_id: string | null
          name: string | null
          partner_id: string | null
          planned_amount: number | null
          planned_cost: number | null
          planned_revenue: number | null
          sub_deal_id: string | null
          type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sub_deals_parent_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_deals_parent_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "sub_deals_parent_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "sub_deals_parent_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "sub_deals_parent_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "sub_deals_parent_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "sub_deals_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _seed_legal_allowances_internal: {
        Args: { p_company_id: string }
        Returns: number
      }
      approve_overtime: { Args: { p_request_id: string }; Returns: undefined }
      auto_clock_out_at_work_end: { Args: never; Returns: number }
      check_can_clock_in_after_hours: {
        Args: { p_employee_id: string }
        Returns: {
          allowed: boolean
          overtime_request_id: string
          reason: string
        }[]
      }
      close_invoice_balance: {
        Args: { p_amount?: number; p_invoice_id: string; p_reason: string }
        Returns: string
      }
      current_app_employee_id: { Args: never; Returns: string }
      current_app_user_email: { Args: never; Returns: string }
      current_app_user_id: { Args: never; Returns: string }
      current_employee_id: { Args: never; Returns: string }
      daily_db_integrity_check: { Args: never; Returns: Json }
      data_sync_floor: { Args: { p_company: string }; Returns: string }
      decrypt_credential: { Args: { p_ciphertext: string }; Returns: string }
      decrypt_json_credentials: { Args: { p_creds: Json }; Returns: Json }
      delete_document: { Args: { p_doc_id: string }; Returns: undefined }
      encrypt_credential: { Args: { p_plaintext: string }; Returns: string }
      encrypt_json_credentials: { Args: { p_creds: Json }; Returns: Json }
      find_auth_user_by_email: {
        Args: { p_email: string }
        Returns: {
          email: string
          id: string
          raw_user_meta_data: Json
        }[]
      }
      fn_process_invoice_queue: { Args: never; Returns: number }
      generate_approval_token: { Args: never; Returns: string }
      generate_monthly_leave_grants: {
        Args: { p_company_id?: string }
        Returns: number
      }
      generate_partner_portal_token: {
        Args: { p_partner_id: string }
        Returns: string
      }
      generate_settlement_suggestions: {
        Args: { p_end: string; p_start: string }
        Returns: Json
      }
      generate_voucher_drafts: { Args: { p_limit?: number }; Returns: Json }
      get_company_directory: {
        Args: never
        Returns: {
          department: string
          email: string
          hire_date: string
          id: string
          name: string
          phone: string
          position: string
          status: string
        }[]
      }
      get_company_overview: { Args: { p_company_id: string }; Returns: Json }
      get_company_plan_slug: { Args: never; Returns: string }
      get_contract_package_by_token: {
        Args: { p_token: string }
        Returns: Json
      }
      get_credential_key: { Args: never; Returns: string }
      get_my_assigned_deals: {
        Args: never
        Returns: {
          created_at: string
          id: string
          my_role: string
          name: string
          status: string
        }[]
      }
      get_my_company_id: { Args: never; Returns: string }
      get_my_email: { Args: never; Returns: string }
      get_owner_dashboard_summary: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      get_owner_project_trend: { Args: { p_period?: string }; Returns: Json }
      get_partner_ledger_by_year: {
        Args: { p_year: number }
        Returns: {
          invoice_count: number
          partner_id: string
          period_billed: number
          period_outstanding: number
          period_settled: number
          prior_outstanding: number
          type: string
        }[]
      }
      get_partner_portal_context: { Args: { p_token: string }; Returns: Json }
      get_poll_results: {
        Args: { p_post_id: string }
        Returns: {
          is_anonymous: boolean
          option_index: number
          vote_count: number
          voter_user_ids: string[]
        }[]
      }
      get_quote_approval_by_token: {
        Args: { p_token: string }
        Returns: {
          company_name: string
          company_representative: string
          contract_total: number
          deal_id: string
          deal_name: string
          decided_at: string
          decision_note: string
          expires_at: string
          id: string
          payload: Json
          recipient_email: string
          recipient_name: string
          sent_at: string
          stage: string
          status: string
        }[]
      }
      get_recent_send_failures_summary: {
        Args: { p_days?: number }
        Returns: {
          count: number
          error_code: string
          latest_failed_at: string
        }[]
      }
      get_signature_context_by_token: {
        Args: { p_sign_token: string }
        Returns: Json
      }
      get_signature_request_by_token: {
        Args: { p_token: string }
        Returns: Json
      }
      has_min_plan: { Args: { min_plan: string }; Returns: boolean }
      increment_share_view_count: {
        Args: { share_id_param: string }
        Returns: undefined
      }
      is_channel_member: {
        Args: { p_channel_id: string; p_user_id: string }
        Returns: boolean
      }
      is_company_admin: { Args: never; Returns: boolean }
      is_company_owner: { Args: never; Returns: boolean }
      is_partner_user: { Args: never; Returns: boolean }
      is_platform_operator: { Args: never; Returns: boolean }
      is_user_assigned_to_deal: {
        Args: { p_deal_id: string }
        Returns: boolean
      }
      link_invoice_partners: { Args: never; Returns: Json }
      list_send_failures_by_code: {
        Args: { p_days?: number; p_error_code: string }
        Returns: {
          batch_id: string | null
          company_id: string
          error_code: string
          error_message: string
          failed_at: string
          id: string
          partner_id: string | null
          recipient_email: string
          recipient_name: string | null
          retried: boolean
          retried_at: string | null
          retried_request_id: string | null
          send_type: string
          signature_request_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "signature_send_failures"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      log_signature_send_failure: {
        Args: {
          p_batch_id: string
          p_error_code: string
          p_error_message: string
          p_partner_id: string
          p_recipient_email: string
          p_recipient_name: string
          p_send_type: string
          p_signature_request_id: string
        }
        Returns: string
      }
      mark_attendance_late: {
        Args: {
          p_date: string
          p_employee_id: string
          p_is_holiday?: boolean
          p_is_late: boolean
          p_late_minutes: number
        }
        Returns: boolean
      }
      mark_dormant_deals: { Args: never; Returns: number }
      mark_failure_retried: {
        Args: { p_failure_id: string; p_new_request_id: string }
        Returns: undefined
      }
      mark_quote_approval_viewed: {
        Args: { p_token: string }
        Returns: boolean
      }
      mark_signature_viewed_by_token: {
        Args: { p_token: string }
        Returns: undefined
      }
      normalize_party_name: { Args: { t: string }; Returns: string }
      operator_dependencies_health: { Args: never; Returns: Json }
      operator_financial_averages: {
        Args: { p_month?: string }
        Returns: {
          avg_value: number
          label: string
          max_value: number
          median_value: number
          metric: string
          min_value: number
          p25_value: number
          p75_value: number
          sample_size: number
          stddev_value: number
        }[]
      }
      operator_financial_averages_by_industry: {
        Args: { p_industry?: string; p_month?: string }
        Returns: {
          avg_value: number
          label: string
          max_value: number
          median_value: number
          metric: string
          min_value: number
          p25_value: number
          p75_value: number
          sample_size: number
        }[]
      }
      operator_financial_months: {
        Args: never
        Returns: {
          company_count: number
          month: string
        }[]
      }
      operator_industry_distribution: {
        Args: never
        Returns: {
          company_count: number
          industry: string
        }[]
      }
      operator_list_actions: {
        Args: { p_hours?: number; p_limit?: number }
        Returns: {
          action: string
          actor_email: string
          actor_user_id: string
          context: Json
          created_at: string
          id: string
          target_id: string
          target_type: string
        }[]
      }
      operator_log_action: {
        Args: {
          p_action: string
          p_context?: Json
          p_target_id?: string
          p_target_type?: string
        }
        Returns: string
      }
      operator_recent_errors: {
        Args: { p_hours?: number; p_limit?: number }
        Returns: {
          company_id: string
          company_name: string
          context: Json
          created_at: string
          error_type: string
          id: string
          message: string
          resolved: boolean
          source: string
          stack: string
          url: string
          user_email: string
          user_name: string
        }[]
      }
      operator_resolve_error: {
        Args: { p_id: string; p_resolved?: boolean }
        Returns: boolean
      }
      operator_set_company_industry: {
        Args: { p_company_id: string; p_industry: string }
        Returns: Json
      }
      operator_unclassified_companies: {
        Args: never
        Returns: {
          business_number: string
          created_at: string
          id: string
          name: string
        }[]
      }
      operator_upsert_incident: {
        Args: {
          p_id?: string
          p_occurred_at?: string
          p_prevention?: string
          p_related_commit?: string
          p_resolved_at?: string
          p_root_cause?: string
          p_severity?: string
          p_symptoms?: string
          p_title?: string
        }
        Returns: Json
      }
      plan_rank: { Args: { slug: string }; Returns: number }
      portal_leave_message: {
        Args: { p_message: string; p_token: string }
        Returns: boolean
      }
      post_bank_voucher: {
        Args: {
          p_account_id: string
          p_bank_tx_id: string
          p_remember?: boolean
        }
        Returns: string
      }
      post_card_voucher: {
        Args: {
          p_account_id: string
          p_card_tx_id: string
          p_remember?: boolean
        }
        Returns: string
      }
      post_cash_voucher: {
        Args: {
          p_account_id: string
          p_cash_receipt_id: string
          p_remember?: boolean
        }
        Returns: string
      }
      post_invoice_voucher: {
        Args: {
          p_account_id: string
          p_remember?: boolean
          p_tax_invoice_id: string
        }
        Returns: string
      }
      recalculate_late_status_recent: {
        Args: { p_company_id?: string; p_days?: number }
        Returns: {
          demoted_to_present: number
          promoted_to_late: number
          updated_count: number
        }[]
      }
      recompute_bank_balances: { Args: { p_company: string }; Returns: number }
      recompute_monthly_financials: {
        Args: { p_company_id: string; p_from?: string; p_to?: string }
        Returns: Json
      }
      record_sync_run: { Args: { p_sync_type: string }; Returns: string }
      reject_overtime: {
        Args: { p_reason: string; p_request_id: string }
        Returns: undefined
      }
      request_overtime:
        | {
            Args: {
              p_reason: string
              p_requested_date: string
              p_requested_end_time: string
            }
            Returns: string
          }
        | {
            Args: {
              p_approver_id: string
              p_reason: string
              p_requested_date: string
              p_requested_end_time: string
            }
            Returns: string
          }
      resend_quote_approval: {
        Args: { p_payload?: Json; p_prev_id: string }
        Returns: string
      }
      reset_company_data: { Args: { p_company_id: string }; Returns: Json }
      save_manual_voucher: {
        Args: {
          p_description: string
          p_entry_date: string
          p_lines: Json
          p_voucher_type: string
        }
        Returns: string
      }
      save_signer_inputs_by_token: {
        Args: { p_inputs: Json; p_token: string }
        Returns: Json
      }
      seed_korean_legal_holidays: { Args: { p_year?: number }; Returns: number }
      seed_legal_allowances: { Args: { p_company_id: string }; Returns: number }
      set_attendance_minutes: {
        Args: {
          p_holiday_minutes: number
          p_is_holiday: boolean
          p_is_late: boolean
          p_late_minutes: number
          p_night_minutes: number
          p_overtime_minutes: number
          p_record_id: string
          p_regular_minutes: number
        }
        Returns: boolean
      }
      set_voucher_deal: {
        Args: { p_deal_id: string; p_entry_id: string; p_sub_deal_id?: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      stage_label_ko: { Args: { p_stage: string }; Returns: string }
      submit_our_signature: {
        Args: {
          p_approval_id: string
          p_fully_signed_contract_url?: string
          p_signature_data_url: string
          p_signature_method: string
          p_signed_contract_html?: string
        }
        Returns: Json
      }
      submit_our_signature_bulk: {
        Args: {
          p_apply_to?: string
          p_signature_data_url: string
          p_signature_method: string
          p_signature_request_ids: string[]
        }
        Returns: Json
      }
      submit_our_signature_for_request: {
        Args: {
          p_fully_signed_contract_url?: string
          p_our_signed_contract_html?: string
          p_signature_data_url: string
          p_signature_method: string
          p_signature_request_id: string
        }
        Returns: Json
      }
      submit_quote_decision: {
        Args: {
          p_decision: string
          p_note?: string
          p_signature_data_url?: string
          p_signature_method?: string
          p_signed_contract_html?: string
          p_signed_contract_url?: string
          p_signer_business_number?: string
          p_signer_company_name?: string
          p_signer_ip?: string
          p_signer_representative?: string
          p_signer_user_agent?: string
          p_token: string
        }
        Returns: Json
      }
      submit_signature_by_token: {
        Args: {
          p_ip?: string
          p_signature_data: Json
          p_signature_data_url?: string
          p_signature_method?: string
          p_signed_contract_html?: string
          p_token: string
        }
        Returns: Json
      }
      sync_my_monthly_leave_grants: { Args: never; Returns: number }
      update_manual_voucher: {
        Args: {
          p_description: string
          p_entry_date: string
          p_entry_id: string
          p_lines: Json
        }
        Returns: undefined
      }
      upsert_push_subscription: {
        Args: {
          p_auth: string
          p_company_id?: string
          p_endpoint: string
          p_p256dh: string
          p_user_agent?: string
        }
        Returns: undefined
      }
      voucher_confirm: { Args: { p_entry_id: string }; Returns: undefined }
      voucher_reject: { Args: { p_entry_id: string }; Returns: undefined }
      voucher_unconfirm: { Args: { p_entry_id: string }; Returns: undefined }
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
