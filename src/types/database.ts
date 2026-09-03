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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      _backup_company_20260810: {
        Row: {
          backed_up_at: string | null
          payload: Json | null
          tbl: string | null
        }
        Insert: {
          backed_up_at?: string | null
          payload?: Json | null
          tbl?: string | null
        }
        Update: {
          backed_up_at?: string | null
          payload?: Json | null
          tbl?: string | null
        }
        Relationships: []
      }
      _bak_doc_revisions_20260803: {
        Row: {
          author_id: string | null
          changes_json: Json | null
          comment: string | null
          created_at: string | null
          document_id: string | null
          id: string | null
          version: number | null
        }
        Insert: {
          author_id?: string | null
          changes_json?: Json | null
          comment?: string | null
          created_at?: string | null
          document_id?: string | null
          id?: string | null
          version?: number | null
        }
        Update: {
          author_id?: string | null
          changes_json?: Json | null
          comment?: string | null
          created_at?: string | null
          document_id?: string | null
          id?: string | null
          version?: number | null
        }
        Relationships: []
      }
      _bak_document_files_rollen_luke_20260824: {
        Row: {
          bucket: string | null
          category: string | null
          company_id: string | null
          created_at: string | null
          deal_id: string | null
          document_id: string | null
          file_name: string | null
          file_size: number | null
          file_url: string | null
          folder_id: string | null
          id: string | null
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
          company_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          document_id?: string | null
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          folder_id?: string | null
          id?: string | null
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
          company_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          document_id?: string | null
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          folder_id?: string | null
          id?: string | null
          mime_type?: string | null
          parent_file_id?: string | null
          storage_path?: string | null
          tags?: string[] | null
          updated_at?: string | null
          uploaded_by?: string | null
          vault_doc_id?: string | null
          version?: number | null
        }
        Relationships: []
      }
      _bak_documents_20260803: {
        Row: {
          _backed_up_at: string | null
          _deal_name: string | null
          amount: number | null
          auto_classified_type: string | null
          company_id: string | null
          content_json: Json | null
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
          id: string | null
          issued_at: string | null
          locked_at: string | null
          mime_type: string | null
          name: string | null
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
          _backed_up_at?: string | null
          _deal_name?: string | null
          amount?: number | null
          auto_classified_type?: string | null
          company_id?: string | null
          content_json?: Json | null
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
          id?: string | null
          issued_at?: string | null
          locked_at?: string | null
          mime_type?: string | null
          name?: string | null
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
          _backed_up_at?: string | null
          _deal_name?: string | null
          amount?: number | null
          auto_classified_type?: string | null
          company_id?: string | null
          content_json?: Json | null
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
          id?: string | null
          issued_at?: string | null
          locked_at?: string | null
          mime_type?: string | null
          name?: string | null
          partner_id?: string | null
          seal_applied?: boolean | null
          source_document_id?: string | null
          status?: string | null
          sub_deal_id?: string | null
          template_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: []
      }
      _bak_documents_20260803b: {
        Row: {
          _backed_up_at: string | null
          amount: number | null
          auto_classified_type: string | null
          company_id: string | null
          content_json: Json | null
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
          id: string | null
          issued_at: string | null
          locked_at: string | null
          mime_type: string | null
          name: string | null
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
          _backed_up_at?: string | null
          amount?: number | null
          auto_classified_type?: string | null
          company_id?: string | null
          content_json?: Json | null
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
          id?: string | null
          issued_at?: string | null
          locked_at?: string | null
          mime_type?: string | null
          name?: string | null
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
          _backed_up_at?: string | null
          amount?: number | null
          auto_classified_type?: string | null
          company_id?: string | null
          content_json?: Json | null
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
          id?: string | null
          issued_at?: string | null
          locked_at?: string | null
          mime_type?: string | null
          name?: string | null
          partner_id?: string | null
          seal_applied?: boolean | null
          source_document_id?: string | null
          status?: string | null
          sub_deal_id?: string | null
          template_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: []
      }
      _bak_error_logs_resolved_20260825: {
        Row: {
          bulk_resolved_at: string | null
          id: string | null
        }
        Insert: {
          bulk_resolved_at?: string | null
          id?: string | null
        }
        Update: {
          bulk_resolved_at?: string | null
          id?: string | null
        }
        Relationships: []
      }
      _bak_error_logs_resolved_20260826: {
        Row: {
          bulk_resolved_at: string | null
          id: string | null
          message: string | null
        }
        Insert: {
          bulk_resolved_at?: string | null
          id?: string | null
          message?: string | null
        }
        Update: {
          bulk_resolved_at?: string | null
          id?: string | null
          message?: string | null
        }
        Relationships: []
      }
      _bak_sigreq_doclink_20260803: {
        Row: {
          _backed_up_at: string | null
          document_id: string | null
          signature_request_id: string | null
          title: string | null
        }
        Insert: {
          _backed_up_at?: string | null
          document_id?: string | null
          signature_request_id?: string | null
          title?: string | null
        }
        Update: {
          _backed_up_at?: string | null
          document_id?: string | null
          signature_request_id?: string | null
          title?: string | null
        }
        Relationships: []
      }
      _cov_out: {
        Row: {
          n: number | null
          tbl: string | null
        }
        Insert: {
          n?: number | null
          tbl?: string | null
        }
        Update: {
          n?: number | null
          tbl?: string | null
        }
        Relationships: []
      }
      account_budgets: {
        Row: {
          account_id: string
          amount: number
          company_id: string
          id: string
          memo: string | null
          month: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          amount?: number
          company_id: string
          id?: string
          memo?: string | null
          month: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          amount?: number
          company_id?: string
          id?: string
          memo?: string | null
          month?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_budgets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_budgets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      account_deletions: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          role: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          role?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          role?: string | null
        }
        Relationships: []
      }
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
      active_sessions: {
        Row: {
          auth_id: string
          device_label: string | null
          session_id: string
          updated_at: string
        }
        Insert: {
          auth_id: string
          device_label?: string | null
          session_id: string
          updated_at?: string
        }
        Update: {
          auth_id?: string
          device_label?: string | null
          session_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ad_account_secrets: {
        Row: {
          ad_account_id: string
          api_key_enc: string | null
          api_secret_enc: string | null
          updated_at: string
        }
        Insert: {
          ad_account_id: string
          api_key_enc?: string | null
          api_secret_enc?: string | null
          updated_at?: string
        }
        Update: {
          ad_account_id?: string
          api_key_enc?: string | null
          api_secret_enc?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_account_secrets_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: true
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_accounts: {
        Row: {
          company_id: string
          created_at: string
          external_id: string
          id: string
          label: string
          last_synced_at: string | null
          platform: string
          status: string
          sync_error: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          external_id: string
          id?: string
          label: string
          last_synced_at?: string | null
          platform: string
          status?: string
          sync_error?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          external_id?: string
          id?: string
          label?: string
          last_synced_at?: string | null
          platform?: string
          status?: string
          sync_error?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_entities: {
        Row: {
          ad_account_id: string
          ad_type: string | null
          company_id: string
          daily_budget: number | null
          entity_id: string
          id: string
          image_url: string | null
          level: string
          link_url: string | null
          meta: Json | null
          name: string | null
          parent_id: string | null
          price: number | null
          status: string | null
          updated_at: string
        }
        Insert: {
          ad_account_id: string
          ad_type?: string | null
          company_id: string
          daily_budget?: number | null
          entity_id: string
          id?: string
          image_url?: string | null
          level: string
          link_url?: string | null
          meta?: Json | null
          name?: string | null
          parent_id?: string | null
          price?: number | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          ad_account_id?: string
          ad_type?: string | null
          company_id?: string
          daily_budget?: number | null
          entity_id?: string
          id?: string
          image_url?: string | null
          level?: string
          link_url?: string | null
          meta?: Json | null
          name?: string | null
          parent_id?: string | null
          price?: number | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_entities_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_entities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_metrics_daily: {
        Row: {
          ad_account_id: string
          campaign_id: string
          campaign_name: string | null
          clicks: number
          company_id: string
          conv_value: number
          conversions: number
          cost: number
          entity_id: string
          id: string
          impressions: number
          level: string
          platform: string
          raw: Json | null
          stat_date: string
          updated_at: string
        }
        Insert: {
          ad_account_id: string
          campaign_id: string
          campaign_name?: string | null
          clicks?: number
          company_id: string
          conv_value?: number
          conversions?: number
          cost?: number
          entity_id: string
          id?: string
          impressions?: number
          level?: string
          platform: string
          raw?: Json | null
          stat_date: string
          updated_at?: string
        }
        Update: {
          ad_account_id?: string
          campaign_id?: string
          campaign_name?: string | null
          clicks?: number
          company_id?: string
          conv_value?: number
          conversions?: number
          cost?: number
          entity_id?: string
          id?: string
          impressions?: number
          level?: string
          platform?: string
          raw?: Json | null
          stat_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_metrics_daily_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_metrics_daily_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      advisor_access_logs: {
        Row: {
          accessed_at: string
          advisor_id: string
          company_id: string
          id: string
        }
        Insert: {
          accessed_at?: string
          advisor_id: string
          company_id: string
          id?: string
        }
        Update: {
          accessed_at?: string
          advisor_id?: string
          company_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "advisor_access_logs_advisor_id_fkey"
            columns: ["advisor_id"]
            isOneToOne: false
            referencedRelation: "tax_advisors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advisor_access_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      advisor_active_company: {
        Row: {
          auth_id: string
          company_id: string
          updated_at: string
        }
        Insert: {
          auth_id: string
          company_id: string
          updated_at?: string
        }
        Update: {
          auth_id?: string
          company_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "advisor_active_company_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      advisor_company_links: {
        Row: {
          advisor_id: string
          company_id: string
          created_at: string
          id: string
          revoked_at: string | null
          status: string
        }
        Insert: {
          advisor_id: string
          company_id: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          status?: string
        }
        Update: {
          advisor_id?: string
          company_id?: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "advisor_company_links_advisor_id_fkey"
            columns: ["advisor_id"]
            isOneToOne: false
            referencedRelation: "tax_advisors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advisor_company_links_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      advisor_permissions: {
        Row: {
          granted_at: string
          link_id: string
          perm_key: string
        }
        Insert: {
          granted_at?: string
          link_id: string
          perm_key: string
        }
        Update: {
          granted_at?: string
          link_id?: string
          perm_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "advisor_permissions_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "advisor_company_links"
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
      ai_copilot_notes: {
        Row: {
          active: boolean
          company_id: string
          content: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          question: string | null
          source: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          company_id: string
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          question?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          company_id?: string
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          question?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_copilot_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_copilot_history: {
        Row: {
          answer: Json | null
          as_of: string | null
          company_id: string
          created_at: string | null
          id: string
          model: string | null
          query: string
          user_id: string | null
        }
        Insert: {
          answer?: Json | null
          as_of?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          model?: string | null
          query: string
          user_id?: string | null
        }
        Update: {
          answer?: Json | null
          as_of?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          model?: string | null
          query?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_copilot_history_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_copilot_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      ai_usage_log: {
        Row: {
          company_id: string
          cost_usd_estimate: number | null
          created_at: string
          error_code: string | null
          feature: string
          id: string
          input_tokens: number
          latency_ms: number | null
          model: string
          output_tokens: number
          prompt_version: string | null
          request_id: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          company_id: string
          cost_usd_estimate?: number | null
          created_at?: string
          error_code?: string | null
          feature: string
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model: string
          output_tokens?: number
          prompt_version?: string | null
          request_id?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          company_id?: string
          cost_usd_estimate?: number | null
          created_at?: string
          error_code?: string | null
          feature?: string
          id?: string
          input_tokens?: number
          latency_ms?: number | null
          model?: string
          output_tokens?: number
          prompt_version?: string | null
          request_id?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      allowance_entries_backup_20260728: {
        Row: {
          allowance_type_id: string | null
          amount: number | null
          backed_up_at: string | null
          calculated_minutes: number | null
          company_id: string | null
          count: number | null
          created_at: string | null
          edited_at: string | null
          edited_by: string | null
          employee_id: string | null
          id: string | null
          note: string | null
          payroll_month: string | null
          source: string | null
          updated_at: string | null
        }
        Insert: {
          allowance_type_id?: string | null
          amount?: number | null
          backed_up_at?: string | null
          calculated_minutes?: number | null
          company_id?: string | null
          count?: number | null
          created_at?: string | null
          edited_at?: string | null
          edited_by?: string | null
          employee_id?: string | null
          id?: string | null
          note?: string | null
          payroll_month?: string | null
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          allowance_type_id?: string | null
          amount?: number | null
          backed_up_at?: string | null
          calculated_minutes?: number | null
          company_id?: string | null
          count?: number | null
          created_at?: string | null
          edited_at?: string | null
          edited_by?: string | null
          employee_id?: string | null
          id?: string | null
          note?: string | null
          payroll_month?: string | null
          source?: string | null
          updated_at?: string | null
        }
        Relationships: []
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
      announcement_reads: {
        Row: {
          announcement_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          announcement_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          announcement_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcement_reads_announcement_id_fkey"
            columns: ["announcement_id"]
            isOneToOne: false
            referencedRelation: "announcements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcement_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
          attachments: string[]
          body: string
          company_id: string
          created_at: string | null
          id: string
          request_id: string
          user_id: string
        }
        Insert: {
          attachments?: string[]
          body: string
          company_id: string
          created_at?: string | null
          id?: string
          request_id: string
          user_id: string
        }
        Update: {
          attachments?: string[]
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
          {
            foreignKeyName: "approval_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_forms: {
        Row: {
          allow_requester_edit: boolean
          base_type: string | null
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
          base_type?: string | null
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
          base_type?: string | null
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
          requester_department: string | null
          requester_id: string | null
          requester_ids: string[] | null
          required_role: string | null
          rules: Json | null
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
          requester_department?: string | null
          requester_id?: string | null
          requester_ids?: string[] | null
          required_role?: string | null
          rules?: Json | null
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
          requester_department?: string | null
          requester_id?: string | null
          requester_ids?: string[] | null
          required_role?: string | null
          rules?: Json | null
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
      approval_request_views: {
        Row: {
          request_id: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          request_id: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          request_id?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_request_views_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_request_views_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
          deal_id: string | null
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
          deal_id?: string | null
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
          deal_id?: string | null
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
            foreignKeyName: "approval_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "approval_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "approval_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "approval_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "approval_requests_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
      attendance_backup_20260807: {
        Row: {
          attendance_type: string | null
          auto_clocked_out: boolean | null
          check_in: string | null
          check_out: string | null
          company_id: string | null
          created_at: string | null
          date: string | null
          edited_at: string | null
          edited_by: string | null
          employee_id: string | null
          holiday_minutes: number | null
          id: string | null
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
          auto_clocked_out?: boolean | null
          check_in?: string | null
          check_out?: string | null
          company_id?: string | null
          created_at?: string | null
          date?: string | null
          edited_at?: string | null
          edited_by?: string | null
          employee_id?: string | null
          holiday_minutes?: number | null
          id?: string | null
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
          auto_clocked_out?: boolean | null
          check_in?: string | null
          check_out?: string | null
          company_id?: string | null
          created_at?: string | null
          date?: string | null
          edited_at?: string | null
          edited_by?: string | null
          employee_id?: string | null
          holiday_minutes?: number | null
          id?: string | null
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
        Relationships: []
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
      attendance_edit_requests_backup_20260728: {
        Row: {
          attendance_record_id: string | null
          backed_up_at: string | null
          company_id: string | null
          created_at: string | null
          id: string | null
          reason: string | null
          requested_by: string | null
          requested_changes: Json | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
        }
        Insert: {
          attendance_record_id?: string | null
          backed_up_at?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          reason?: string | null
          requested_by?: string | null
          requested_changes?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
        }
        Update: {
          attendance_record_id?: string | null
          backed_up_at?: string | null
          company_id?: string | null
          created_at?: string | null
          id?: string | null
          reason?: string | null
          requested_by?: string | null
          requested_changes?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
        }
        Relationships: []
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
      attendance_records_backup_20260728: {
        Row: {
          backed_up_at: string | null
          check_in: string | null
          check_out: string | null
          company_id: string | null
          date: string | null
          employee_id: string | null
          id: string | null
          is_late: boolean | null
          late_minutes: number | null
          overtime_hours: number | null
          overtime_minutes: number | null
          regular_minutes: number | null
          status: string | null
          work_hours: number | null
        }
        Insert: {
          backed_up_at?: string | null
          check_in?: string | null
          check_out?: string | null
          company_id?: string | null
          date?: string | null
          employee_id?: string | null
          id?: string | null
          is_late?: boolean | null
          late_minutes?: number | null
          overtime_hours?: number | null
          overtime_minutes?: number | null
          regular_minutes?: number | null
          status?: string | null
          work_hours?: number | null
        }
        Update: {
          backed_up_at?: string | null
          check_in?: string | null
          check_out?: string | null
          company_id?: string | null
          date?: string | null
          employee_id?: string | null
          id?: string | null
          is_late?: boolean | null
          late_minutes?: number | null
          overtime_hours?: number | null
          overtime_minutes?: number | null
          regular_minutes?: number | null
          status?: string | null
          work_hours?: number | null
        }
        Relationships: []
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
      auth_users_backup_20260728: {
        Row: {
          backed_up_at: string | null
          created_at: string | null
          email: string | null
          id: string | null
          last_sign_in_at: string | null
          raw_app_meta_data: Json | null
          raw_user_meta_data: Json | null
        }
        Insert: {
          backed_up_at?: string | null
          created_at?: string | null
          email?: string | null
          id?: string | null
          last_sign_in_at?: string | null
          raw_app_meta_data?: Json | null
          raw_user_meta_data?: Json | null
        }
        Update: {
          backed_up_at?: string | null
          created_at?: string | null
          email?: string | null
          id?: string | null
          last_sign_in_at?: string | null
          raw_app_meta_data?: Json | null
          raw_user_meta_data?: Json | null
        }
        Relationships: []
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
      backup_20260805_token_unify: {
        Row: {
          body_before: string | null
          id: string | null
          kind: string | null
          name: string | null
          saved_at: string | null
        }
        Insert: {
          body_before?: string | null
          id?: string | null
          kind?: string | null
          name?: string | null
          saved_at?: string | null
        }
        Update: {
          body_before?: string | null
          id?: string | null
          kind?: string | null
          name?: string | null
          saved_at?: string | null
        }
        Relationships: []
      }
      backup_payment_batches_payroll_20260806: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          batch_type: string | null
          company_id: string | null
          created_at: string | null
          executed_at: string | null
          id: string | null
          item_count: number | null
          n8n_execution_id: string | null
          name: string | null
          status: string | null
          total_amount: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          batch_type?: string | null
          company_id?: string | null
          created_at?: string | null
          executed_at?: string | null
          id?: string | null
          item_count?: number | null
          n8n_execution_id?: string | null
          name?: string | null
          status?: string | null
          total_amount?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          batch_type?: string | null
          company_id?: string | null
          created_at?: string | null
          executed_at?: string | null
          id?: string | null
          item_count?: number | null
          n8n_execution_id?: string | null
          name?: string | null
          status?: string | null
          total_amount?: number | null
        }
        Relationships: []
      }
      backup_payment_queue_payroll_20260806: {
        Row: {
          amount: number | null
          approval_request_id: string | null
          approved_at: string | null
          approved_by: string | null
          attachments: string[] | null
          bank_account_id: string | null
          batch_id: string | null
          category: string | null
          comment: string | null
          company_id: string | null
          cost_schedule_id: string | null
          created_at: string | null
          deal_id: string | null
          description: string | null
          executed_at: string | null
          id: string | null
          is_recurring: boolean | null
          n8n_execution_id: string | null
          payment_type: string | null
          recipient_account: string | null
          recipient_bank: string | null
          recipient_name: string | null
          recurring_rule_id: string | null
          refund_reason: string | null
          refunded_at: string | null
          refunded_by: string | null
          status: string | null
          transfer_ref: string | null
        }
        Insert: {
          amount?: number | null
          approval_request_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachments?: string[] | null
          bank_account_id?: string | null
          batch_id?: string | null
          category?: string | null
          comment?: string | null
          company_id?: string | null
          cost_schedule_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          executed_at?: string | null
          id?: string | null
          is_recurring?: boolean | null
          n8n_execution_id?: string | null
          payment_type?: string | null
          recipient_account?: string | null
          recipient_bank?: string | null
          recipient_name?: string | null
          recurring_rule_id?: string | null
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          status?: string | null
          transfer_ref?: string | null
        }
        Update: {
          amount?: number | null
          approval_request_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachments?: string[] | null
          bank_account_id?: string | null
          batch_id?: string | null
          category?: string | null
          comment?: string | null
          company_id?: string | null
          cost_schedule_id?: string | null
          created_at?: string | null
          deal_id?: string | null
          description?: string | null
          executed_at?: string | null
          id?: string | null
          is_recurring?: boolean | null
          n8n_execution_id?: string | null
          payment_type?: string | null
          recipient_account?: string | null
          recipient_bank?: string | null
          recipient_name?: string | null
          recurring_rule_id?: string | null
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
          status?: string | null
          transfer_ref?: string | null
        }
        Relationships: []
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
          is_hidden: boolean
          is_primary: boolean | null
          memo: string | null
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
          is_hidden?: boolean
          is_primary?: boolean | null
          memo?: string | null
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
          is_hidden?: boolean
          is_primary?: boolean | null
          memo?: string | null
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
          ledger_excluded_reason: string | null
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
          ledger_excluded_reason?: string | null
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
          ledger_excluded_reason?: string | null
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
      billing_email_deliveries: {
        Row: {
          attempts: number
          company_id: string | null
          created_at: string
          id: string
          last_error: string | null
          notification_type: string
          recipient: string
          resend_email_id: string | null
          sent_at: string | null
          status: string
          stripe_event_id: string | null
          stripe_invoice_id: string | null
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          company_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          notification_type: string
          recipient: string
          resend_email_id?: string | null
          sent_at?: string | null
          status?: string
          stripe_event_id?: string | null
          stripe_invoice_id?: string | null
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          company_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          notification_type?: string
          recipient?: string
          resend_email_id?: string | null
          sent_at?: string | null
          status?: string
          stripe_event_id?: string | null
          stripe_invoice_id?: string | null
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_email_deliveries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      billing_seat_coupons: {
        Row: {
          company_id: string
          free_seats: number
          id: string
          issued_at: string
          redeemed_at: string | null
          redeemed_by: string | null
          source: string
          status: string
          stripe_subscription_id: string | null
        }
        Insert: {
          company_id: string
          free_seats?: number
          id?: string
          issued_at?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          source?: string
          status?: string
          stripe_subscription_id?: string | null
        }
        Update: {
          company_id?: string
          free_seats?: number
          id?: string
          issued_at?: string
          redeemed_at?: string | null
          redeemed_by?: string | null
          source?: string
          status?: string
          stripe_subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_seat_coupons_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_seat_coupons_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      biz_alert_rules: {
        Row: {
          company_id: string
          enabled: boolean
          id: string
          kind: string
          last_fired_on: string | null
          threshold: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          enabled?: boolean
          id?: string
          kind: string
          last_fired_on?: string | null
          threshold: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          enabled?: boolean
          id?: string
          kind?: string
          last_fired_on?: string | null
          threshold?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "biz_alert_rules_company_id_fkey"
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
          category: string | null
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
          category?: string | null
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
          category?: string | null
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
          ledger_excluded_reason: string | null
          mapped_at: string | null
          mapped_by: string | null
          mapping_status: string | null
          memo: string | null
          merchant_bizno: string | null
          merchant_category: string | null
          merchant_name: string | null
          raw_data: Json | null
          receipt_url: string | null
          source: string | null
          tags: string[] | null
          tax_invoice_id: string | null
          transaction_date: string
          transaction_time: string | null
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
          ledger_excluded_reason?: string | null
          mapped_at?: string | null
          mapped_by?: string | null
          mapping_status?: string | null
          memo?: string | null
          merchant_bizno?: string | null
          merchant_category?: string | null
          merchant_name?: string | null
          raw_data?: Json | null
          receipt_url?: string | null
          source?: string | null
          tags?: string[] | null
          tax_invoice_id?: string | null
          transaction_date: string
          transaction_time?: string | null
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
          ledger_excluded_reason?: string | null
          mapped_at?: string | null
          mapped_by?: string | null
          mapping_status?: string | null
          memo?: string | null
          merchant_bizno?: string | null
          merchant_category?: string | null
          merchant_name?: string | null
          raw_data?: Json | null
          receipt_url?: string | null
          source?: string | null
          tags?: string[] | null
          tax_invoice_id?: string | null
          transaction_date?: string
          transaction_time?: string | null
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
      channel_order_imports: {
        Row: {
          address: string | null
          amount: number | null
          buyer_name: string | null
          carrier: string | null
          channel: string
          channel_order_no: string
          company_id: string
          delivered_at: string | null
          doc_id: string | null
          id: string
          imported_at: string
          imported_by: string | null
          order_date: string | null
          recipient_name: string | null
          recipient_phone: string | null
          recipient_zip: string | null
          ship_status: string
          shipped_at: string | null
          shipped_by: string | null
          shipping_note: string | null
          tracking_no: string | null
        }
        Insert: {
          address?: string | null
          amount?: number | null
          buyer_name?: string | null
          carrier?: string | null
          channel: string
          channel_order_no: string
          company_id: string
          delivered_at?: string | null
          doc_id?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          order_date?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          recipient_zip?: string | null
          ship_status?: string
          shipped_at?: string | null
          shipped_by?: string | null
          shipping_note?: string | null
          tracking_no?: string | null
        }
        Update: {
          address?: string | null
          amount?: number | null
          buyer_name?: string | null
          carrier?: string | null
          channel?: string
          channel_order_no?: string
          company_id?: string
          delivered_at?: string | null
          doc_id?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          order_date?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          recipient_zip?: string | null
          ship_status?: string
          shipped_at?: string | null
          shipped_by?: string | null
          shipping_note?: string | null
          tracking_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_order_imports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_order_imports_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "stock_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_order_imports_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_order_imports_shipped_by_fkey"
            columns: ["shipped_by"]
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
      closing_snapshots: {
        Row: {
          bs: Json
          checklist_id: string | null
          company_id: string
          id: string
          month: string
          note: string | null
          pnl: Json
          taken_at: string
          taken_by: string | null
          totals: Json
        }
        Insert: {
          bs?: Json
          checklist_id?: string | null
          company_id: string
          id?: string
          month: string
          note?: string | null
          pnl?: Json
          taken_at?: string
          taken_by?: string | null
          totals?: Json
        }
        Update: {
          bs?: Json
          checklist_id?: string | null
          company_id?: string
          id?: string
          month?: string
          note?: string | null
          pnl?: Json
          taken_at?: string
          taken_by?: string | null
          totals?: Json
        }
        Relationships: [
          {
            foreignKeyName: "closing_snapshots_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "closing_checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "closing_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
          is_internal: boolean
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
          is_internal?: boolean
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
          is_internal?: boolean
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
      companies_backup_20260728: {
        Row: {
          address: string | null
          automation_settings: Json | null
          backed_up_at: string | null
          business_category: string | null
          business_number: string | null
          business_type: string | null
          cert_settings: Json | null
          created_at: string | null
          current_plan: string | null
          fax: string | null
          id: string | null
          industry: string | null
          logo_url: string | null
          name: string | null
          phone: string | null
          representative: string | null
          seal_url: string | null
          stripe_customer_id: string | null
          tax_settings: Json | null
          trial_ends_at: string | null
        }
        Insert: {
          address?: string | null
          automation_settings?: Json | null
          backed_up_at?: string | null
          business_category?: string | null
          business_number?: string | null
          business_type?: string | null
          cert_settings?: Json | null
          created_at?: string | null
          current_plan?: string | null
          fax?: string | null
          id?: string | null
          industry?: string | null
          logo_url?: string | null
          name?: string | null
          phone?: string | null
          representative?: string | null
          seal_url?: string | null
          stripe_customer_id?: string | null
          tax_settings?: Json | null
          trial_ends_at?: string | null
        }
        Update: {
          address?: string | null
          automation_settings?: Json | null
          backed_up_at?: string | null
          business_category?: string | null
          business_number?: string | null
          business_type?: string | null
          cert_settings?: Json | null
          created_at?: string | null
          current_plan?: string | null
          fax?: string | null
          id?: string | null
          industry?: string | null
          logo_url?: string | null
          name?: string | null
          phone?: string | null
          representative?: string | null
          seal_url?: string | null
          stripe_customer_id?: string | null
          tax_settings?: Json | null
          trial_ends_at?: string | null
        }
        Relationships: []
      }
      company_api_keys: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          key_encrypted: string
          key_hint: string | null
          last_error: string | null
          last_tested_at: string | null
          last_used_at: string | null
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_encrypted: string
          key_hint?: string | null
          last_error?: string | null
          last_tested_at?: string | null
          last_used_at?: string | null
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_encrypted?: string
          key_hint?: string | null
          last_error?: string | null
          last_tested_at?: string | null
          last_used_at?: string | null
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_api_keys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_insurance_rates: {
        Row: {
          company_id: string
          ei_emp: number
          ei_er: number
          hi_ceiling: number
          hi_emp: number
          hi_er: number
          hi_floor: number
          ia_rate: number
          id: string
          ltc_pct: number
          note: string | null
          np_ceiling: number
          np_emp: number
          np_er: number
          np_floor: number
          updated_at: string
          updated_by: string | null
          year: number
        }
        Insert: {
          company_id: string
          ei_emp: number
          ei_er: number
          hi_ceiling: number
          hi_emp: number
          hi_er: number
          hi_floor: number
          ia_rate: number
          id?: string
          ltc_pct: number
          note?: string | null
          np_ceiling: number
          np_emp: number
          np_er: number
          np_floor: number
          updated_at?: string
          updated_by?: string | null
          year: number
        }
        Update: {
          company_id?: string
          ei_emp?: number
          ei_er?: number
          hi_ceiling?: number
          hi_emp?: number
          hi_er?: number
          hi_floor?: number
          ia_rate?: number
          id?: string
          ltc_pct?: number
          note?: string | null
          np_ceiling?: number
          np_emp?: number
          np_er?: number
          np_floor?: number
          updated_at?: string
          updated_by?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_insurance_rates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
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
          delivery_error: string | null
          delivery_status: string | null
          email_sent_at: string | null
          expires_at: string
          granted_role: string | null
          id: string
          last_result_email_type: string | null
          message: string | null
          rejection_reason: string | null
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
          delivery_error?: string | null
          delivery_status?: string | null
          email_sent_at?: string | null
          expires_at?: string
          granted_role?: string | null
          id?: string
          last_result_email_type?: string | null
          message?: string | null
          rejection_reason?: string | null
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
          delivery_error?: string | null
          delivery_status?: string | null
          email_sent_at?: string | null
          expires_at?: string
          granted_role?: string | null
          id?: string
          last_result_email_type?: string | null
          message?: string | null
          rejection_reason?: string | null
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
      company_profile_ext: {
        Row: {
          certifications: string[]
          company_id: string
          has_export: boolean | null
          interests: string[]
          ksic_main: string | null
          open_date: string | null
          prior_grants: Json
          size_class: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          certifications?: string[]
          company_id: string
          has_export?: boolean | null
          interests?: string[]
          ksic_main?: string | null
          open_date?: string | null
          prior_grants?: Json
          size_class?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          certifications?: string[]
          company_id?: string
          has_export?: boolean | null
          interests?: string[]
          ksic_main?: string | null
          open_date?: string | null
          prior_grants?: Json
          size_class?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_profile_ext_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
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
          memo: string | null
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
          memo?: string | null
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
          memo?: string | null
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
      credit_balances: {
        Row: {
          ai_tokens: number
          company_id: string
          issue_credits: number
          updated_at: string
        }
        Insert: {
          ai_tokens?: number
          company_id: string
          issue_credits?: number
          updated_at?: string
        }
        Update: {
          ai_tokens?: number
          company_id?: string
          issue_credits?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_balances_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_purchases: {
        Row: {
          amount_krw: number
          company_id: string
          created_at: string
          id: string
          kind: string
          paid_at: string | null
          provider: string
          provider_ref: string | null
          quantity: number
          status: string
        }
        Insert: {
          amount_krw: number
          company_id: string
          created_at?: string
          id?: string
          kind: string
          paid_at?: string | null
          provider?: string
          provider_ref?: string | null
          quantity: number
          status?: string
        }
        Update: {
          amount_krw?: number
          company_id?: string
          created_at?: string
          id?: string
          kind?: string
          paid_at?: string | null
          provider?: string
          provider_ref?: string | null
          quantity?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_purchases_company_id_fkey"
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
      deal_ad_accounts: {
        Row: {
          ad_account_id: string
          company_id: string
          created_at: string
          deal_id: string
        }
        Insert: {
          ad_account_id: string
          company_id: string
          created_at?: string
          deal_id: string
        }
        Update: {
          ad_account_id?: string
          company_id?: string
          created_at?: string
          deal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_ad_accounts_ad_account_id_fkey"
            columns: ["ad_account_id"]
            isOneToOne: false
            referencedRelation: "ad_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_ad_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_ad_accounts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_ad_accounts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_ad_accounts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_ad_accounts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_ad_accounts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_ad_accounts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
          item_stages: Json | null
          last_activity_at: string | null
          name: string
          next_action_text: string | null
          parent_deal_id: string | null
          partner_company_id: string | null
          partner_id: string | null
          priority: string | null
          program_id: string | null
          risk_level: string | null
          stage: string | null
          start_date: string | null
          status: string | null
          target_amount: number | null
          target_label: string | null
          target_unit: string | null
          v3_builtin: Json | null
          v3_features: Json | null
          v3_views: Json | null
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
          item_stages?: Json | null
          last_activity_at?: string | null
          name: string
          next_action_text?: string | null
          parent_deal_id?: string | null
          partner_company_id?: string | null
          partner_id?: string | null
          priority?: string | null
          program_id?: string | null
          risk_level?: string | null
          stage?: string | null
          start_date?: string | null
          status?: string | null
          target_amount?: number | null
          target_label?: string | null
          target_unit?: string | null
          v3_builtin?: Json | null
          v3_features?: Json | null
          v3_views?: Json | null
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
          item_stages?: Json | null
          last_activity_at?: string | null
          name?: string
          next_action_text?: string | null
          parent_deal_id?: string | null
          partner_company_id?: string | null
          partner_id?: string | null
          priority?: string | null
          program_id?: string | null
          risk_level?: string | null
          stage?: string | null
          start_date?: string | null
          status?: string | null
          target_amount?: number | null
          target_label?: string | null
          target_unit?: string | null
          v3_builtin?: Json | null
          v3_features?: Json | null
          v3_views?: Json | null
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
      doc_templates_backup_20260728: {
        Row: {
          backed_up_at: string | null
          category: string | null
          company_id: string | null
          content_json: Json | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          is_custom: boolean | null
          name: string | null
          type: string | null
          variables: Json | null
          version: number | null
        }
        Insert: {
          backed_up_at?: string | null
          category?: string | null
          company_id?: string | null
          content_json?: Json | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          is_custom?: boolean | null
          name?: string | null
          type?: string | null
          variables?: Json | null
          version?: number | null
        }
        Update: {
          backed_up_at?: string | null
          category?: string | null
          company_id?: string | null
          content_json?: Json | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          is_custom?: boolean | null
          name?: string | null
          type?: string | null
          variables?: Json | null
          version?: number | null
        }
        Relationships: []
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
          created_by: string | null
          id: string
          name: string
          parent_id: string | null
          target_departments: string[]
          target_user_ids: string[]
          updated_at: string | null
          visibility: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          parent_id?: string | null
          target_departments?: string[]
          target_user_ids?: string[]
          updated_at?: string | null
          visibility?: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          target_departments?: string[]
          target_user_ids?: string[]
          updated_at?: string | null
          visibility?: string
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
            foreignKeyName: "document_folders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      employee_rrn: {
        Row: {
          company_id: string
          employee_id: string
          rrn_enc: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          employee_id: string
          rrn_enc: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          employee_id?: string
          rrn_enc?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_rrn_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_rrn_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_rrn_access_log: {
        Row: {
          action: string
          company_id: string
          created_at: string
          employee_ids: string[]
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          company_id: string
          created_at?: string
          employee_ids?: string[]
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string
          created_at?: string
          employee_ids?: string[]
          id?: string
          user_id?: string | null
        }
        Relationships: []
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
          dup_count: number
          error_type: string | null
          id: string
          last_seen_at: string | null
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
          dup_count?: number
          error_type?: string | null
          id?: string
          last_seen_at?: string | null
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
          dup_count?: number
          error_type?: string | null
          id?: string
          last_seen_at?: string | null
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
      feature_rollout: {
        Row: {
          company_id: string | null
          created_at: string
          feature: string
          note: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          feature: string
          note?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          feature?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_rollout_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      fixed_asset_depreciations: {
        Row: {
          amount: number
          asset_id: string
          company_id: string
          created_at: string
          id: string
          journal_entry_id: string | null
          month: string
        }
        Insert: {
          amount: number
          asset_id: string
          company_id: string
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          month: string
        }
        Update: {
          amount?: number
          asset_id?: string
          company_id?: string
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          month?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_asset_depreciations_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_asset_depreciations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_asset_depreciations_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_assets: {
        Row: {
          accum_account_id: string | null
          acquired_on: string
          asset_account_id: string | null
          category: string
          company_id: string
          cost: number
          created_at: string
          created_by: string | null
          depr_start_month: string
          disposal_amount: number | null
          disposed_on: string | null
          expense_account_id: string | null
          id: string
          memo: string | null
          method: string
          name: string
          salvage: number
          status: string
          updated_at: string
          useful_months: number
        }
        Insert: {
          accum_account_id?: string | null
          acquired_on: string
          asset_account_id?: string | null
          category?: string
          company_id: string
          cost: number
          created_at?: string
          created_by?: string | null
          depr_start_month: string
          disposal_amount?: number | null
          disposed_on?: string | null
          expense_account_id?: string | null
          id?: string
          memo?: string | null
          method?: string
          name: string
          salvage?: number
          status?: string
          updated_at?: string
          useful_months: number
        }
        Update: {
          accum_account_id?: string | null
          acquired_on?: string
          asset_account_id?: string | null
          category?: string
          company_id?: string
          cost?: number
          created_at?: string
          created_by?: string | null
          depr_start_month?: string
          disposal_amount?: number | null
          disposed_on?: string | null
          expense_account_id?: string | null
          id?: string
          memo?: string | null
          method?: string
          name?: string
          salvage?: number
          status?: string
          updated_at?: string
          useful_months?: number
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_accum_account_id_fkey"
            columns: ["accum_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_asset_account_id_fkey"
            columns: ["asset_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_expense_account_id_fkey"
            columns: ["expense_account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
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
      form_layouts: {
        Row: {
          company_id: string
          field_id: string
          form_key: string
          id: string
          is_custom: boolean
          is_on: boolean
          name: string
          section: string
          sort_no: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          field_id: string
          form_key: string
          id?: string
          is_custom?: boolean
          is_on?: boolean
          name: string
          section: string
          sort_no?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          field_id?: string
          form_key?: string
          id?: string
          is_custom?: boolean
          is_on?: boolean
          name?: string
          section?: string
          sort_no?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_layouts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_layouts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      gov_program_saved: {
        Row: {
          assignee_id: string | null
          company_id: string
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          memo: string | null
          program_id: string
          status: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          memo?: string | null
          program_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          memo?: string | null
          program_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gov_program_saved_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gov_program_saved_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "gov_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      gov_programs: {
        Row: {
          amount_max: number | null
          amount_text: string | null
          apply_end: string | null
          apply_start: string | null
          created_at: string
          detail_url: string | null
          eligibility: Json
          external_id: string | null
          field: string | null
          id: string
          org: string | null
          required_docs: string[]
          requirement: string | null
          rule_key: string | null
          sort_order: number
          source: string
          status: string
          summary: string | null
          support_type: string | null
          title: string
          updated_at: string
        }
        Insert: {
          amount_max?: number | null
          amount_text?: string | null
          apply_end?: string | null
          apply_start?: string | null
          created_at?: string
          detail_url?: string | null
          eligibility?: Json
          external_id?: string | null
          field?: string | null
          id?: string
          org?: string | null
          required_docs?: string[]
          requirement?: string | null
          rule_key?: string | null
          sort_order?: number
          source?: string
          status?: string
          summary?: string | null
          support_type?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          amount_max?: number | null
          amount_text?: string | null
          apply_end?: string | null
          apply_start?: string | null
          created_at?: string
          detail_url?: string | null
          eligibility?: Json
          external_id?: string | null
          field?: string | null
          id?: string
          org?: string | null
          required_docs?: string[]
          requirement?: string | null
          rule_key?: string | null
          sort_order?: number
          source?: string
          status?: string
          summary?: string | null
          support_type?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      gov_sync_log: {
        Row: {
          closed: number | null
          fetched: number | null
          finished_at: string | null
          id: string
          message: string | null
          ok: boolean | null
          source: string
          started_at: string
          upserted: number | null
        }
        Insert: {
          closed?: number | null
          fetched?: number | null
          finished_at?: string | null
          id?: string
          message?: string | null
          ok?: boolean | null
          source: string
          started_at?: string
          upserted?: number | null
        }
        Update: {
          closed?: number | null
          fetched?: number | null
          finished_at?: string | null
          id?: string
          message?: string | null
          ok?: boolean | null
          source?: string
          started_at?: string
          upserted?: number | null
        }
        Relationships: []
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
      hr_appointments: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          department: string | null
          effective_date: string
          employee_id: string
          id: string
          kind: string
          position: string | null
          reason: string | null
          salary: number | null
          source: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          department?: string | null
          effective_date: string
          employee_id: string
          id?: string
          kind: string
          position?: string | null
          reason?: string | null
          salary?: number | null
          source?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          department?: string | null
          effective_date?: string
          employee_id?: string
          id?: string
          kind?: string
          position?: string | null
          reason?: string | null
          salary?: number | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_appointments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_appointments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
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
          viewed_at: string | null
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
          viewed_at?: string | null
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
          viewed_at?: string | null
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
      insurance_notices: {
        Row: {
          company_id: string
          ei: number
          hi: number
          ia: number
          id: string
          month: string
          note: string | null
          np: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          ei?: number
          hi?: number
          ia?: number
          id?: string
          month: string
          note?: string | null
          np?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          ei?: number
          hi?: number
          ia?: number
          id?: string
          month?: string
          note?: string | null
          np?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_notices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      ium_reset_backup_20260728: {
        Row: {
          kind: string | null
          row_data: Json | null
        }
        Insert: {
          kind?: string | null
          row_data?: Json | null
        }
        Update: {
          kind?: string | null
          row_data?: Json | null
        }
        Relationships: []
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
          entry_kind: string
          id: string
          is_approved: boolean
          is_electronic: boolean
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
          supply_amount: number | null
          updated_at: string
          vat_amount: number | null
          vat_type: string | null
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
          entry_kind?: string
          id?: string
          is_approved?: boolean
          is_electronic?: boolean
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
          supply_amount?: number | null
          updated_at?: string
          vat_amount?: number | null
          vat_type?: string | null
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
          entry_kind?: string
          id?: string
          is_approved?: boolean
          is_electronic?: boolean
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
          supply_amount?: number | null
          updated_at?: string
          vat_amount?: number | null
          vat_type?: string | null
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
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
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
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
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
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
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
      marketing_events: {
        Row: {
          created_at: string
          event: string
          id: string
          params: Json
          path: string | null
          referrer: string | null
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          params?: Json
          path?: string | null
          referrer?: string | null
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          params?: Json
          path?: string | null
          referrer?: string | null
        }
        Relationships: []
      }
      member_permissions: {
        Row: {
          company_id: string
          granted_at: string
          granted_by: string | null
          id: string
          perm_key: string
          user_id: string
        }
        Insert: {
          company_id: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          perm_key: string
          user_id: string
        }
        Update: {
          company_id?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          perm_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_permissions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_permissions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_tax_types: {
        Row: {
          bizno: string
          checked_at: string
          company_id: string
          kind: string | null
          status: string | null
          tax_type: string | null
        }
        Insert: {
          bizno: string
          checked_at?: string
          company_id: string
          kind?: string | null
          status?: string | null
          tax_type?: string | null
        }
        Update: {
          bizno?: string
          checked_at?: string
          company_id?: string
          kind?: string | null
          status?: string | null
          tax_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "merchant_tax_types_company_id_fkey"
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
      notification_logs: {
        Row: {
          body: string | null
          channel: string
          company_id: string | null
          created_at: string
          error_message: string | null
          external_id: string | null
          id: string
          metadata: Json | null
          recipient: string
          status: string
          template_code: string | null
          title: string | null
        }
        Insert: {
          body?: string | null
          channel: string
          company_id?: string | null
          created_at?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          metadata?: Json | null
          recipient: string
          status?: string
          template_code?: string | null
          title?: string | null
        }
        Update: {
          body?: string | null
          channel?: string
          company_id?: string | null
          created_at?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          metadata?: Json | null
          recipient?: string
          status?: string
          template_code?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_company_id_fkey"
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
      order_lines: {
        Row: {
          company_id: string
          created_at: string
          custom: Json
          id: string
          note: string | null
          order_id: string
          product_id: string
          qty: number
          sort_no: number
          supply_amount: number
          unit_price: number | null
          vat_amount: number
        }
        Insert: {
          company_id: string
          created_at?: string
          custom?: Json
          id?: string
          note?: string | null
          order_id: string
          product_id: string
          qty: number
          sort_no?: number
          supply_amount?: number
          unit_price?: number | null
          vat_amount?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          custom?: Json
          id?: string
          note?: string | null
          order_id?: string
          product_id?: string
          qty?: number
          sort_no?: number
          supply_amount?: number
          unit_price?: number | null
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          custom: Json
          deal_id: string | null
          due_date: string | null
          id: string
          note: string | null
          order_date: string
          order_no: string
          partner_id: string | null
          partner_name: string | null
          status: string
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          custom?: Json
          deal_id?: string | null
          due_date?: string | null
          id?: string
          note?: string | null
          order_date?: string
          order_no: string
          partner_id?: string | null
          partner_name?: string | null
          status?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          custom?: Json
          deal_id?: string | null
          due_date?: string | null
          id?: string
          note?: string | null
          order_date?: string
          order_no?: string
          partner_id?: string | null
          partner_name?: string | null
          status?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "orders_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
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
      page_views: {
        Row: {
          company_id: string | null
          created_at: string
          id: number
          is_auth: boolean
          is_internal: boolean
          path: string
          referrer_host: string | null
          visitor_key: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: number
          is_auth?: boolean
          is_internal?: boolean
          path: string
          referrer_host?: string | null
          visitor_key: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: number
          is_auth?: boolean
          is_internal?: boolean
          path?: string
          referrer_host?: string | null
          visitor_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "page_views_company_id_fkey"
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
      partner_prices: {
        Row: {
          company_id: string
          id: string
          last_doc_id: string | null
          partner_id: string
          product_id: string
          side: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          company_id: string
          id?: string
          last_doc_id?: string | null
          partner_id: string
          product_id: string
          side: string
          unit_price: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          id?: string
          last_doc_id?: string | null
          partner_id?: string
          product_id?: string
          side?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_prices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_prices_last_doc_id_fkey"
            columns: ["last_doc_id"]
            isOneToOne: false
            referencedRelation: "stock_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_prices_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
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
          refund_reason: string | null
          refunded_at: string | null
          refunded_by: string | null
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
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
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
          refund_reason?: string | null
          refunded_at?: string | null
          refunded_by?: string | null
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
          {
            foreignKeyName: "payment_queue_refunded_by_fkey"
            columns: ["refunded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_items: {
        Row: {
          bank_account: string | null
          bank_name: string | null
          base_salary: number
          batch_id: string | null
          company_id: string | null
          created_at: string | null
          deductions_total: number | null
          employee_id: string
          employment_insurance: number | null
          extras: Json | null
          health_insurance: number | null
          id: string
          income_tax: number | null
          issued_at: string | null
          local_income_tax: number | null
          long_term_care_insurance: number | null
          national_pension: number | null
          net_pay: number
          non_taxable_amount: number
          period_month: string | null
          status: string | null
        }
        Insert: {
          bank_account?: string | null
          bank_name?: string | null
          base_salary?: number
          batch_id?: string | null
          company_id?: string | null
          created_at?: string | null
          deductions_total?: number | null
          employee_id: string
          employment_insurance?: number | null
          extras?: Json | null
          health_insurance?: number | null
          id?: string
          income_tax?: number | null
          issued_at?: string | null
          local_income_tax?: number | null
          long_term_care_insurance?: number | null
          national_pension?: number | null
          net_pay?: number
          non_taxable_amount?: number
          period_month?: string | null
          status?: string | null
        }
        Update: {
          bank_account?: string | null
          bank_name?: string | null
          base_salary?: number
          batch_id?: string | null
          company_id?: string | null
          created_at?: string | null
          deductions_total?: number | null
          employee_id?: string
          employment_insurance?: number | null
          extras?: Json | null
          health_insurance?: number | null
          id?: string
          income_tax?: number | null
          issued_at?: string | null
          local_income_tax?: number | null
          long_term_care_insurance?: number | null
          national_pension?: number | null
          net_pay?: number
          non_taxable_amount?: number
          period_month?: string | null
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
            foreignKeyName: "payroll_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      permission_templates: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          perm_keys: string[]
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          perm_keys?: string[]
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          perm_keys?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      product_boms: {
        Row: {
          base_qty: number
          company_id: string
          component_id: string
          created_at: string
          id: string
          note: string | null
          product_id: string
          qty: number
          updated_at: string
        }
        Insert: {
          base_qty?: number
          company_id: string
          component_id: string
          created_at?: string
          id?: string
          note?: string | null
          product_id: string
          qty: number
          updated_at?: string
        }
        Update: {
          base_qty?: number
          company_id?: string
          component_id?: string
          created_at?: string
          id?: string
          note?: string | null
          product_id?: string
          qty?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_boms_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_boms_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_boms_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_channel_codes: {
        Row: {
          channel: string
          channel_product_id: string
          channel_product_name: string | null
          channel_sku: string | null
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          product_id: string
          updated_at: string
        }
        Insert: {
          channel: string
          channel_product_id: string
          channel_product_name?: string | null
          channel_sku?: string | null
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          product_id: string
          updated_at?: string
        }
        Update: {
          channel?: string
          channel_product_id?: string
          channel_product_name?: string | null
          channel_sku?: string | null
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_channel_codes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_channel_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      production_voucher_drafts: {
        Row: {
          amount_cogs: number
          amount_loss: number
          amount_material: number
          amount_product_valued: number
          amount_scrap: number
          company_id: string
          created_at: string
          doc_ids: string[]
          id: string
          journal_entry_id: string | null
          kind: string
          memo: string | null
          period_from: string
          period_to: string
          skipped_lines: number
          status: string
          updated_at: string
        }
        Insert: {
          amount_cogs?: number
          amount_loss?: number
          amount_material?: number
          amount_product_valued?: number
          amount_scrap?: number
          company_id: string
          created_at?: string
          doc_ids?: string[]
          id?: string
          journal_entry_id?: string | null
          kind?: string
          memo?: string | null
          period_from: string
          period_to: string
          skipped_lines?: number
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cogs?: number
          amount_loss?: number
          amount_material?: number
          amount_product_valued?: number
          amount_scrap?: number
          company_id?: string
          created_at?: string
          doc_ids?: string[]
          id?: string
          journal_entry_id?: string | null
          kind?: string
          memo?: string | null
          period_from?: string
          period_to?: string
          skipped_lines?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_voucher_drafts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_voucher_drafts_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          auto_suggest: boolean
          barcode: string | null
          category: string | null
          company_id: string
          cost_price: number | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          lead_time_days: number
          memo: string | null
          name: string
          overhead_per_unit: number
          safety_stock: number | null
          sale_price: number | null
          sku: string
          spec: string | null
          track_stock: boolean
          unit: string
          updated_at: string
        }
        Insert: {
          auto_suggest?: boolean
          barcode?: string | null
          category?: string | null
          company_id: string
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number
          memo?: string | null
          name: string
          overhead_per_unit?: number
          safety_stock?: number | null
          sale_price?: number | null
          sku: string
          spec?: string | null
          track_stock?: boolean
          unit?: string
          updated_at?: string
        }
        Update: {
          auto_suggest?: boolean
          barcode?: string | null
          category?: string | null
          company_id?: string
          cost_price?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number
          memo?: string | null
          name?: string
          overhead_per_unit?: number
          safety_stock?: number | null
          sale_price?: number | null
          sku?: string
          spec?: string | null
          track_stock?: boolean
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      project_board_columns: {
        Row: {
          archived_at: string | null
          board_id: string
          created_at: string
          id: string
          name: string
          position: number
          settings: Json
          type: string
        }
        Insert: {
          archived_at?: string | null
          board_id: string
          created_at?: string
          id?: string
          name: string
          position?: number
          settings?: Json
          type?: string
        }
        Update: {
          archived_at?: string | null
          board_id?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
          settings?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_board_columns_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "project_boards"
            referencedColumns: ["id"]
          },
        ]
      }
      project_board_groups: {
        Row: {
          archived_at: string | null
          board_id: string
          color: string
          created_at: string
          id: string
          name: string
          position: number
        }
        Insert: {
          archived_at?: string | null
          board_id: string
          color?: string
          created_at?: string
          id?: string
          name: string
          position?: number
        }
        Update: {
          archived_at?: string | null
          board_id?: string
          color?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_board_groups_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "project_boards"
            referencedColumns: ["id"]
          },
        ]
      }
      project_board_item_notes: {
        Row: {
          body: string | null
          company_id: string
          created_at: string
          file_name: string | null
          file_url: string | null
          id: string
          item_id: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          company_id: string
          created_at?: string
          file_name?: string | null
          file_url?: string | null
          id?: string
          item_id: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          company_id?: string
          created_at?: string
          file_name?: string | null
          file_url?: string | null
          id?: string
          item_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_board_item_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_board_item_notes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "project_board_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_board_item_notes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      project_board_items: {
        Row: {
          archived_at: string | null
          board_id: string
          created_at: string
          group_id: string | null
          id: string
          name: string
          parent_item_id: string | null
          position: number
          updated_at: string
          values: Json
        }
        Insert: {
          archived_at?: string | null
          board_id: string
          created_at?: string
          group_id?: string | null
          id?: string
          name?: string
          parent_item_id?: string | null
          position?: number
          updated_at?: string
          values?: Json
        }
        Update: {
          archived_at?: string | null
          board_id?: string
          created_at?: string
          group_id?: string | null
          id?: string
          name?: string
          parent_item_id?: string | null
          position?: number
          updated_at?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "project_board_items_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "project_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_board_items_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "project_board_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_board_items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "project_board_items"
            referencedColumns: ["id"]
          },
        ]
      }
      project_board_presets: {
        Row: {
          archived_at: string | null
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          name: string
          payload: Json
          template_key: string | null
        }
        Insert: {
          archived_at?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          name: string
          payload?: Json
          template_key?: string | null
        }
        Update: {
          archived_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          name?: string
          payload?: Json
          template_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_board_presets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      project_boards: {
        Row: {
          archived_at: string | null
          company_id: string
          created_at: string
          deal_id: string
          id: string
          name: string
          name_label: string | null
          name_pos: number | null
          position: number
          template_key: string | null
        }
        Insert: {
          archived_at?: string | null
          company_id: string
          created_at?: string
          deal_id: string
          id?: string
          name: string
          name_label?: string | null
          name_pos?: number | null
          position?: number
          template_key?: string | null
        }
        Update: {
          archived_at?: string | null
          company_id?: string
          created_at?: string
          deal_id?: string
          id?: string
          name?: string
          name_label?: string | null
          name_pos?: number | null
          position?: number
          template_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_boards_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_boards_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_boards_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_boards_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_boards_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_boards_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_boards_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
      project_item_checks: {
        Row: {
          company_id: string
          created_at: string
          done: boolean
          id: string
          item_id: string
          name: string
          position: number
        }
        Insert: {
          company_id: string
          created_at?: string
          done?: boolean
          id?: string
          item_id: string
          name: string
          position?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          done?: boolean
          id?: string
          item_id?: string
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_item_checks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_item_checks_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "project_items"
            referencedColumns: ["id"]
          },
        ]
      }
      project_item_columns: {
        Row: {
          archived_at: string | null
          company_id: string
          created_at: string
          deal_id: string
          id: string
          key: string
          name: string
          position: number
          settings: Json
          type: string
          width: number | null
        }
        Insert: {
          archived_at?: string | null
          company_id: string
          created_at?: string
          deal_id: string
          id?: string
          key: string
          name: string
          position?: number
          settings?: Json
          type: string
          width?: number | null
        }
        Update: {
          archived_at?: string | null
          company_id?: string
          created_at?: string
          deal_id?: string
          id?: string
          key?: string
          name?: string
          position?: number
          settings?: Json
          type?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_item_columns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_item_columns_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_item_columns_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_item_columns_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_item_columns_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_item_columns_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_item_columns_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      project_item_events: {
        Row: {
          body: string
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          kind: string
          mentions: string[]
          meta: Json
        }
        Insert: {
          body: string
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          kind?: string
          mentions?: string[]
          meta?: Json
        }
        Update: {
          body?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          kind?: string
          mentions?: string[]
          meta?: Json
        }
        Relationships: [
          {
            foreignKeyName: "project_item_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_item_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_item_events_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "project_items"
            referencedColumns: ["id"]
          },
        ]
      }
      project_items: {
        Row: {
          after_id: string | null
          archived_at: string | null
          assignee_id: string | null
          assignee_ids: string[]
          body: string | null
          company_id: string
          created_at: string
          created_by: string | null
          deal_id: string
          draft_ref: Json | null
          due_date: string | null
          fields: Json
          followers: string[]
          hours: number | null
          id: string
          is_milestone: boolean
          kind: string
          money_kind: string | null
          name: string
          parent_id: string | null
          partner_id: string | null
          partner_name: string | null
          plan_amount: number | null
          position: number
          priority: string | null
          recurrence: Json | null
          source_item_id: string | null
          start_date: string | null
          status: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          after_id?: string | null
          archived_at?: string | null
          assignee_id?: string | null
          assignee_ids?: string[]
          body?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          deal_id: string
          draft_ref?: Json | null
          due_date?: string | null
          fields?: Json
          followers?: string[]
          hours?: number | null
          id?: string
          is_milestone?: boolean
          kind: string
          money_kind?: string | null
          name?: string
          parent_id?: string | null
          partner_id?: string | null
          partner_name?: string | null
          plan_amount?: number | null
          position?: number
          priority?: string | null
          recurrence?: Json | null
          source_item_id?: string | null
          start_date?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          after_id?: string | null
          archived_at?: string | null
          assignee_id?: string | null
          assignee_ids?: string[]
          body?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string
          draft_ref?: Json | null
          due_date?: string | null
          fields?: Json
          followers?: string[]
          hours?: number | null
          id?: string
          is_milestone?: boolean
          kind?: string
          money_kind?: string | null
          name?: string
          parent_id?: string | null
          partner_id?: string | null
          partner_name?: string | null
          plan_amount?: number | null
          position?: number
          priority?: string | null
          recurrence?: Json | null
          source_item_id?: string | null
          start_date?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_items_after_id_fkey"
            columns: ["after_id"]
            isOneToOne: false
            referencedRelation: "project_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_items_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "project_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_items_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
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
      project_members: {
        Row: {
          added_via_department: string | null
          company_id: string
          created_at: string
          deal_id: string
          id: string
          user_id: string
        }
        Insert: {
          added_via_department?: string | null
          company_id: string
          created_at?: string
          deal_id: string
          id?: string
          user_id: string
        }
        Update: {
          added_via_department?: string | null
          company_id?: string
          created_at?: string
          deal_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_members_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_members_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_members_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_members_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
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
      project_surveys: {
        Row: {
          banner_path: string | null
          closes_at: string | null
          company_id: string
          created_at: string
          created_by: string | null
          deal_id: string
          enabled: boolean
          id: string
          image_paths: Json
          intro: string
          max_responses: number | null
          name_label: string
          prevent_dup: boolean
          questions: Json
          response_count: number
          target_stage: string
          title: string
          token: string
          updated_at: string
        }
        Insert: {
          banner_path?: string | null
          closes_at?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          deal_id: string
          enabled?: boolean
          id?: string
          image_paths?: Json
          intro?: string
          max_responses?: number | null
          name_label?: string
          prevent_dup?: boolean
          questions?: Json
          response_count?: number
          target_stage?: string
          title?: string
          token?: string
          updated_at?: string
        }
        Update: {
          banner_path?: string | null
          closes_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string
          enabled?: boolean
          id?: string
          image_paths?: Json
          intro?: string
          max_responses?: number | null
          name_label?: string
          prevent_dup?: boolean
          questions?: Json
          response_count?: number
          target_stage?: string
          title?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_surveys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_surveys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_surveys_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_surveys_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_surveys_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_surveys_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_surveys_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "project_surveys_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
          completed_at: string | null
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
          completed_at?: string | null
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
          completed_at?: string | null
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
      project_templates: {
        Row: {
          archived_at: string | null
          company_id: string
          created_at: string
          created_by: string | null
          icon: string
          id: string
          name: string
          spec: Json
        }
        Insert: {
          archived_at?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          icon?: string
          id?: string
          name: string
          spec?: Json
        }
        Update: {
          archived_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          icon?: string
          id?: string
          name?: string
          spec?: Json
        }
        Relationships: [
          {
            foreignKeyName: "project_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      quick_notes: {
        Row: {
          body: string
          color: string
          company_id: string
          created_at: string
          id: string
          pinned: boolean
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          color?: string
          company_id: string
          created_at?: string
          id?: string
          pinned?: boolean
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          color?: string
          company_id?: string
          created_at?: string
          id?: string
          pinned?: boolean
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quick_notes_user_id_fkey"
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
      recurring_dismissals: {
        Row: {
          company_id: string
          created_at: string
          dismissed_by: string | null
          id: string
          match_key: string
        }
        Insert: {
          company_id: string
          created_at?: string
          dismissed_by?: string | null
          id?: string
          match_key: string
        }
        Update: {
          company_id?: string
          created_at?: string
          dismissed_by?: string | null
          id?: string
          match_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_dismissals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_dismissals_dismissed_by_fkey"
            columns: ["dismissed_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      sales_code_redemptions: {
        Row: {
          applied_trial_days: number
          company_id: string
          converted_at: string | null
          id: string
          redeemed_at: string
          sales_code_id: string
          stripe_subscription_id: string | null
        }
        Insert: {
          applied_trial_days: number
          company_id: string
          converted_at?: string | null
          id?: string
          redeemed_at?: string
          sales_code_id: string
          stripe_subscription_id?: string | null
        }
        Update: {
          applied_trial_days?: number
          company_id?: string
          converted_at?: string | null
          id?: string
          redeemed_at?: string
          sales_code_id?: string
          stripe_subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_code_redemptions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_code_redemptions_sales_code_id_fkey"
            columns: ["sales_code_id"]
            isOneToOne: false
            referencedRelation: "sales_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_codes: {
        Row: {
          bonus_trial_days: number
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          memo: string | null
          owner_email: string | null
          owner_name: string
          owner_phone: string | null
          updated_at: string
        }
        Insert: {
          bonus_trial_days?: number
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          memo?: string | null
          owner_email?: string | null
          owner_name: string
          owner_phone?: string | null
          updated_at?: string
        }
        Update: {
          bonus_trial_days?: number
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          memo?: string | null
          owner_email?: string | null
          owner_name?: string
          owner_phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_queries: {
        Row: {
          auth_id: string
          company_id: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          params: Json
          screen: string
          updated_at: string
        }
        Insert: {
          auth_id?: string
          company_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          params?: Json
          screen: string
          updated_at?: string
        }
        Update: {
          auth_id?: string
          company_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          params?: Json
          screen?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_queries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_events: {
        Row: {
          all_day: boolean
          attachments: Json
          color: string
          company_id: string
          completed: boolean
          completed_at: string | null
          created_at: string
          deal_id: string | null
          description: string | null
          end_at: string | null
          id: string
          is_shared: boolean
          position: number
          priority: number
          recurrence: Json | null
          reminder: string | null
          reminded_at: string | null
          start_at: string | null
          target_departments: string[]
          target_user_ids: string[]
          title: string
          updated_at: string
          user_id: string | null
          visibility: string
        }
        Insert: {
          all_day?: boolean
          attachments?: Json
          color?: string
          company_id: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          end_at?: string | null
          id?: string
          is_shared?: boolean
          position?: number
          priority?: number
          recurrence?: Json | null
          reminder?: string | null
          reminded_at?: string | null
          start_at?: string | null
          target_departments?: string[]
          target_user_ids?: string[]
          title: string
          updated_at?: string
          user_id?: string | null
          visibility?: string
        }
        Update: {
          all_day?: boolean
          attachments?: Json
          color?: string
          company_id?: string
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          end_at?: string | null
          id?: string
          is_shared?: boolean
          position?: number
          priority?: number
          recurrence?: Json | null
          reminder?: string | null
          reminded_at?: string | null
          start_at?: string | null
          target_departments?: string[]
          target_user_ids?: string[]
          title?: string
          updated_at?: string
          user_id?: string | null
          visibility?: string
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
            foreignKeyName: "schedule_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "schedule_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "schedule_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "schedule_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "schedule_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
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
      shipping_sheet_layouts: {
        Row: {
          columns: Json
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          columns?: Json
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          columns?: Json
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_sheet_layouts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_sheet_layouts_created_by_fkey"
            columns: ["created_by"]
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
      stock_cost_layers: {
        Row: {
          company_id: string
          created_at: string
          id: string
          layer_date: string
          move_id: string
          product_id: string
          qty_in: number
          qty_left: number
          seq: number
          source: string
          unit_cost: number | null
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          layer_date: string
          move_id: string
          product_id: string
          qty_in: number
          qty_left: number
          seq: number
          source: string
          unit_cost?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          layer_date?: string
          move_id?: string
          product_id?: string
          qty_in?: number
          qty_left?: number
          seq?: number
          source?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_cost_layers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_cost_layers_move_id_fkey"
            columns: ["move_id"]
            isOneToOne: false
            referencedRelation: "stock_moves"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_cost_layers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_cost_revaluations: {
        Row: {
          cancelled_at: string | null
          company_id: string
          created_at: string
          created_by: string | null
          effect_amount: number
          effect_qty: number
          id: string
          note: string | null
          product_id: string
          reason: string
          reval_date: string
          status: string
          unit_cost: number
        }
        Insert: {
          cancelled_at?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          effect_amount?: number
          effect_qty?: number
          id?: string
          note?: string | null
          product_id: string
          reason?: string
          reval_date: string
          status?: string
          unit_cost: number
        }
        Update: {
          cancelled_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          effect_amount?: number
          effect_qty?: number
          id?: string
          note?: string | null
          product_id?: string
          reason?: string
          reval_date?: string
          status?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_cost_revaluations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_cost_revaluations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_cost_state: {
        Row: {
          company_id: string
          computed_at: string
          costs: number
          layers: number
          method: string
          uncosted_moves: number
        }
        Insert: {
          company_id: string
          computed_at?: string
          costs?: number
          layers?: number
          method: string
          uncosted_moves?: number
        }
        Update: {
          company_id?: string
          computed_at?: string
          costs?: number
          layers?: number
          method?: string
          uncosted_moves?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_cost_state_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_lines: {
        Row: {
          company_id: string
          count_id: string
          counted_qty: number | null
          created_at: string
          id: string
          product_id: string
          system_qty: number
        }
        Insert: {
          company_id: string
          count_id: string
          counted_qty?: number | null
          created_at?: string
          id?: string
          product_id: string
          system_qty?: number
        }
        Update: {
          company_id?: string
          count_id?: string
          counted_qty?: number | null
          created_at?: string
          id?: string
          product_id?: string
          system_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_count_id_fkey"
            columns: ["count_id"]
            isOneToOne: false
            referencedRelation: "stock_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_counts: {
        Row: {
          adjust_doc_id: string | null
          company_id: string
          count_date: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          status: string
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          adjust_doc_id?: string | null
          company_id: string
          count_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          status?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          adjust_doc_id?: string | null
          company_id?: string
          count_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          status?: string
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_adjust_doc_id_fkey"
            columns: ["adjust_doc_id"]
            isOneToOne: false
            referencedRelation: "stock_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_counts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_docs: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          company_id: string
          created_at: string
          created_by: string | null
          deal_id: string | null
          doc_date: string
          doc_no: string
          id: string
          journal_entry_id: string | null
          kind: string
          note: string | null
          order_id: string | null
          original_doc_id: string | null
          partner_id: string | null
          reason: string
          status: string
          tax_invoice_id: string | null
          to_warehouse_id: string | null
          updated_at: string
          warehouse_id: string | null
          work_order_id: string | null
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          doc_date?: string
          doc_no: string
          id?: string
          journal_entry_id?: string | null
          kind: string
          note?: string | null
          order_id?: string | null
          original_doc_id?: string | null
          partner_id?: string | null
          reason: string
          status?: string
          tax_invoice_id?: string | null
          to_warehouse_id?: string | null
          updated_at?: string
          warehouse_id?: string | null
          work_order_id?: string | null
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          doc_date?: string
          doc_no?: string
          id?: string
          journal_entry_id?: string | null
          kind?: string
          note?: string | null
          order_id?: string | null
          original_doc_id?: string | null
          partner_id?: string | null
          reason?: string
          status?: string
          tax_invoice_id?: string | null
          to_warehouse_id?: string | null
          updated_at?: string
          warehouse_id?: string | null
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_docs_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_docs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_docs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_docs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_docs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "stock_docs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "stock_docs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "stock_docs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "stock_docs_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "stock_docs_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_docs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_docs_original_doc_id_fkey"
            columns: ["original_doc_id"]
            isOneToOne: false
            referencedRelation: "stock_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_docs_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_docs_tax_invoice_id_fkey"
            columns: ["tax_invoice_id"]
            isOneToOne: false
            referencedRelation: "tax_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_docs_to_warehouse_id_fkey"
            columns: ["to_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_docs_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_docs_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_work_order_done"
            referencedColumns: ["work_order_id"]
          },
          {
            foreignKeyName: "stock_docs_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_move_costs: {
        Row: {
          company_id: string
          computed_at: string
          cost_amount: number
          layers: Json
          method: string
          move_id: string
          moved_at: string
          product_id: string
          qty: number
          qty_costed: number
          qty_uncosted: number
          reason: string
          unit_cost: number | null
        }
        Insert: {
          company_id: string
          computed_at?: string
          cost_amount?: number
          layers?: Json
          method: string
          move_id: string
          moved_at: string
          product_id: string
          qty: number
          qty_costed?: number
          qty_uncosted?: number
          reason: string
          unit_cost?: number | null
        }
        Update: {
          company_id?: string
          computed_at?: string
          cost_amount?: number
          layers?: Json
          method?: string
          move_id?: string
          moved_at?: string
          product_id?: string
          qty?: number
          qty_costed?: number
          qty_uncosted?: number
          reason?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_move_costs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_move_costs_move_id_fkey"
            columns: ["move_id"]
            isOneToOne: true
            referencedRelation: "stock_moves"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_moves: {
        Row: {
          amount: number | null
          company_id: string
          created_at: string
          doc_id: string
          id: string
          loss_reason: string | null
          moved_at: string
          note: string | null
          order_line_id: string | null
          overhead_unit: number | null
          product_id: string
          qty: number
          std_qty: number | null
          unit_price: number | null
          vat_amount: number | null
          warehouse_id: string
        }
        Insert: {
          amount?: number | null
          company_id: string
          created_at?: string
          doc_id: string
          id?: string
          loss_reason?: string | null
          moved_at: string
          note?: string | null
          order_line_id?: string | null
          overhead_unit?: number | null
          product_id: string
          qty: number
          std_qty?: number | null
          unit_price?: number | null
          vat_amount?: number | null
          warehouse_id: string
        }
        Update: {
          amount?: number | null
          company_id?: string
          created_at?: string
          doc_id?: string
          id?: string
          loss_reason?: string | null
          moved_at?: string
          note?: string | null
          order_line_id?: string | null
          overhead_unit?: number | null
          product_id?: string
          qty?: number
          std_qty?: number | null
          unit_price?: number | null
          vat_amount?: number | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_moves_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "stock_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "v_order_line_used"
            referencedColumns: ["order_line_id"]
          },
          {
            foreignKeyName: "stock_moves_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
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
          bank_sync_enabled: boolean
          base_price: number
          created_at: string | null
          daily_sync_count: number | null
          features: Json | null
          id: string
          included_seats: number | null
          is_active: boolean | null
          list_price: number | null
          max_employees: number | null
          max_seats: number | null
          monthly_ai_call_limit: number | null
          monthly_ai_token_limit: number | null
          monthly_cashbill_limit: number | null
          monthly_contract_limit: number | null
          monthly_credits: number | null
          monthly_issue_limit: number | null
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
          bank_sync_enabled?: boolean
          base_price?: number
          created_at?: string | null
          daily_sync_count?: number | null
          features?: Json | null
          id?: string
          included_seats?: number | null
          is_active?: boolean | null
          list_price?: number | null
          max_employees?: number | null
          max_seats?: number | null
          monthly_ai_call_limit?: number | null
          monthly_ai_token_limit?: number | null
          monthly_cashbill_limit?: number | null
          monthly_contract_limit?: number | null
          monthly_credits?: number | null
          monthly_issue_limit?: number | null
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
          bank_sync_enabled?: boolean
          base_price?: number
          created_at?: string | null
          daily_sync_count?: number | null
          features?: Json | null
          id?: string
          included_seats?: number | null
          is_active?: boolean | null
          list_price?: number | null
          max_employees?: number | null
          max_seats?: number | null
          monthly_ai_call_limit?: number | null
          monthly_ai_token_limit?: number | null
          monthly_cashbill_limit?: number | null
          monthly_contract_limit?: number | null
          monthly_credits?: number | null
          monthly_issue_limit?: number | null
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
      subscription_plans_backup_20260728: {
        Row: {
          annual_discount: number | null
          backed_up_at: string | null
          base_price: number | null
          created_at: string | null
          features: Json | null
          id: string | null
          included_seats: number | null
          is_active: boolean | null
          list_price: number | null
          max_employees: number | null
          max_seats: number | null
          monthly_ai_token_limit: number | null
          monthly_cashbill_limit: number | null
          monthly_contract_limit: number | null
          monthly_credits: number | null
          monthly_tax_invoice_limit: number | null
          name: string | null
          per_seat_price: number | null
          semiannual_discount: number | null
          slug: string | null
          sort_order: number | null
          stripe_price_annual: string | null
          stripe_price_monthly: string | null
          stripe_price_semiannual: string | null
          stripe_product_id: string | null
        }
        Insert: {
          annual_discount?: number | null
          backed_up_at?: string | null
          base_price?: number | null
          created_at?: string | null
          features?: Json | null
          id?: string | null
          included_seats?: number | null
          is_active?: boolean | null
          list_price?: number | null
          max_employees?: number | null
          max_seats?: number | null
          monthly_ai_token_limit?: number | null
          monthly_cashbill_limit?: number | null
          monthly_contract_limit?: number | null
          monthly_credits?: number | null
          monthly_tax_invoice_limit?: number | null
          name?: string | null
          per_seat_price?: number | null
          semiannual_discount?: number | null
          slug?: string | null
          sort_order?: number | null
          stripe_price_annual?: string | null
          stripe_price_monthly?: string | null
          stripe_price_semiannual?: string | null
          stripe_product_id?: string | null
        }
        Update: {
          annual_discount?: number | null
          backed_up_at?: string | null
          base_price?: number | null
          created_at?: string | null
          features?: Json | null
          id?: string | null
          included_seats?: number | null
          is_active?: boolean | null
          list_price?: number | null
          max_employees?: number | null
          max_seats?: number | null
          monthly_ai_token_limit?: number | null
          monthly_cashbill_limit?: number | null
          monthly_contract_limit?: number | null
          monthly_credits?: number | null
          monthly_tax_invoice_limit?: number | null
          name?: string | null
          per_seat_price?: number | null
          semiannual_discount?: number | null
          slug?: string | null
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
          last_payment_error: string | null
          next_retry_at: string | null
          payment_provider: string | null
          payment_retry_count: number
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
          last_payment_error?: string | null
          next_retry_at?: string | null
          payment_provider?: string | null
          payment_retry_count?: number
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
          last_payment_error?: string | null
          next_retry_at?: string | null
          payment_provider?: string | null
          payment_retry_count?: number
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
          ai_analysis: Json | null
          answer: string | null
          answered_at: string | null
          answered_by: string | null
          attachments: Json | null
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
          ai_analysis?: Json | null
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          attachments?: Json | null
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
          ai_analysis?: Json | null
          answer?: string | null
          answered_at?: string | null
          answered_by?: string | null
          attachments?: Json | null
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
          last_duration_sec: number | null
          last_finished_at: string | null
          last_run_at: string
          sync_type: string
          updated_at: string
        }
        Insert: {
          company_id: string
          last_duration_sec?: number | null
          last_finished_at?: string | null
          last_run_at?: string
          sync_type: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          last_duration_sec?: number | null
          last_finished_at?: string | null
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
      sync_quota_usage: {
        Row: {
          company_id: string
          updated_at: string
          usage_date: string
          used_count: number
        }
        Insert: {
          company_id: string
          updated_at?: string
          usage_date: string
          used_count?: number
        }
        Update: {
          company_id?: string
          updated_at?: string
          usage_date?: string
          used_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "sync_quota_usage_company_id_fkey"
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
      tax_advisors: {
        Row: {
          approved_at: string | null
          auth_id: string
          created_at: string
          email: string
          id: string
          name: string
          office_name: string | null
          phone: string | null
          specialty: string | null
          status: string
        }
        Insert: {
          approved_at?: string | null
          auth_id: string
          created_at?: string
          email: string
          id?: string
          name: string
          office_name?: string | null
          phone?: string | null
          specialty?: string | null
          status?: string
        }
        Update: {
          approved_at?: string | null
          auth_id?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          office_name?: string | null
          phone?: string | null
          specialty?: string | null
          status?: string
        }
        Relationships: []
      }
      tax_deadline_checks: {
        Row: {
          checked_at: string
          checked_by: string | null
          company_id: string
          deadline_id: string
        }
        Insert: {
          checked_at?: string
          checked_by?: string | null
          company_id: string
          deadline_id: string
        }
        Update: {
          checked_at?: string
          checked_by?: string | null
          company_id?: string
          deadline_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_deadline_checks_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_deadline_checks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_dup_dismissals: {
        Row: {
          company_id: string
          created_at: string
          dismissed_by: string | null
          dup_key: string
        }
        Insert: {
          company_id: string
          created_at?: string
          dismissed_by?: string | null
          dup_key: string
        }
        Update: {
          company_id?: string
          created_at?: string
          dismissed_by?: string | null
          dup_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_dup_dismissals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_dup_dismissals_dismissed_by_fkey"
            columns: ["dismissed_by"]
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
          counterparty_address: string | null
          counterparty_bizno: string | null
          counterparty_business_item: string | null
          counterparty_business_type: string | null
          counterparty_email: string | null
          counterparty_name: string
          counterparty_representative: string | null
          created_at: string | null
          deal_id: string | null
          detail_fetched_at: string | null
          doc_kind: string
          expense_category: string | null
          hometax_synced_at: string | null
          id: string
          issue_date: string
          item_name: string | null
          items: Json
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
          counterparty_address?: string | null
          counterparty_bizno?: string | null
          counterparty_business_item?: string | null
          counterparty_business_type?: string | null
          counterparty_email?: string | null
          counterparty_name: string
          counterparty_representative?: string | null
          created_at?: string | null
          deal_id?: string | null
          detail_fetched_at?: string | null
          doc_kind?: string
          expense_category?: string | null
          hometax_synced_at?: string | null
          id?: string
          issue_date: string
          item_name?: string | null
          items?: Json
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
          counterparty_address?: string | null
          counterparty_bizno?: string | null
          counterparty_business_item?: string | null
          counterparty_business_type?: string | null
          counterparty_email?: string | null
          counterparty_name?: string
          counterparty_representative?: string | null
          created_at?: string | null
          deal_id?: string | null
          detail_fetched_at?: string | null
          doc_kind?: string
          expense_category?: string | null
          hometax_synced_at?: string | null
          id?: string
          issue_date?: string
          item_name?: string | null
          items?: Json
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
      toss_billing_keys: {
        Row: {
          billing_key_enc: string | null
          card_company: string | null
          card_number_masked: string | null
          card_type: string | null
          company_id: string
          created_at: string
          customer_key: string
          registered_at: string | null
          updated_at: string
        }
        Insert: {
          billing_key_enc?: string | null
          card_company?: string | null
          card_number_masked?: string | null
          card_type?: string | null
          company_id: string
          created_at?: string
          customer_key: string
          registered_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_key_enc?: string | null
          card_company?: string | null
          card_number_masked?: string | null
          card_type?: string | null
          company_id?: string
          created_at?: string
          customer_key?: string
          registered_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "toss_billing_keys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
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
      user_consents: {
        Row: {
          agreed_at: string
          auth_id: string
          company_id: string | null
          consent_type: string
          context: Json | null
          document_versions: Json
          id: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          agreed_at?: string
          auth_id: string
          company_id?: string | null
          consent_type: string
          context?: Json | null
          document_versions: Json
          id?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          agreed_at?: string
          auth_id?: string
          company_id?: string | null
          consent_type?: string
          context?: Json | null
          document_versions?: Json
          id?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_consents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_consents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          app_tour_done_at: string | null
          app_tour_hidden_steps: Json
          company_id: string
          created_at: string | null
          dashboard_grid: Json | null
          dashboard_widgets: Json | null
          flow_settings: Json
          id: string
          pinned_pages: Json | null
          role_preset: string | null
          sidebar_collapsed: boolean | null
          signature_list_prefs: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          app_tour_done_at?: string | null
          app_tour_hidden_steps?: Json
          company_id: string
          created_at?: string | null
          dashboard_grid?: Json | null
          dashboard_widgets?: Json | null
          flow_settings?: Json
          id?: string
          pinned_pages?: Json | null
          role_preset?: string | null
          sidebar_collapsed?: boolean | null
          signature_list_prefs?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          app_tour_done_at?: string | null
          app_tour_hidden_steps?: Json
          company_id?: string
          created_at?: string | null
          dashboard_grid?: Json | null
          dashboard_widgets?: Json | null
          flow_settings?: Json
          id?: string
          pinned_pages?: Json | null
          role_preset?: string | null
          sidebar_collapsed?: boolean | null
          signature_list_prefs?: Json | null
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
          is_master: boolean
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
          is_master?: boolean
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
          is_master?: boolean
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
      voucher_account_rules: {
        Row: {
          account_id: string
          company_id: string
          created_at: string
          created_by: string | null
          hit_count: number
          id: string
          last_used_at: string
          match_key: string
          match_label: string
          source_kind: string
          vat_type: string | null
        }
        Insert: {
          account_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          hit_count?: number
          id?: string
          last_used_at?: string
          match_key: string
          match_label?: string
          source_kind: string
          vat_type?: string | null
        }
        Update: {
          account_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          hit_count?: number
          id?: string
          last_used_at?: string
          match_key?: string
          match_label?: string
          source_kind?: string
          vat_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voucher_account_rules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_account_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voucher_account_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          code: string | null
          company_id: string
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          memo: string | null
          name: string
        }
        Insert: {
          code?: string | null
          company_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          memo?: string | null
          name: string
        }
        Update: {
          code?: string | null
          company_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          memo?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_todo_checks: {
        Row: {
          checked_at: string
          checked_by: string | null
          company_id: string
          todo_key: string
          week_key: string
        }
        Insert: {
          checked_at?: string
          checked_by?: string | null
          company_id: string
          todo_key: string
          week_key: string
        }
        Update: {
          checked_at?: string
          checked_by?: string | null
          company_id?: string
          todo_key?: string
          week_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_todo_checks_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_todo_checks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          deal_id: string | null
          due_date: string | null
          id: string
          note: string | null
          order_date: string
          planned_qty: number
          product_id: string
          status: string
          updated_at: string
          warehouse_id: string | null
          wo_no: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          due_date?: string | null
          id?: string
          note?: string | null
          order_date?: string
          planned_qty: number
          product_id: string
          status?: string
          updated_at?: string
          warehouse_id?: string | null
          wo_no: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          due_date?: string | null
          id?: string
          note?: string | null
          order_date?: string
          planned_qty?: number
          product_id?: string
          status?: string
          updated_at?: string
          warehouse_id?: string | null
          wo_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_goal_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "work_orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_kpi_auto"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "work_orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_pnl"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "work_orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_deal_revenue_actual"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "work_orders_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "v_project_margin"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "work_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
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
      year_end_tax_status: {
        Row: {
          company_id: string
          employee_id: string
          id: string
          note: string | null
          status: string
          updated_at: string
          updated_by: string | null
          year: number
        }
        Insert: {
          company_id: string
          employee_id: string
          id?: string
          note?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          year: number
        }
        Update: {
          company_id?: string
          employee_id?: string
          id?: string
          note?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "year_end_tax_status_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "year_end_tax_status_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
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
      v_order_line_used: {
        Row: {
          company_id: string | null
          order_id: string | null
          order_line_id: string | null
          ordered_qty: number | null
          product_id: string | null
          used_qty: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
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
      v_stock_avg_cost: {
        Row: {
          avg_cost: number | null
          company_id: string | null
          priced_qty: number | null
          product_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_cost_layers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_cost_layers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      v_stock_onhand: {
        Row: {
          company_id: string | null
          product_id: string | null
          qty: number | null
          warehouse_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_moves_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_moves_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
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
      v_work_order_done: {
        Row: {
          company_id: string | null
          done_qty: number | null
          planned_qty: number | null
          product_id: string | null
          work_order_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _acct_by: {
        Args: { p_cfg: Json; p_company: string; p_key: string; p_name: string }
        Returns: string
      }
      _advisor_gate: { Args: { p_company_id: string }; Returns: string }
      _can_write_profit: { Args: never; Returns: boolean }
      _fa_accumulated: {
        Args: { p_asset: string; p_before_month: string }
        Returns: number
      }
      _fa_default_codes: {
        Args: { p_category: string }
        Returns: {
          accum_code: string
          asset_code: string
          expense_code: string
        }[]
      }
      _notify_signed_voucher: {
        Args: {
          p_company: string
          p_deal: string
          p_link: string
          p_message: string
          p_title: string
        }
        Returns: undefined
      }
      _seed_advisor_default_perms: {
        Args: { p_link_id: string }
        Returns: undefined
      }
      _seed_chart_of_accounts_internal: {
        Args: { p_company_id: string }
        Returns: number
      }
      _seed_legal_allowances_internal: {
        Args: { p_company_id: string }
        Returns: number
      }
      _seed_member_default_perms: {
        Args: { p_company: string; p_user: string }
        Returns: undefined
      }
      _stock_value_asof: {
        Args: { p_asof: string; p_company: string }
        Returns: {
          product_id: string
          value: number
        }[]
      }
      ad_account_has_secret: { Args: { p_id: string }; Returns: boolean }
      ad_account_save: {
        Args: {
          p_api_key: string
          p_api_secret: string
          p_external_id: string
          p_id: string
          p_label: string
          p_platform: string
        }
        Returns: string
      }
      ad_account_secrets_read: {
        Args: { p_id: string }
        Returns: {
          api_key: string
          api_secret: string
        }[]
      }
      add_cost_revaluation: {
        Args: {
          p_date: string
          p_note: string
          p_product: string
          p_reason: string
          p_unit_cost: number
        }
        Returns: string
      }
      advance_deal_stages: { Args: { p_deal_id?: string }; Returns: number }
      advisor_company_bank_tx: {
        Args: {
          p_company_id: string
          p_from?: string
          p_limit?: number
          p_to?: string
        }
        Returns: {
          amount: number
          balance_after: number
          bank_name: string
          counterparty: string
          description: string
          id: string
          transaction_date: string
          tx_type: string
        }[]
      }
      advisor_company_overview: {
        Args: { p_company_id: string }
        Returns: Json
      }
      advisor_company_payroll: {
        Args: { p_company_id: string; p_month?: string }
        Returns: {
          base_salary: number
          deductions_total: number
          employee_name: string
          employment_insurance: number
          health_insurance: number
          income_tax: number
          local_income_tax: number
          national_pension: number
          net_pay: number
          period_month: string
          status: string
        }[]
      }
      advisor_company_tax_invoices: {
        Args: {
          p_company_id: string
          p_from?: string
          p_to?: string
          p_type?: string
        }
        Returns: {
          counterparty_name: string
          id: string
          inv_type: string
          issue_date: string
          item_name: string
          settlement_status: string
          status: string
          supply_amount: number
          tax_amount: number
          total_amount: number
        }[]
      }
      advisor_enter_company: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      advisor_my_companies: {
        Args: never
        Returns: {
          bank_balance: number
          business_number: string
          company_id: string
          company_name: string
          employee_count: number
          industry: string
          link_id: string
          linked_at: string
          month_purchase: number
          month_sales: number
          representative: string
        }[]
      }
      advisor_my_permissions: { Args: never; Returns: string[] }
      advisor_register: {
        Args: {
          p_name: string
          p_office_name?: string
          p_phone?: string
          p_specialty?: string
        }
        Returns: {
          approved_at: string | null
          auth_id: string
          created_at: string
          email: string
          id: string
          name: string
          office_name: string | null
          phone: string | null
          specialty: string | null
          status: string
        }
        SetofOptions: {
          from: "*"
          to: "tax_advisors"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ai_cost_used_this_month: {
        Args: { p_company_id: string }
        Returns: number
      }
      ai_token_allowance: { Args: { p_company_id: string }; Returns: Json }
      ai_tokens_used_this_month: {
        Args: { p_company_id: string }
        Returns: number
      }
      ai_usage_summary: { Args: never; Returns: Json }
      apply_approval_side_effects: {
        Args: { p_request_id: string }
        Returns: Json
      }
      apply_credit_purchase: {
        Args: { p_purchase_id: string }
        Returns: boolean
      }
      approve_overtime: { Args: { p_request_id: string }; Returns: undefined }
      auto_clock_out_at_work_end: { Args: never; Returns: number }
      auto_voucher_for_signed_quote: {
        Args: { p_approval: string }
        Returns: Json
      }
      backfill_bank_counterparty: {
        Args: { p_company_id: string }
        Returns: number
      }
      cancel_cost_revaluation: { Args: { p_id: string }; Returns: undefined }
      check_can_clock_in_after_hours: {
        Args: { p_employee_id: string }
        Returns: {
          allowed: boolean
          overtime_request_id: string
          reason: string
        }[]
      }
      cleanup_orphan_company: {
        Args: { p_company_id: string }
        Returns: boolean
      }
      close_invoice_balance: {
        Args: { p_amount?: number; p_invoice_id: string; p_reason: string }
        Returns: string
      }
      company_advisor_access_logs: {
        Args: { p_limit?: number }
        Returns: {
          accessed_at: string
          advisor_name: string
          office_name: string
        }[]
      }
      company_link_advisor: {
        Args: { p_advisor_id: string }
        Returns: undefined
      }
      company_list_advisors: {
        Args: never
        Returns: {
          email: string
          id: string
          linked: boolean
          name: string
          office_name: string
          phone: string
          specialty: string
        }[]
      }
      company_my_advisors: {
        Args: never
        Returns: {
          advisor_id: string
          email: string
          link_id: string
          linked_at: string
          name: string
          office_name: string
          phone: string
          specialty: string
        }[]
      }
      company_unlink_advisor: {
        Args: { p_link_id: string }
        Returns: undefined
      }
      consume_ai_tokens: {
        Args: { p_company_id: string; p_tokens: number }
        Returns: boolean
      }
      consume_issue_credit: { Args: { p_company_id: string }; Returns: boolean }
      consume_sync_run: { Args: { p_sync_type: string }; Returns: Json }
      copilot_company_snapshot: {
        Args: { p_company_id: string }
        Returns: Json
      }
      current_app_employee_id: { Args: never; Returns: string }
      current_app_user_email: { Args: never; Returns: string }
      current_app_user_id: { Args: never; Returns: string }
      current_employee_id: { Args: never; Returns: string }
      current_plan_slug: { Args: { p_company: string }; Returns: string }
      daily_db_integrity_check: { Args: never; Returns: Json }
      data_sync_floor: { Args: { p_company: string }; Returns: string }
      decrypt_credential: { Args: { p_ciphertext: string }; Returns: string }
      decrypt_json_credentials: { Args: { p_creds: Json }; Returns: Json }
      delete_document: { Args: { p_doc_id: string }; Returns: undefined }
      encrypt_credential: { Args: { p_plaintext: string }; Returns: string }
      encrypt_json_credentials: { Args: { p_creds: Json }; Returns: Json }
      estimate_retirement: {
        Args: { p_asof?: string; p_company: string; p_employee?: string }
        Returns: {
          daily_wage: number
          days3m: number
          employee_id: string
          estimate: number
          gross3m: number
          hire_date: string
          manual: number
          name: string
          source: string
          total_days: number
        }[]
      }
      feature_on: {
        Args: { p_company: string; p_feature: string }
        Returns: boolean
      }
      find_account: {
        Args: { p_code: string; p_company: string; p_name: string }
        Returns: string
      }
      find_auth_user_by_email: {
        Args: { p_email: string }
        Returns: {
          email: string
          id: string
          raw_user_meta_data: Json
        }[]
      }
      find_masked_emails_by_name: {
        Args: { p_name: string }
        Returns: string[]
      }
      find_or_create_bank_partner: {
        Args: { p_bank_account_id: string }
        Returns: string
      }
      find_or_create_card_partner: {
        Args: { p_card_name: string; p_company: string }
        Returns: string
      }
      fn_process_invoice_queue: { Args: never; Returns: number }
      generate_annual_leave_grants: {
        Args: { p_company_id?: string }
        Returns: number
      }
      generate_approval_token: { Args: never; Returns: string }
      generate_leave_accruals: {
        Args: { p_company_id?: string }
        Returns: number
      }
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
      get_company_entitlement: {
        Args: { p_company_id: string }
        Returns: {
          cancel_at_period_end: boolean
          display_status: string
          effective_plan_slug: string
          effective_until: string
          entitled: boolean
        }[]
      }
      get_company_overview: { Args: { p_company_id: string }; Returns: Json }
      get_company_plan_slug: { Args: never; Returns: string }
      get_contract_package_by_token: {
        Args: { p_token: string }
        Returns: Json
      }
      get_credential_key: { Args: never; Returns: string }
      get_employee_rrn_masked: { Args: { p_employee: string }; Returns: string }
      get_monthly_issue_usage: {
        Args: { p_company_id: string }
        Returns: {
          cash_count: number
          tax_count: number
          total_count: number
        }[]
      }
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
      get_my_department: { Args: never; Returns: string }
      get_my_email: { Args: never; Returns: string }
      get_owner_dashboard_summary: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      get_owner_project_trend: { Args: { p_period?: string }; Returns: Json }
      get_partner_credit: {
        Args: { p_company?: string }
        Returns: {
          avg_delay: number
          grade: string
          late_ratio: number
          max_delay: number
          oldest_open_days: number
          open_amt: number
          open_over60: number
          open_over90: number
          partner_id: string
          settled_n: number
        }[]
      }
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
      get_rrns_for_statement: {
        Args: { p_employee_ids: string[] }
        Returns: {
          employee_id: string
          rrn: string
        }[]
      }
      get_share_by_token: { Args: { p_token: string }; Returns: Json }
      get_signature_context_by_token: {
        Args: { p_sign_token: string }
        Returns: Json
      }
      get_signature_request_by_token: {
        Args: { p_token: string }
        Returns: Json
      }
      get_sync_status: { Args: never; Returns: Json }
      get_toss_card_info: {
        Args: { p_company_id: string }
        Returns: {
          card_company: string
          card_number_masked: string
          card_type: string
          registered_at: string
        }[]
      }
      has_menu_perm: { Args: { p_route: string }; Returns: boolean }
      has_min_plan: { Args: { min_plan: string }; Returns: boolean }
      has_perm: { Args: { p_key: string }; Returns: boolean }
      increment_share_view_count: {
        Args: { share_id_param: string }
        Returns: undefined
      }
      is_advisor_session: { Args: never; Returns: boolean }
      is_channel_member: {
        Args: { p_channel_id: string; p_user_id: string }
        Returns: boolean
      }
      is_company_admin: { Args: never; Returns: boolean }
      is_company_master: { Args: never; Returns: boolean }
      is_company_owner: { Args: never; Returns: boolean }
      is_manual_sync_allowed: { Args: { p_company: string }; Returns: boolean }
      is_partner_user: { Args: never; Returns: boolean }
      is_platform_operator: { Args: never; Returns: boolean }
      is_user_assigned_to_deal: {
        Args: { p_deal_id: string }
        Returns: boolean
      }
      issue_allowance:
        | { Args: { p_company_id: string }; Returns: Json }
        | { Args: { p_company_id: string; p_kind: string }; Returns: Json }
      learn_voucher_account: {
        Args: {
          p_account_id: string
          p_match_key: string
          p_match_label: string
          p_source_kind: string
          p_vat_type?: string
        }
        Returns: undefined
      }
      leave_accrual_enabled: {
        Args: { p_company_id: string }
        Returns: boolean
      }
      leave_calendar: {
        Args: never
        Returns: {
          days: number
          employee_name: string
          end_date: string
          leave_type: string
          leave_unit: string
          start_date: string
          start_time: string
        }[]
      }
      link_invoice_partners: { Args: never; Returns: Json }
      list_rrn_registered: { Args: never; Returns: string[] }
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
      make_cogs_voucher_draft: {
        Args: { p_company: string; p_from: string; p_to: string }
        Returns: string
      }
      make_contract_invoice_drafts: { Args: never; Returns: number }
      make_contract_invoice_drafts_for: {
        Args: { p_company: string; p_today: string }
        Returns: number
      }
      make_depreciation_voucher_draft: {
        Args: { p_company: string; p_month: string }
        Returns: string
      }
      make_inventory_voucher_draft: {
        Args: { p_asof: string; p_company: string }
        Returns: string
      }
      make_my_cogs_voucher_draft: {
        Args: { p_from: string; p_to: string }
        Returns: string
      }
      make_my_contract_invoice_drafts: { Args: never; Returns: number }
      make_my_depreciation_voucher_draft: {
        Args: { p_month: string }
        Returns: string
      }
      make_my_inventory_voucher_draft: {
        Args: { p_asof: string }
        Returns: string
      }
      make_my_payroll_voucher_draft: {
        Args: { p_month: string }
        Returns: string
      }
      make_my_production_voucher_draft: {
        Args: { p_from: string; p_to: string }
        Returns: string
      }
      make_payroll_voucher_draft: {
        Args: { p_company: string; p_month: string }
        Returns: string
      }
      make_production_voucher_draft: {
        Args: { p_company: string; p_from: string; p_to: string }
        Returns: string
      }
      make_retirement_voucher_draft: {
        Args: { p_asof: string; p_company: string }
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
      mark_contract_package_viewed: {
        Args: { p_token: string }
        Returns: undefined
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
      master_delete_company: { Args: { p_confirm_name: string }; Returns: Json }
      normalize_party_name: { Args: { t: string }; Returns: string }
      operator_advisor_links: {
        Args: { p_advisor_id: string }
        Returns: {
          company_id: string
          company_name: string
          created_at: string
          id: string
          status: string
        }[]
      }
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
      operator_link_advisor: {
        Args: { p_advisor_id: string; p_company_id: string }
        Returns: undefined
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
      operator_list_advisors: {
        Args: never
        Returns: {
          approved_at: string
          created_at: string
          email: string
          id: string
          link_count: number
          name: string
          office_name: string
          phone: string
          specialty: string
          status: string
        }[]
      }
      operator_list_partnership_inquiries: {
        Args: { p_limit?: number; p_status?: string }
        Returns: {
          company_name: string
          contact_name: string
          created_at: string
          email: string
          id: string
          message: string
          phone: string
          status: string
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
      operator_resolve_errors: {
        Args: { p_ids: string[]; p_resolved?: boolean }
        Returns: number
      }
      operator_sales_code_signups: {
        Args: never
        Returns: {
          applied_trial_days: number
          business_number: string
          code: string
          code_active: boolean
          company_id: string
          company_name: string
          converted_at: string
          owner_name: string
          plan_slug: string
          redeemed_at: string
          subscription_status: string
        }[]
      }
      operator_set_advisor_status: {
        Args: { p_advisor_id: string; p_status: string }
        Returns: undefined
      }
      operator_set_company_industry: {
        Args: { p_company_id: string; p_industry: string }
        Returns: Json
      }
      operator_set_partnership_inquiry_status: {
        Args: { p_id: string; p_status: string }
        Returns: boolean
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
      operator_unlink_advisor: {
        Args: { p_link_id: string }
        Returns: undefined
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
      platform_activity_feed: {
        Args: { p_hours?: number; p_limit?: number }
        Returns: Json
      }
      platform_ai_costs: { Args: never; Returns: Json }
      platform_analytics: {
        Args: { p_buckets?: number; p_granularity?: string; p_scope?: string }
        Returns: Json
      }
      platform_company_activity: { Args: never; Returns: Json }
      platform_ops_risk: { Args: never; Returns: Json }
      platform_signup_funnel: { Args: { p_days?: number }; Returns: Json }
      platform_traffic_stats: {
        Args: { p_days?: number; p_scope?: string }
        Returns: Json
      }
      platform_usage_stats: { Args: never; Returns: Json }
      portal_leave_message: {
        Args: { p_message: string; p_token: string }
        Returns: boolean
      }
      post_bank_manual_voucher: {
        Args: {
          p_account_id: string
          p_bank_tx_id: string
          p_memo?: string
          p_partner_id?: string
        }
        Returns: string
      }
      post_bank_voucher:
        | {
            Args: {
              p_account_id: string
              p_bank_tx_id: string
              p_remember?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              p_account_id: string
              p_bank_tx_id: string
              p_memo?: string
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
      pv_is_search_referrer: { Args: { p_host: string }; Returns: boolean }
      reassign_approval_step: {
        Args: { p_new_approver_id: string; p_step_id: string }
        Returns: undefined
      }
      rebuild_my_stock_costs: { Args: never; Returns: Json }
      rebuild_stock_costs: { Args: { p_company: string }; Returns: Json }
      recalculate_late_status_recent: {
        Args: { p_company_id?: string; p_days: number }
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
      record_sync_duration: {
        Args: { p_seconds: number; p_sync_type: string }
        Returns: undefined
      }
      record_sync_run: { Args: { p_sync_type: string }; Returns: string }
      redeem_seat_coupon: { Args: { p_coupon_id: string }; Returns: Json }
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
      resolve_card_partner: { Args: { p_card_name: string }; Returns: string }
      resolve_company_join_request: {
        Args: {
          p_action: string
          p_reason: string
          p_request_id: string
          p_resolver_user_id: string
          p_role: string
        }
        Returns: Json
      }
      resolve_merchant_partner: {
        Args: { p_bizno?: string; p_name: string }
        Returns: string
      }
      resolve_partner_for_invoice: {
        Args: { p_invoice_id: string }
        Returns: string
      }
      run_biz_alerts: { Args: never; Returns: number }
      run_biz_alerts_for: {
        Args: { p_company: string; p_today: string }
        Returns: number
      }
      run_my_biz_alerts: { Args: never; Returns: number }
      run_production_voucher_cycles: { Args: never; Returns: number }
      run_stock_cost_rebuild_all: { Args: never; Returns: number }
      sales_code_bonus_days: { Args: { p_code: string }; Returns: number }
      save_manual_voucher: {
        Args: {
          p_description: string
          p_entry_date: string
          p_lines: Json
          p_voucher_type: string
        }
        Returns: string
      }
      save_sale_purchase_voucher: {
        Args: {
          p_description: string
          p_electronic?: boolean
          p_entry_date: string
          p_lines: Json
          p_reference_id?: string
          p_reference_type?: string
          p_supply_amount: number
          p_vat_amount: number
          p_vat_type: string
        }
        Returns: string
      }
      save_signer_inputs_by_token: {
        Args: { p_inputs: Json; p_token: string }
        Returns: Json
      }
      seed_korean_legal_holidays: { Args: { p_year?: number }; Returns: number }
      seed_legal_allowances: { Args: { p_company_id: string }; Returns: number }
      set_advisor_permissions: {
        Args: { p_link_id: string; p_perm_keys: string[] }
        Returns: undefined
      }
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
      set_employee_rrn: {
        Args: { p_employee: string; p_rrn: string }
        Returns: Json
      }
      set_member_permissions: {
        Args: { p_perm_keys: string[]; p_user_id: string }
        Returns: Json
      }
      set_voucher_deal: {
        Args: { p_deal_id: string; p_entry_id: string; p_sub_deal_id?: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      stage_label_ko: { Args: { p_stage: string }; Returns: string }
      standard_chart_of_accounts: {
        Args: never
        Returns: {
          account_type: string
          code: string
          name: string
        }[]
      }
      statutory_annual_leave_days: {
        Args: { p_years: number }
        Returns: number
      }
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
      sync_leave_balance_totals: {
        Args: { p_company_id?: string }
        Returns: undefined
      }
      sync_my_leave_accruals: { Args: never; Returns: number }
      sync_my_monthly_leave_grants: { Args: never; Returns: number }
      transfer_master: { Args: { p_to_user_id: string }; Returns: Json }
      unpost_evidence_voucher: { Args: { p_entry_id: string }; Returns: string }
      unread_announcement_count: { Args: never; Returns: number }
      update_manual_voucher: {
        Args: {
          p_description: string
          p_entry_date: string
          p_entry_id: string
          p_lines: Json
        }
        Returns: undefined
      }
      update_sale_purchase_voucher: {
        Args: {
          p_description: string
          p_electronic?: boolean
          p_entry_date: string
          p_entry_id: string
          p_lines: Json
          p_supply_amount: number
          p_vat_amount: number
          p_vat_type: string
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
