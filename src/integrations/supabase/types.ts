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
          report_id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          report_id: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          report_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      discover_islands: {
        Row: {
          category: string | null
          created_in: string | null
          creator_code: string | null
          id: string
          island_code: string
          last_metrics: Json | null
          tags: Json | null
          title: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_in?: string | null
          creator_code?: string | null
          id?: string
          island_code: string
          last_metrics?: Json | null
          tags?: Json | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_in?: string | null
          creator_code?: string | null
          id?: string
          island_code?: string
          last_metrics?: Json | null
          tags?: Json | null
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      discover_report_islands: {
        Row: {
          category: string | null
          created_in: string | null
          creator_code: string | null
          id: string
          island_code: string
          probe_date: string | null
          probe_minutes: number | null
          probe_peak_ccu: number | null
          probe_plays: number | null
          probe_unique: number | null
          report_id: string
          status: string | null
          tags: Json | null
          title: string | null
          updated_at: string | null
          week_d1_avg: number | null
          week_d7_avg: number | null
          week_favorites: number | null
          week_minutes: number | null
          week_minutes_per_player_avg: number | null
          week_peak_ccu_max: number | null
          week_plays: number | null
          week_recommends: number | null
          week_unique: number | null
        }
        Insert: {
          category?: string | null
          created_in?: string | null
          creator_code?: string | null
          id?: string
          island_code: string
          probe_date?: string | null
          probe_minutes?: number | null
          probe_peak_ccu?: number | null
          probe_plays?: number | null
          probe_unique?: number | null
          report_id: string
          status?: string | null
          tags?: Json | null
          title?: string | null
          updated_at?: string | null
          week_d1_avg?: number | null
          week_d7_avg?: number | null
          week_favorites?: number | null
          week_minutes?: number | null
          week_minutes_per_player_avg?: number | null
          week_peak_ccu_max?: number | null
          week_plays?: number | null
          week_recommends?: number | null
          week_unique?: number | null
        }
        Update: {
          category?: string | null
          created_in?: string | null
          creator_code?: string | null
          id?: string
          island_code?: string
          probe_date?: string | null
          probe_minutes?: number | null
          probe_peak_ccu?: number | null
          probe_plays?: number | null
          probe_unique?: number | null
          report_id?: string
          status?: string | null
          tags?: Json | null
          title?: string | null
          updated_at?: string | null
          week_d1_avg?: number | null
          week_d7_avg?: number | null
          week_favorites?: number | null
          week_minutes?: number | null
          week_minutes_per_player_avg?: number | null
          week_peak_ccu_max?: number | null
          week_plays?: number | null
          week_recommends?: number | null
          week_unique?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "discover_report_islands_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "discover_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      discover_report_queue: {
        Row: {
          attempts: number | null
          created_at: string | null
          id: string
          island_code: string
          last_error: string | null
          locked_at: string | null
          report_id: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
          created_at?: string | null
          id?: string
          island_code: string
          last_error?: string | null
          locked_at?: string | null
          report_id: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
          created_at?: string | null
          id?: string
          island_code?: string
          last_error?: string | null
          locked_at?: string | null
          report_id?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discover_report_queue_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "discover_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      discover_reports: {
        Row: {
          ai_narratives: Json | null
          catalog_cursor: string | null
          catalog_discovered_count: number | null
          catalog_done: boolean | null
          computed_rankings: Json | null
          created_at: string
          error_count: number | null
          estimated_total: number | null
          id: string
          island_count: number | null
          metrics_done_count: number | null
          phase: string | null
          platform_kpis: Json | null
          progress_pct: number | null
          queue_total: number | null
          raw_metrics: Json | null
          reported_count: number | null
          started_at: string | null
          status: string
          suppressed_count: number | null
          updated_at: string
          week_end: string
          week_number: number
          week_start: string
          year: number
        }
        Insert: {
          ai_narratives?: Json | null
          catalog_cursor?: string | null
          catalog_discovered_count?: number | null
          catalog_done?: boolean | null
          computed_rankings?: Json | null
          created_at?: string
          error_count?: number | null
          estimated_total?: number | null
          id?: string
          island_count?: number | null
          metrics_done_count?: number | null
          phase?: string | null
          platform_kpis?: Json | null
          progress_pct?: number | null
          queue_total?: number | null
          raw_metrics?: Json | null
          reported_count?: number | null
          started_at?: string | null
          status?: string
          suppressed_count?: number | null
          updated_at?: string
          week_end: string
          week_number: number
          week_start: string
          year: number
        }
        Update: {
          ai_narratives?: Json | null
          catalog_cursor?: string | null
          catalog_discovered_count?: number | null
          catalog_done?: boolean | null
          computed_rankings?: Json | null
          created_at?: string
          error_count?: number | null
          estimated_total?: number | null
          id?: string
          island_count?: number | null
          metrics_done_count?: number | null
          phase?: string | null
          platform_kpis?: Json | null
          progress_pct?: number | null
          queue_total?: number | null
          raw_metrics?: Json | null
          reported_count?: number | null
          started_at?: string | null
          status?: string
          suppressed_count?: number | null
          updated_at?: string
          week_end?: string
          week_number?: number
          week_start?: string
          year?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          description: string | null
          id: string
          island_code: string | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          island_code?: string | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          island_code?: string | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          ai_summary: string | null
          created_at: string
          diagnostics: Json | null
          id: string
          metrics: Json | null
          parsed_data: Json | null
          project_id: string
          status: string
          updated_at: string
          upload_id: string
          user_id: string
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string
          diagnostics?: Json | null
          id?: string
          metrics?: Json | null
          parsed_data?: Json | null
          project_id: string
          status?: string
          updated_at?: string
          upload_id: string
          user_id: string
        }
        Update: {
          ai_summary?: string | null
          created_at?: string
          diagnostics?: Json | null
          id?: string
          metrics?: Json | null
          parsed_data?: Json | null
          project_id?: string
          status?: string
          updated_at?: string
          upload_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      uploads: {
        Row: {
          created_at: string
          csv_count: number | null
          file_name: string
          file_path: string | null
          id: string
          project_id: string
          status: string
          user_id: string
          warnings: Json | null
        }
        Insert: {
          created_at?: string
          csv_count?: number | null
          file_name: string
          file_path?: string | null
          id?: string
          project_id: string
          status?: string
          user_id: string
          warnings?: Json | null
        }
        Update: {
          created_at?: string
          csv_count?: number | null
          file_name?: string
          file_path?: string | null
          id?: string
          project_id?: string
          status?: string
          user_id?: string
          warnings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "uploads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
