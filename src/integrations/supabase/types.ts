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
      discover_islands_cache: {
        Row: {
          category: string | null
          created_in: string | null
          creator_code: string | null
          first_seen_at: string | null
          image_url: string | null
          island_code: string
          last_metadata_fetch_at: string | null
          last_probe_plays: number | null
          last_probe_unique: number | null
          last_report_id: string | null
          last_reported_at: string | null
          last_seen_at: string | null
          last_status: string | null
          last_suppressed_at: string | null
          last_week_d1_avg: number | null
          last_week_d7_avg: number | null
          last_week_favorites: number | null
          last_week_minutes: number | null
          last_week_minutes_per_player_avg: number | null
          last_week_peak_ccu: number | null
          last_week_plays: number | null
          last_week_recommends: number | null
          last_week_unique: number | null
          link_state: string | null
          max_players: number | null
          min_players: number | null
          moderation_status: string | null
          published_at_epic: string | null
          reported_streak: number | null
          suppressed_streak: number | null
          tags: Json | null
          title: string | null
          updated_at: string | null
          updated_at_epic: string | null
        }
        Insert: {
          category?: string | null
          created_in?: string | null
          creator_code?: string | null
          first_seen_at?: string | null
          image_url?: string | null
          island_code: string
          last_metadata_fetch_at?: string | null
          last_probe_plays?: number | null
          last_probe_unique?: number | null
          last_report_id?: string | null
          last_reported_at?: string | null
          last_seen_at?: string | null
          last_status?: string | null
          last_suppressed_at?: string | null
          last_week_d1_avg?: number | null
          last_week_d7_avg?: number | null
          last_week_favorites?: number | null
          last_week_minutes?: number | null
          last_week_minutes_per_player_avg?: number | null
          last_week_peak_ccu?: number | null
          last_week_plays?: number | null
          last_week_recommends?: number | null
          last_week_unique?: number | null
          link_state?: string | null
          max_players?: number | null
          min_players?: number | null
          moderation_status?: string | null
          published_at_epic?: string | null
          reported_streak?: number | null
          suppressed_streak?: number | null
          tags?: Json | null
          title?: string | null
          updated_at?: string | null
          updated_at_epic?: string | null
        }
        Update: {
          category?: string | null
          created_in?: string | null
          creator_code?: string | null
          first_seen_at?: string | null
          image_url?: string | null
          island_code?: string
          last_metadata_fetch_at?: string | null
          last_probe_plays?: number | null
          last_probe_unique?: number | null
          last_report_id?: string | null
          last_reported_at?: string | null
          last_seen_at?: string | null
          last_status?: string | null
          last_suppressed_at?: string | null
          last_week_d1_avg?: number | null
          last_week_d7_avg?: number | null
          last_week_favorites?: number | null
          last_week_minutes?: number | null
          last_week_minutes_per_player_avg?: number | null
          last_week_peak_ccu?: number | null
          last_week_plays?: number | null
          last_week_recommends?: number | null
          last_week_unique?: number | null
          link_state?: string | null
          max_players?: number | null
          min_players?: number | null
          moderation_status?: string | null
          published_at_epic?: string | null
          reported_streak?: number | null
          suppressed_streak?: number | null
          tags?: Json | null
          title?: string | null
          updated_at?: string | null
          updated_at_epic?: string | null
        }
        Relationships: []
      }
      discover_link_edges: {
        Row: {
          child_link_code: string
          edge_type: string
          first_seen_at: string
          last_seen_at: string
          parent_link_code: string
          sort_order: number | null
        }
        Insert: {
          child_link_code: string
          edge_type?: string
          first_seen_at?: string
          last_seen_at?: string
          parent_link_code: string
          sort_order?: number | null
        }
        Update: {
          child_link_code?: string
          edge_type?: string
          first_seen_at?: string
          last_seen_at?: string
          parent_link_code?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      discover_link_metadata: {
        Row: {
          account_id: string | null
          active: boolean | null
          created_at_epic: string | null
          creator_name: string | null
          disabled: boolean | null
          discovery_intent: string | null
          extra_image_urls: Json | null
          image_url: string | null
          image_urls: Json | null
          introduction: string | null
          last_activated_at_epic: string | null
          last_error: string | null
          last_fetched_at: string | null
          link_code: string
          link_code_type: string
          link_state: string | null
          link_type: string | null
          locale: string | null
          lock_id: string | null
          locked_at: string | null
          max_players: number | null
          max_social_party_size: number | null
          min_players: number | null
          moderation_status: string | null
          namespace: string | null
          next_due_at: string
          published_at_epic: string | null
          ratings: Json | null
          raw: Json | null
          support_code: string | null
          tagline: string | null
          title: string | null
          updated_at: string
          updated_at_epic: string | null
          version: number | null
          video_vuid: string | null
        }
        Insert: {
          account_id?: string | null
          active?: boolean | null
          created_at_epic?: string | null
          creator_name?: string | null
          disabled?: boolean | null
          discovery_intent?: string | null
          extra_image_urls?: Json | null
          image_url?: string | null
          image_urls?: Json | null
          introduction?: string | null
          last_activated_at_epic?: string | null
          last_error?: string | null
          last_fetched_at?: string | null
          link_code: string
          link_code_type?: string
          link_state?: string | null
          link_type?: string | null
          locale?: string | null
          lock_id?: string | null
          locked_at?: string | null
          max_players?: number | null
          max_social_party_size?: number | null
          min_players?: number | null
          moderation_status?: string | null
          namespace?: string | null
          next_due_at?: string
          published_at_epic?: string | null
          ratings?: Json | null
          raw?: Json | null
          support_code?: string | null
          tagline?: string | null
          title?: string | null
          updated_at?: string
          updated_at_epic?: string | null
          version?: number | null
          video_vuid?: string | null
        }
        Update: {
          account_id?: string | null
          active?: boolean | null
          created_at_epic?: string | null
          creator_name?: string | null
          disabled?: boolean | null
          discovery_intent?: string | null
          extra_image_urls?: Json | null
          image_url?: string | null
          image_urls?: Json | null
          introduction?: string | null
          last_activated_at_epic?: string | null
          last_error?: string | null
          last_fetched_at?: string | null
          link_code?: string
          link_code_type?: string
          link_state?: string | null
          link_type?: string | null
          locale?: string | null
          lock_id?: string | null
          locked_at?: string | null
          max_players?: number | null
          max_social_party_size?: number | null
          min_players?: number | null
          moderation_status?: string | null
          namespace?: string | null
          next_due_at?: string
          published_at_epic?: string | null
          ratings?: Json | null
          raw?: Json | null
          support_code?: string | null
          tagline?: string | null
          title?: string | null
          updated_at?: string
          updated_at_epic?: string | null
          version?: number | null
          video_vuid?: string | null
        }
        Relationships: []
      }
      discover_link_metadata_events: {
        Row: {
          created_at: string
          event_type: string
          id: number
          link_code: string
          new_value: Json | null
          old_value: Json | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: never
          link_code: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: never
          link_code?: string
          new_value?: Json | null
          old_value?: Json | null
        }
        Relationships: []
      }
      discover_lookup_pipeline_runs: {
        Row: {
          category_leaders_count: number | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          error_type: string | null
          has_discovery_signals: boolean | null
          has_internal_card: boolean | null
          has_weekly_performance: boolean | null
          id: number
          island_code: string
          status: string
          user_id: string | null
        }
        Insert: {
          category_leaders_count?: number | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          error_type?: string | null
          has_discovery_signals?: boolean | null
          has_internal_card?: boolean | null
          has_weekly_performance?: boolean | null
          id?: never
          island_code?: string
          status?: string
          user_id?: string | null
        }
        Update: {
          category_leaders_count?: number | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          error_type?: string | null
          has_discovery_signals?: boolean | null
          has_internal_card?: boolean | null
          has_weekly_performance?: boolean | null
          id?: never
          island_code?: string
          status?: string
          user_id?: string | null
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
          priority: number | null
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
          priority?: number | null
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
          priority?: number | null
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
      discover_report_rebuild_runs: {
        Row: {
          id: number
          ok: boolean
          report_id: string | null
          summary_json: Json
          ts_end: string | null
          ts_start: string
          user_id: string | null
          weekly_report_id: string
        }
        Insert: {
          id?: number
          ok?: boolean
          report_id?: string | null
          summary_json?: Json
          ts_end?: string | null
          ts_start?: string
          user_id?: string | null
          weekly_report_id: string
        }
        Update: {
          id?: number
          ok?: boolean
          report_id?: string | null
          summary_json?: Json
          ts_end?: string | null
          ts_start?: string
          user_id?: string | null
          weekly_report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discover_report_rebuild_runs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "discover_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discover_report_rebuild_runs_weekly_report_id_fkey"
            columns: ["weekly_report_id"]
            isOneToOne: false
            referencedRelation: "weekly_reports"
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
          done_count: number | null
          error_count: number | null
          estimated_total: number | null
          id: string
          island_count: number | null
          last_metrics_tick_at: string | null
          metrics_done_count: number | null
          pending_count: number | null
          phase: string | null
          platform_kpis: Json | null
          processing_count: number | null
          progress_pct: number | null
          queue_total: number | null
          rate_limited_count: number | null
          raw_metrics: Json | null
          reported_count: number | null
          stale_requeued_count: number | null
          started_at: string | null
          status: string
          suppressed_count: number | null
          throughput_per_min: number | null
          updated_at: string
          week_end: string
          week_number: number
          week_start: string
          workers_active: number | null
          year: number
        }
        Insert: {
          ai_narratives?: Json | null
          catalog_cursor?: string | null
          catalog_discovered_count?: number | null
          catalog_done?: boolean | null
          computed_rankings?: Json | null
          created_at?: string
          done_count?: number | null
          error_count?: number | null
          estimated_total?: number | null
          id?: string
          island_count?: number | null
          last_metrics_tick_at?: string | null
          metrics_done_count?: number | null
          pending_count?: number | null
          phase?: string | null
          platform_kpis?: Json | null
          processing_count?: number | null
          progress_pct?: number | null
          queue_total?: number | null
          rate_limited_count?: number | null
          raw_metrics?: Json | null
          reported_count?: number | null
          stale_requeued_count?: number | null
          started_at?: string | null
          status?: string
          suppressed_count?: number | null
          throughput_per_min?: number | null
          updated_at?: string
          week_end: string
          week_number: number
          week_start: string
          workers_active?: number | null
          year: number
        }
        Update: {
          ai_narratives?: Json | null
          catalog_cursor?: string | null
          catalog_discovered_count?: number | null
          catalog_done?: boolean | null
          computed_rankings?: Json | null
          created_at?: string
          done_count?: number | null
          error_count?: number | null
          estimated_total?: number | null
          id?: string
          island_count?: number | null
          last_metrics_tick_at?: string | null
          metrics_done_count?: number | null
          pending_count?: number | null
          phase?: string | null
          platform_kpis?: Json | null
          processing_count?: number | null
          progress_pct?: number | null
          queue_total?: number | null
          rate_limited_count?: number | null
          raw_metrics?: Json | null
          reported_count?: number | null
          stale_requeued_count?: number | null
          started_at?: string | null
          status?: string
          suppressed_count?: number | null
          throughput_per_min?: number | null
          updated_at?: string
          week_end?: string
          week_number?: number
          week_start?: string
          workers_active?: number | null
          year?: number
        }
        Relationships: []
      }
      discovery_exposure_entries_raw: {
        Row: {
          feature_tags: string[] | null
          global_ccu: number | null
          id: number
          is_visible: boolean | null
          link_code: string
          link_code_type: string
          lock_status: string | null
          lock_status_reason: string | null
          page_index: number
          panel_display_name: string | null
          panel_name: string
          panel_type: string | null
          rank: number
          surface_name: string
          target_id: string
          tick_id: string
          ts: string
        }
        Insert: {
          feature_tags?: string[] | null
          global_ccu?: number | null
          id?: number
          is_visible?: boolean | null
          link_code: string
          link_code_type: string
          lock_status?: string | null
          lock_status_reason?: string | null
          page_index?: number
          panel_display_name?: string | null
          panel_name: string
          panel_type?: string | null
          rank: number
          surface_name: string
          target_id: string
          tick_id: string
          ts?: string
        }
        Update: {
          feature_tags?: string[] | null
          global_ccu?: number | null
          id?: number
          is_visible?: boolean | null
          link_code?: string
          link_code_type?: string
          lock_status?: string | null
          lock_status_reason?: string | null
          page_index?: number
          panel_display_name?: string | null
          panel_name?: string
          panel_type?: string | null
          rank?: number
          surface_name?: string
          target_id?: string
          tick_id?: string
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_exposure_entries_raw_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "discovery_exposure_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_exposure_entries_raw_tick_id_fkey"
            columns: ["tick_id"]
            isOneToOne: false
            referencedRelation: "discovery_exposure_ticks"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_exposure_link_state: {
        Row: {
          first_seen_at: string
          last_seen_at: string
          link_code: string
          link_code_type: string
          target_id: string
        }
        Insert: {
          first_seen_at: string
          last_seen_at: string
          link_code: string
          link_code_type: string
          target_id: string
        }
        Update: {
          first_seen_at?: string
          last_seen_at?: string
          link_code?: string
          link_code_type?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_exposure_link_state_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "discovery_exposure_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_exposure_presence_events: {
        Row: {
          closed_reason: string | null
          event_type: string
          feature_tags: string[] | null
          global_ccu: number | null
          id: number
          link_code: string
          link_code_type: string
          panel_display_name: string | null
          panel_name: string
          panel_type: string | null
          rank: number | null
          surface_name: string
          target_id: string
          tick_id: string
          ts: string
        }
        Insert: {
          closed_reason?: string | null
          event_type: string
          feature_tags?: string[] | null
          global_ccu?: number | null
          id?: number
          link_code: string
          link_code_type: string
          panel_display_name?: string | null
          panel_name: string
          panel_type?: string | null
          rank?: number | null
          surface_name: string
          target_id: string
          tick_id: string
          ts: string
        }
        Update: {
          closed_reason?: string | null
          event_type?: string
          feature_tags?: string[] | null
          global_ccu?: number | null
          id?: number
          link_code?: string
          link_code_type?: string
          panel_display_name?: string | null
          panel_name?: string
          panel_type?: string | null
          rank?: number | null
          surface_name?: string
          target_id?: string
          tick_id?: string
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_exposure_presence_events_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "discovery_exposure_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_exposure_presence_events_tick_id_fkey"
            columns: ["tick_id"]
            isOneToOne: false
            referencedRelation: "discovery_exposure_ticks"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_exposure_presence_segments: {
        Row: {
          best_rank: number | null
          ccu_end: number | null
          ccu_max: number | null
          ccu_start: number | null
          closed_reason: string | null
          created_at: string
          end_rank: number | null
          end_ts: string | null
          feature_tags: string[] | null
          id: string
          last_seen_ts: string
          link_code: string
          link_code_type: string
          panel_display_name: string | null
          panel_name: string
          panel_type: string | null
          rank_samples: number
          rank_sum: number
          start_ts: string
          surface_name: string
          target_id: string
          updated_at: string
        }
        Insert: {
          best_rank?: number | null
          ccu_end?: number | null
          ccu_max?: number | null
          ccu_start?: number | null
          closed_reason?: string | null
          created_at?: string
          end_rank?: number | null
          end_ts?: string | null
          feature_tags?: string[] | null
          id?: string
          last_seen_ts: string
          link_code: string
          link_code_type: string
          panel_display_name?: string | null
          panel_name: string
          panel_type?: string | null
          rank_samples?: number
          rank_sum?: number
          start_ts: string
          surface_name: string
          target_id: string
          updated_at?: string
        }
        Update: {
          best_rank?: number | null
          ccu_end?: number | null
          ccu_max?: number | null
          ccu_start?: number | null
          closed_reason?: string | null
          created_at?: string
          end_rank?: number | null
          end_ts?: string | null
          feature_tags?: string[] | null
          id?: string
          last_seen_ts?: string
          link_code?: string
          link_code_type?: string
          panel_display_name?: string | null
          panel_name?: string
          panel_type?: string | null
          rank_samples?: number
          rank_sum?: number
          start_ts?: string
          surface_name?: string
          target_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_exposure_presence_segments_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "discovery_exposure_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_exposure_rank_segments: {
        Row: {
          ccu_end: number | null
          ccu_max: number | null
          ccu_start: number | null
          closed_reason: string | null
          created_at: string
          end_ts: string | null
          feature_tags: string[] | null
          id: string
          last_seen_ts: string
          link_code: string
          link_code_type: string
          panel_display_name: string | null
          panel_name: string
          panel_type: string | null
          rank: number
          start_ts: string
          surface_name: string
          target_id: string
          updated_at: string
        }
        Insert: {
          ccu_end?: number | null
          ccu_max?: number | null
          ccu_start?: number | null
          closed_reason?: string | null
          created_at?: string
          end_ts?: string | null
          feature_tags?: string[] | null
          id?: string
          last_seen_ts: string
          link_code: string
          link_code_type: string
          panel_display_name?: string | null
          panel_name: string
          panel_type?: string | null
          rank: number
          start_ts: string
          surface_name: string
          target_id: string
          updated_at?: string
        }
        Update: {
          ccu_end?: number | null
          ccu_max?: number | null
          ccu_start?: number | null
          closed_reason?: string | null
          created_at?: string
          end_ts?: string | null
          feature_tags?: string[] | null
          id?: string
          last_seen_ts?: string
          link_code?: string
          link_code_type?: string
          panel_display_name?: string | null
          panel_name?: string
          panel_type?: string | null
          rank?: number
          start_ts?: string
          surface_name?: string
          target_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_exposure_rank_segments_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "discovery_exposure_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_exposure_rollup_daily: {
        Row: {
          appearances: number
          avg_rank: number | null
          best_rank: number | null
          ccu_max_seen: number | null
          date: string
          distinct_creators: number | null
          link_code: string
          link_code_type: string
          minutes_exposed: number
          panel_name: string
          surface_name: string
          target_id: string
        }
        Insert: {
          appearances?: number
          avg_rank?: number | null
          best_rank?: number | null
          ccu_max_seen?: number | null
          date: string
          distinct_creators?: number | null
          link_code: string
          link_code_type: string
          minutes_exposed?: number
          panel_name: string
          surface_name: string
          target_id: string
        }
        Update: {
          appearances?: number
          avg_rank?: number | null
          best_rank?: number | null
          ccu_max_seen?: number | null
          date?: string
          distinct_creators?: number | null
          link_code?: string
          link_code_type?: string
          minutes_exposed?: number
          panel_name?: string
          surface_name?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_exposure_rollup_daily_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "discovery_exposure_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_exposure_targets: {
        Row: {
          created_at: string
          id: string
          interval_minutes: number
          last_error: string | null
          last_failed_tick_at: string | null
          last_ok_tick_at: string | null
          last_status: string
          locale: string
          lock_id: string | null
          locked_at: string | null
          next_due_at: string
          platform: string
          region: string
          surface_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          interval_minutes?: number
          last_error?: string | null
          last_failed_tick_at?: string | null
          last_ok_tick_at?: string | null
          last_status?: string
          locale?: string
          lock_id?: string | null
          locked_at?: string | null
          next_due_at?: string
          platform?: string
          region: string
          surface_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          interval_minutes?: number
          last_error?: string | null
          last_failed_tick_at?: string | null
          last_ok_tick_at?: string | null
          last_status?: string
          locale?: string
          lock_id?: string | null
          locked_at?: string | null
          next_due_at?: string
          platform?: string
          region?: string
          surface_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      discovery_exposure_ticks: {
        Row: {
          branch: string | null
          correlation_id: string | null
          created_at: string
          duration_ms: number | null
          entries_count: number
          error_code: string | null
          error_message: string | null
          id: string
          panels_count: number
          status: string
          target_id: string
          test_analytics_id: string | null
          test_name: string | null
          test_variant_name: string | null
          ts_end: string | null
          ts_start: string
        }
        Insert: {
          branch?: string | null
          correlation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          entries_count?: number
          error_code?: string | null
          error_message?: string | null
          id?: string
          panels_count?: number
          status?: string
          target_id: string
          test_analytics_id?: string | null
          test_name?: string | null
          test_variant_name?: string | null
          ts_end?: string | null
          ts_start?: string
        }
        Update: {
          branch?: string | null
          correlation_id?: string | null
          created_at?: string
          duration_ms?: number | null
          entries_count?: number
          error_code?: string | null
          error_message?: string | null
          id?: string
          panels_count?: number
          status?: string
          target_id?: string
          test_analytics_id?: string | null
          test_name?: string | null
          test_variant_name?: string | null
          ts_end?: string | null
          ts_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_exposure_ticks_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "discovery_exposure_targets"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_panel_tiers: {
        Row: {
          label: string | null
          panel_name: string
          tier: number
          updated_at: string
        }
        Insert: {
          label?: string | null
          panel_name: string
          tier: number
          updated_at?: string
        }
        Update: {
          label?: string | null
          panel_name?: string
          tier?: number
          updated_at?: string
        }
        Relationships: []
      }
      discovery_public_emerging_now: {
        Row: {
          as_of: string
          best_rank_24h: number | null
          creator_code: string | null
          first_seen_at: string
          image_url: string | null
          link_code: string
          link_code_type: string
          minutes_24h: number
          minutes_6h: number
          panels_24h: number
          premium_panels_24h: number
          reentries_24h: number
          region: string
          score: number
          surface_name: string
          title: string | null
        }
        Insert: {
          as_of: string
          best_rank_24h?: number | null
          creator_code?: string | null
          first_seen_at: string
          image_url?: string | null
          link_code: string
          link_code_type: string
          minutes_24h: number
          minutes_6h: number
          panels_24h: number
          premium_panels_24h: number
          reentries_24h: number
          region: string
          score: number
          surface_name: string
          title?: string | null
        }
        Update: {
          as_of?: string
          best_rank_24h?: number | null
          creator_code?: string | null
          first_seen_at?: string
          image_url?: string | null
          link_code?: string
          link_code_type?: string
          minutes_24h?: number
          minutes_6h?: number
          panels_24h?: number
          premium_panels_24h?: number
          reentries_24h?: number
          region?: string
          score?: number
          surface_name?: string
          title?: string | null
        }
        Relationships: []
      }
      discovery_public_pollution_creators_now: {
        Row: {
          as_of: string
          creator_code: string
          duplicate_clusters_7d: number
          duplicate_islands_7d: number
          duplicates_over_min: number
          sample_titles: string[] | null
          spam_score: number
        }
        Insert: {
          as_of: string
          creator_code: string
          duplicate_clusters_7d: number
          duplicate_islands_7d: number
          duplicates_over_min: number
          sample_titles?: string[] | null
          spam_score: number
        }
        Update: {
          as_of?: string
          creator_code?: string
          duplicate_clusters_7d?: number
          duplicate_islands_7d?: number
          duplicates_over_min?: number
          sample_titles?: string[] | null
          spam_score?: number
        }
        Relationships: []
      }
      discovery_public_premium_now: {
        Row: {
          as_of: string
          ccu: number | null
          creator_code: string | null
          image_url: string | null
          link_code: string
          link_code_type: string
          panel_display_name: string | null
          panel_name: string
          panel_type: string | null
          rank: number
          region: string
          surface_name: string
          title: string | null
        }
        Insert: {
          as_of: string
          ccu?: number | null
          creator_code?: string | null
          image_url?: string | null
          link_code: string
          link_code_type: string
          panel_display_name?: string | null
          panel_name: string
          panel_type?: string | null
          rank: number
          region: string
          surface_name: string
          title?: string | null
        }
        Update: {
          as_of?: string
          ccu?: number | null
          creator_code?: string | null
          image_url?: string | null
          link_code?: string
          link_code_type?: string
          panel_display_name?: string | null
          panel_name?: string
          panel_type?: string | null
          rank?: number
          region?: string
          surface_name?: string
          title?: string | null
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
      system_alerts_current: {
        Row: {
          alert_key: string
          details: Json
          message: string
          severity: string
          updated_at: string
        }
        Insert: {
          alert_key: string
          details?: Json
          message: string
          severity: string
          updated_at?: string
        }
        Update: {
          alert_key?: string
          details?: Json
          message?: string
          severity?: string
          updated_at?: string
        }
        Relationships: []
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
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weekly_reports: {
        Row: {
          ai_sections_json: Json | null
          cover_image_url: string | null
          created_at: string | null
          date_from: string
          date_to: string
          discover_report_id: string | null
          editor_note: string | null
          editor_sections_json: Json | null
          id: string
          kpis_json: Json | null
          last_rebuilt_at: string | null
          public_slug: string | null
          published_at: string | null
          rankings_json: Json | null
          rebuild_count: number
          sections_json: Json | null
          status: string
          subtitle_public: string | null
          title_public: string | null
          updated_at: string | null
          week_key: string
        }
        Insert: {
          ai_sections_json?: Json | null
          cover_image_url?: string | null
          created_at?: string | null
          date_from: string
          date_to: string
          discover_report_id?: string | null
          editor_note?: string | null
          editor_sections_json?: Json | null
          id?: string
          kpis_json?: Json | null
          last_rebuilt_at?: string | null
          public_slug?: string | null
          published_at?: string | null
          rankings_json?: Json | null
          rebuild_count?: number
          sections_json?: Json | null
          status?: string
          subtitle_public?: string | null
          title_public?: string | null
          updated_at?: string | null
          week_key: string
        }
        Update: {
          ai_sections_json?: Json | null
          cover_image_url?: string | null
          created_at?: string | null
          date_from?: string
          date_to?: string
          discover_report_id?: string | null
          editor_note?: string | null
          editor_sections_json?: Json | null
          id?: string
          kpis_json?: Json | null
          last_rebuilt_at?: string | null
          public_slug?: string | null
          published_at?: string | null
          rankings_json?: Json | null
          rebuild_count?: number
          sections_json?: Json | null
          status?: string
          subtitle_public?: string | null
          title_public?: string | null
          updated_at?: string | null
          week_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_reports_discover_report_id_fkey"
            columns: ["discover_report_id"]
            isOneToOne: false
            referencedRelation: "discover_reports"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_discover_queue_results: {
        Args: { p_report_id: string; p_results: Json }
        Returns: number
      }
      apply_discovery_exposure_tick: {
        Args: {
          p_branch: string
          p_correlation_id?: string
          p_duration_ms: number
          p_rows: Json
          p_target_id: string
          p_test_analytics_id: string
          p_test_name: string
          p_test_variant_name: string
          p_tick_id: string
          p_tick_ts: string
        }
        Returns: Json
      }
      claim_discover_link_metadata: {
        Args: { p_stale_after_seconds?: number; p_take?: number }
        Returns: {
          link_code: string
          lock_id: string
        }[]
      }
      claim_discover_report_queue: {
        Args: {
          p_report_id: string
          p_stale_after_seconds?: number
          p_take?: number
        }
        Returns: {
          id: string
          island_code: string
          priority: number
        }[]
      }
      claim_discovery_exposure_target:
        | {
            Args: { p_stale_after_seconds?: number }
            Returns: {
              id: string
              interval_minutes: number
              locale: string
              lock_id: string
              platform: string
              region: string
              surface_name: string
            }[]
          }
        | {
            Args: { p_stale_after_seconds?: number; p_take?: number }
            Returns: {
              id: string
              interval_minutes: number
              locale: string
              lock_id: string
              platform: string
              region: string
              surface_name: string
            }[]
          }
      cleanup_discover_link_edges: {
        Args: { p_days?: number; p_delete_batch?: number }
        Returns: Json
      }
      cleanup_discover_link_metadata_events: {
        Args: { p_days?: number; p_delete_batch?: number }
        Returns: Json
      }
      cleanup_discover_lookup_pipeline_runs: {
        Args: { p_days?: number; p_delete_batch?: number }
        Returns: Json
      }
      compute_discovery_exposure_rollup_daily: {
        Args: { p_date: string }
        Returns: number
      }
      compute_discovery_public_intel: {
        Args: { p_as_of?: string }
        Returns: Json
      }
      compute_system_alerts: { Args: never; Returns: Json }
      discovery_exposure_breadth_top: {
        Args: { p_date_from: string; p_date_to: string; p_limit?: number }
        Returns: {
          link_code: string
          link_code_type: string
          panels_distinct: number
        }[]
      }
      discovery_exposure_panel_daily_summaries: {
        Args: { p_date_from: string; p_date_to: string }
        Returns: {
          collections: number
          creators: number
          date: string
          maps: number
          panel_name: string
          surface_name: string
          target_id: string
        }[]
      }
      discovery_exposure_run_maintenance:
        | {
            Args: {
              p_delete_batch?: number
              p_do_rollup?: boolean
              p_raw_hours?: number
              p_segment_days?: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_delete_batch?: number
              p_raw_hours?: number
              p_segment_days?: number
            }
            Returns: Json
          }
      discovery_exposure_top_by_panel: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_limit_per_panel?: number
        }
        Returns: {
          avg_rank: number
          best_rank: number
          ccu_max_seen: number
          link_code: string
          link_code_type: string
          minutes_exposed: number
          panel_name: string
          surface_name: string
          target_id: string
        }[]
      }
      discovery_exposure_top_panels: {
        Args: { p_date_from: string; p_date_to: string; p_limit?: number }
        Returns: {
          minutes_exposed: number
          panel_name: string
          surface_name: string
          target_id: string
        }[]
      }
      enqueue_discover_link_metadata: {
        Args: { p_due_within_minutes?: number; p_link_codes: string[] }
        Returns: Json
      }
      get_census_stats: { Args: never; Returns: Json }
      get_island_card: {
        Args: { p_island_code: string; p_window_hours?: number }
        Returns: Json
      }
      get_link_card: { Args: { p_link_code: string }; Returns: Json }
      get_link_graph_stats: { Args: never; Returns: Json }
      get_lookup_pipeline_error_breakdown: {
        Args: { p_hours?: number; p_limit?: number }
        Returns: Json
      }
      get_lookup_pipeline_stats: { Args: never; Returns: Json }
      get_metadata_pipeline_stats: { Args: never; Returns: Json }
      get_panel_display_name: {
        Args: { p_panel_name: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      normalize_island_title_for_dup: {
        Args: { p_title: string }
        Returns: string
      }
      repair_discover_report_state: {
        Args: { p_report_id: string; p_stale_after_seconds?: number }
        Returns: Json
      }
      report_dead_islands_by_unique_drop: {
        Args: {
          p_limit?: number
          p_prev_report_id: string
          p_report_id: string
        }
        Returns: {
          creator_code: string
          curr_unique: number
          drop_pct: number
          island_code: string
          prev_unique: number
          title: string
        }[]
      }
      report_exposure_coverage: {
        Args: { p_weekly_report_id: string }
        Returns: Json
      }
      report_finalize_categories: {
        Args: { p_limit?: number; p_report_id: string }
        Returns: Json
      }
      report_finalize_creators: {
        Args: { p_limit?: number; p_report_id: string }
        Returns: Json
      }
      report_finalize_distributions: {
        Args: { p_report_id: string }
        Returns: Json
      }
      report_finalize_exposure_analysis: {
        Args: { p_days?: number; p_report_id: string }
        Returns: Json
      }
      report_finalize_exposure_efficiency: {
        Args: { p_limit?: number; p_report_id: string }
        Returns: Json
      }
      report_finalize_kpis: {
        Args: { p_prev_report_id?: string; p_report_id: string }
        Returns: Json
      }
      report_finalize_rankings: {
        Args: { p_limit?: number; p_report_id: string }
        Returns: Json
      }
      report_finalize_rookies: {
        Args: { p_limit?: number; p_report_id: string }
        Returns: Json
      }
      report_finalize_tool_split: {
        Args: { p_report_id: string }
        Returns: Json
      }
      report_finalize_trending: {
        Args: { p_limit?: number; p_min_islands?: number; p_report_id: string }
        Returns: Json
      }
      report_finalize_wow_movers: {
        Args: {
          p_limit?: number
          p_prev_report_id: string
          p_report_id: string
        }
        Returns: Json
      }
      report_link_metadata_coverage: {
        Args: { p_report_id: string }
        Returns: Json
      }
      report_low_perf_histogram: {
        Args: { p_report_id: string }
        Returns: Json
      }
      report_most_updated_islands: {
        Args: {
          p_limit?: number
          p_report_id: string
          p_week_end: string
          p_week_start: string
        }
        Returns: {
          category: string
          creator_code: string
          island_code: string
          title: string
          updated_at_epic: string
          version: number
          week_plays: number
          week_unique: number
        }[]
      }
      report_new_islands_by_launch: {
        Args: {
          p_limit?: number
          p_report_id: string
          p_week_end: string
          p_week_start: string
        }
        Returns: {
          category: string
          creator_code: string
          island_code: string
          published_at: string
          title: string
          week_plays: number
          week_unique: number
        }[]
      }
      report_new_islands_by_launch_count: {
        Args: { p_report_id: string; p_week_end: string; p_week_start: string }
        Returns: number
      }
      requeue_stale_discover_queue: {
        Args: {
          p_max_rows?: number
          p_report_id: string
          p_stale_after_seconds?: number
        }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin" | "editor" | "client"
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
      app_role: ["admin", "editor", "client"],
    },
  },
} as const
