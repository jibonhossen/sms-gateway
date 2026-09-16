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
      api_keys: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
          revoked_at: string | null
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organization_id: string
          revoked_at?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      device_pairing_sessions: {
        Row: {
          created_at: string
          device_id: string | null
          expires_at: string
          id: string
          organization_id: string
          pairing_code: string
          status: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          expires_at?: string
          id?: string
          organization_id: string
          pairing_code?: string
          status?: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          expires_at?: string
          id?: string
          organization_id?: string
          pairing_code?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_pairing_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "gateway_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_pairing_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_devices: {
        Row: {
          android_version: string | null
          app_version: string | null
          battery_charging: boolean | null
          battery_level: number | null
          created_at: string
          device_token_hash: string
          id: string
          last_heartbeat_at: string | null
          name: string
          network_type: string | null
          organization_id: string
          signal_strength: number | null
          status: string
          updated_at: string
        }
        Insert: {
          android_version?: string | null
          app_version?: string | null
          battery_charging?: boolean | null
          battery_level?: number | null
          created_at?: string
          device_token_hash: string
          id?: string
          last_heartbeat_at?: string | null
          name: string
          network_type?: string | null
          organization_id: string
          signal_strength?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          android_version?: string | null
          app_version?: string | null
          battery_charging?: boolean | null
          battery_level?: number | null
          created_at?: string
          device_token_hash?: string
          id?: string
          last_heartbeat_at?: string | null
          name?: string
          network_type?: string | null
          organization_id?: string
          signal_strength?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gateway_devices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_messages: {
        Row: {
          created_at: string
          device_id: string
          id: string
          message: string
          organization_id: string
          received_at: string
          sender: string
          sim_slot: number
          webhook_dispatched_at: string | null
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          message: string
          organization_id: string
          received_at?: string
          sender: string
          sim_slot?: number
          webhook_dispatched_at?: string | null
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          message?: string
          organization_id?: string
          received_at?: string
          sender?: string
          sim_slot?: number
          webhook_dispatched_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_messages_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "gateway_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
          webhook_secret: string
          webhook_url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
          webhook_secret?: string
          webhook_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
          webhook_secret?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      outbound_messages: {
        Row: {
          created_at: string
          delivered_at: string | null
          device_id: string | null
          error_code: number | null
          error_message: string | null
          id: string
          max_retries: number
          message: string
          organization_id: string
          phone_number: string
          processed_at: string | null
          requested_sim_slot: number | null
          retry_count: number
          sent_at: string | null
          sim_subscription_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          device_id?: string | null
          error_code?: number | null
          error_message?: string | null
          id?: string
          max_retries?: number
          message: string
          organization_id: string
          phone_number: string
          processed_at?: string | null
          requested_sim_slot?: number | null
          retry_count?: number
          sent_at?: string | null
          sim_subscription_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          device_id?: string | null
          error_code?: number | null
          error_message?: string | null
          id?: string
          max_retries?: number
          message?: string
          organization_id?: string
          phone_number?: string
          processed_at?: string | null
          requested_sim_slot?: number | null
          retry_count?: number
          sent_at?: string | null
          sim_subscription_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_messages_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "gateway_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_messages_sim_subscription_id_fkey"
            columns: ["sim_subscription_id"]
            isOneToOne: false
            referencedRelation: "sim_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      sim_subscriptions: {
        Row: {
          available_balance: number
          carrier_name: string | null
          consecutive_failures: number
          created_at: string
          daily_limit: number
          device_id: string
          expires_at: string | null
          id: string
          last_sent_date: string
          organization_id: string
          phone_number: string | null
          quarantined_reason: string | null
          sent_today: number
          sim_slot: number
          status: string
          updated_at: string
        }
        Insert: {
          available_balance?: number
          carrier_name?: string | null
          consecutive_failures?: number
          created_at?: string
          daily_limit?: number
          device_id: string
          expires_at?: string | null
          id?: string
          last_sent_date?: string
          organization_id: string
          phone_number?: string | null
          quarantined_reason?: string | null
          sent_today?: number
          sim_slot?: number
          status?: string
          updated_at?: string
        }
        Update: {
          available_balance?: number
          carrier_name?: string | null
          consecutive_failures?: number
          created_at?: string
          daily_limit?: number
          device_id?: string
          expires_at?: string | null
          id?: string
          last_sent_date?: string
          organization_id?: string
          phone_number?: string | null
          quarantined_reason?: string | null
          sent_today?: number
          sim_slot?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sim_subscriptions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "gateway_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sim_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_next_sms: {
        Args: { p_device_id: string }
        Returns: {
          message: string
          message_id: string
          organization_id: string
          phone_number: string
          sim_slot: number
          sim_subscription_id: string
        }[]
      }
      complete_device_pairing: {
        Args: {
          p_android_ver: string
          p_app_ver: string
          p_device_name: string
          p_device_token_hash: string
          p_pairing_code: string
        }
        Returns: {
          device_id: string
          org_name: string
          organization_id: string
        }[]
      }
      get_user_org_ids: { Args: never; Returns: string[] }
      mark_stale_devices_offline: { Args: never; Returns: undefined }
      record_device_fcm_token: {
        Args: {
          p_device_id: string
          p_fcm_token: string
        }
        Returns: undefined
      }
      record_device_heartbeat: {
        Args: {
          p_app_ver: string
          p_battery: number
          p_charging: boolean
          p_device_id: string
          p_network: string
          p_signal: number
        }
        Returns: undefined
      }
      report_sms_result: {
        Args: {
          p_device_id: string
          p_error_code?: number
          p_error_message?: string
          p_message_id: string
          p_status: string
        }
        Returns: undefined
      }
      reset_daily_sim_counters: { Args: never; Returns: undefined }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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

export type GatewayDevice = Database["public"]["Tables"]["gateway_devices"]["Row"];
export type OutboundMessage = Database["public"]["Tables"]["outbound_messages"]["Row"];
export type InboundMessage = Database["public"]["Tables"]["inbound_messages"]["Row"];
export type SimSubscription = Database["public"]["Tables"]["sim_subscriptions"]["Row"] & {
  gateway_devices?: GatewayDevice | null;
};
export type ApiKey = Database["public"]["Tables"]["api_keys"]["Row"];
export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
