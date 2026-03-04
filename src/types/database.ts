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
          is_archived: boolean | null
          name: string
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
          is_archived?: boolean | null
          name: string
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
          is_archived?: boolean | null
          name?: string
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
          created_at: string | null
          id: string
          industry: string | null
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          industry?: string | null
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          industry?: string | null
          name?: string
        }
        Relationships: []
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
          end_date: string | null
          id: string
          internal_manager_id: string | null
          name: string
          partner_id: string | null
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
          end_date?: string | null
          id?: string
          internal_manager_id?: string | null
          name: string
          partner_id?: string | null
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
          end_date?: string | null
          id?: string
          internal_manager_id?: string | null
          name?: string
          partner_id?: string | null
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
          company_id: string
          content_json: Json
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          type: string
          variables: Json | null
          version: number | null
        }
        Insert: {
          company_id: string
          content_json?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          type: string
          variables?: Json | null
          version?: number | null
        }
        Update: {
          company_id?: string
          content_json?: Json
          created_at?: string | null
          id?: string
          is_active?: boolean | null
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
      documents: {
        Row: {
          company_id: string
          content_json: Json
          created_at: string | null
          created_by: string | null
          deal_id: string | null
          id: string
          locked_at: string | null
          name: string
          status: string | null
          template_id: string | null
          version: number | null
        }
        Insert: {
          company_id: string
          content_json?: Json
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          id?: string
          locked_at?: string | null
          name: string
          status?: string | null
          template_id?: string | null
          version?: number | null
        }
        Update: {
          company_id?: string
          content_json?: Json
          created_at?: string | null
          created_by?: string | null
          deal_id?: string | null
          id?: string
          locked_at?: string | null
          name?: string
          status?: string | null
          template_id?: string | null
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
            foreignKeyName: "documents_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "doc_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          company_id: string | null
          created_at: string | null
          hire_date: string | null
          id: string
          name: string
          retirement_accrual: number | null
          salary: number | null
          status: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          hire_date?: string | null
          id?: string
          name: string
          retirement_accrual?: number | null
          salary?: number | null
          status?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          hire_date?: string | null
          id?: string
          name?: string
          retirement_accrual?: number | null
          salary?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey"
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
      partners: {
        Row: {
          account_number: string | null
          address: string | null
          bank_name: string | null
          business_number: string | null
          classification: string | null
          company_id: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          notes: string | null
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
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          notes?: string | null
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
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          notes?: string | null
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
      payment_queue: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          bank_account_id: string | null
          company_id: string
          cost_schedule_id: string | null
          created_at: string | null
          description: string | null
          executed_at: string | null
          id: string
          status: string | null
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          bank_account_id?: string | null
          company_id: string
          cost_schedule_id?: string | null
          created_at?: string | null
          description?: string | null
          executed_at?: string | null
          id?: string
          status?: string | null
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          bank_account_id?: string | null
          company_id?: string
          cost_schedule_id?: string | null
          created_at?: string | null
          description?: string | null
          executed_at?: string | null
          id?: string
          status?: string | null
        }
        Relationships: [
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
      tax_invoices: {
        Row: {
          company_id: string
          counterparty_bizno: string | null
          counterparty_name: string
          created_at: string | null
          deal_id: string | null
          id: string
          issue_date: string
          partner_id: string | null
          status: string | null
          supply_amount: number
          tax_amount: number
          total_amount: number
          type: string
        }
        Insert: {
          company_id: string
          counterparty_bizno?: string | null
          counterparty_name: string
          created_at?: string | null
          deal_id?: string | null
          id?: string
          issue_date: string
          partner_id?: string | null
          status?: string | null
          supply_amount: number
          tax_amount: number
          total_amount: number
          type: string
        }
        Update: {
          company_id?: string
          counterparty_bizno?: string | null
          counterparty_name?: string
          created_at?: string | null
          deal_id?: string | null
          id?: string
          issue_date?: string
          partner_id?: string | null
          status?: string | null
          supply_amount?: number
          tax_amount?: number
          total_amount?: number
          type?: string
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
            foreignKeyName: "tax_invoices_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
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
          company_id: string | null
          created_at: string | null
          email: string
          id: string
          name: string | null
          role: string | null
        }
        Insert: {
          auth_id?: string | null
          company_id?: string | null
          created_at?: string | null
          email: string
          id?: string
          name?: string | null
          role?: string | null
        }
        Update: {
          auth_id?: string | null
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
          company_id: string
          created_at: string | null
          id: string
          login_id: string | null
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
          company_id: string
          created_at?: string | null
          id?: string
          login_id?: string | null
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
          company_id?: string
          created_at?: string | null
          id?: string
          login_id?: string | null
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
      [_ in never]: never
    }
    Functions: {
      get_my_company_id: { Args: never; Returns: string }
      is_company_owner: { Args: never; Returns: boolean }
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

// ── Convenience type aliases ──

// Original tables
export type Company = Database['public']['Tables']['companies']['Row'];
export type User = Database['public']['Tables']['users']['Row'];
export type Deal = Database['public']['Tables']['deals']['Row'];
export type DealNode = Database['public']['Tables']['deal_nodes']['Row'];
export type DealRevenueSchedule = Database['public']['Tables']['deal_revenue_schedule']['Row'];
export type DealCostSchedule = Database['public']['Tables']['deal_cost_schedule']['Row'];
export type Transaction = Database['public']['Tables']['transactions']['Row'];
export type TransactionMatch = Database['public']['Tables']['transaction_matches']['Row'];
export type Vendor = Database['public']['Tables']['vendors']['Row'];
export type Employee = Database['public']['Tables']['employees']['Row'];
export type CashSnapshot = Database['public']['Tables']['cash_snapshot']['Row'];
export type MonthlyFinancial = Database['public']['Tables']['monthly_financials']['Row'];
export type FinancialItem = Database['public']['Tables']['financial_items']['Row'];
export type GrowthTarget = Database['public']['Tables']['growth_targets']['Row'];

// Phase 1
export type BankAccount = Database['public']['Tables']['bank_accounts']['Row'];
export type RoutingRule = Database['public']['Tables']['routing_rules']['Row'];
export type SubDeal = Database['public']['Tables']['sub_deals']['Row'];
export type DealMilestone = Database['public']['Tables']['deal_milestones']['Row'];
export type DealAssignment = Database['public']['Tables']['deal_assignments']['Row'];
export type PaymentQueue = Database['public']['Tables']['payment_queue']['Row'];

// Phase 2
export type DocTemplate = Database['public']['Tables']['doc_templates']['Row'];
export type Document = Database['public']['Tables']['documents']['Row'];
export type DocRevision = Database['public']['Tables']['doc_revisions']['Row'];
export type DocApproval = Database['public']['Tables']['doc_approvals']['Row'];
export type TaxInvoice = Database['public']['Tables']['tax_invoices']['Row'];

// Phase 3
export type ChatChannel = Database['public']['Tables']['chat_channels']['Row'];
export type ChatParticipant = Database['public']['Tables']['chat_participants']['Row'];
export type ChatMessage = Database['public']['Tables']['chat_messages']['Row'];
export type ChatFile = Database['public']['Tables']['chat_files']['Row'];
export type ChatEvent = Database['public']['Tables']['chat_events']['Row'];
export type ChatMention = Database['public']['Tables']['chat_mentions']['Row'];
export type ChatReaction = Database['public']['Tables']['chat_reactions']['Row'];
export type ChatActionCard = Database['public']['Tables']['chat_action_cards']['Row'];

// Phase 4
export type VaultAccount = Database['public']['Tables']['vault_accounts']['Row'];
export type VaultAsset = Database['public']['Tables']['vault_assets']['Row'];
export type VaultDoc = Database['public']['Tables']['vault_docs']['Row'];
export type AutoDiscoveryResult = Database['public']['Tables']['auto_discovery_results']['Row'];

// Phase 5
export type TreasuryPosition = Database['public']['Tables']['treasury_positions']['Row'];
export type TreasuryTransaction = Database['public']['Tables']['treasury_transactions']['Row'];

// Option C
export type DealClassification = Database['public']['Tables']['deal_classifications']['Row'];

// Phase D: Bank
export type BankTransaction = Database['public']['Tables']['bank_transactions']['Row'];
export type BankClassificationRule = Database['public']['Tables']['bank_classification_rules']['Row'];

// Phase E: Card + Closing
export type CorporateCard = Database['public']['Tables']['corporate_cards']['Row'];
export type CardTransaction = Database['public']['Tables']['card_transactions']['Row'];
export type ClosingChecklist = Database['public']['Tables']['closing_checklists']['Row'];
export type ClosingChecklistItem = Database['public']['Tables']['closing_checklist_items']['Row'];

// Phase F: Foundation
export type AuditLog = Database['public']['Tables']['audit_logs']['Row'];
export type Partner = Database['public']['Tables']['partners']['Row'];
