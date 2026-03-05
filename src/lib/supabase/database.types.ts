/**
 * Database types for Pixeltrunk.
 * Manually maintained to match migrations 001–008.
 * Run `npm run db:gen-types` to auto-regenerate if Supabase CLI is configured.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      events: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          slug: string;
          description: string | null;
          event_date: string | null;
          event_type: string | null;
          cover_image_id: string | null;
          settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          slug: string;
          description?: string | null;
          event_date?: string | null;
          event_type?: string | null;
          cover_image_id?: string | null;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          slug?: string;
          description?: string | null;
          event_date?: string | null;
          event_type?: string | null;
          cover_image_id?: string | null;
          settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      images: {
        Row: {
          id: string;
          event_id: string;
          filename: string;
          original_filename: string;
          r2_key: string;
          file_size: number;
          width: number | null;
          height: number | null;
          mime_type: string;
          parsed_name: string | null;
          taken_at: string | null;
          camera_make: string | null;
          camera_model: string | null;
          lens: string | null;
          focal_length: number | null;
          aperture: number | null;
          shutter_speed: string | null;
          iso: number | null;
          gps_lat: number | null;
          gps_lng: number | null;
          clip_embedding: string | null;
          aesthetic_score: number | null;
          sharpness_score: number | null;
          is_eyes_open: boolean | null;
          scene_tags: string[] | null;
          stack_id: string | null;
          stack_rank: number | null;
          processing_status: string;
          thumbnail_generated: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          filename: string;
          original_filename: string;
          r2_key: string;
          file_size: number;
          width?: number | null;
          height?: number | null;
          mime_type: string;
          parsed_name?: string | null;
          taken_at?: string | null;
          camera_make?: string | null;
          camera_model?: string | null;
          lens?: string | null;
          focal_length?: number | null;
          aperture?: number | null;
          shutter_speed?: string | null;
          iso?: number | null;
          gps_lat?: number | null;
          gps_lng?: number | null;
          clip_embedding?: string | null;
          aesthetic_score?: number | null;
          sharpness_score?: number | null;
          is_eyes_open?: boolean | null;
          scene_tags?: string[] | null;
          stack_id?: string | null;
          stack_rank?: number | null;
          processing_status?: string;
          thumbnail_generated?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          filename?: string;
          original_filename?: string;
          r2_key?: string;
          file_size?: number;
          width?: number | null;
          height?: number | null;
          mime_type?: string;
          parsed_name?: string | null;
          taken_at?: string | null;
          camera_make?: string | null;
          camera_model?: string | null;
          lens?: string | null;
          focal_length?: number | null;
          aperture?: number | null;
          shutter_speed?: string | null;
          iso?: number | null;
          gps_lat?: number | null;
          gps_lng?: number | null;
          clip_embedding?: string | null;
          aesthetic_score?: number | null;
          sharpness_score?: number | null;
          is_eyes_open?: boolean | null;
          scene_tags?: string[] | null;
          stack_id?: string | null;
          stack_rank?: number | null;
          processing_status?: string;
          thumbnail_generated?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      faces: {
        Row: {
          id: string;
          image_id: string;
          bbox_x: number;
          bbox_y: number;
          bbox_w: number;
          bbox_h: number;
          embedding: string | null;
          person_id: string | null;
          confidence: number | null;
          is_eyes_open: boolean;
          quality: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          image_id: string;
          bbox_x: number;
          bbox_y: number;
          bbox_w: number;
          bbox_h: number;
          embedding?: string | null;
          person_id?: string | null;
          confidence?: number | null;
          is_eyes_open?: boolean;
          quality?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          image_id?: string;
          bbox_x?: number;
          bbox_y?: number;
          bbox_w?: number;
          bbox_h?: number;
          embedding?: string | null;
          person_id?: string | null;
          confidence?: number | null;
          is_eyes_open?: boolean;
          quality?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      persons: {
        Row: {
          id: string;
          event_id: string;
          name: string | null;
          representative_face_id: string | null;
          face_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          name?: string | null;
          representative_face_id?: string | null;
          face_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          name?: string | null;
          representative_face_id?: string | null;
          face_count?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      stacks: {
        Row: {
          id: string;
          event_id: string;
          stack_type: string;
          cover_image_id: string | null;
          image_count: number;
          person_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          stack_type?: string;
          cover_image_id?: string | null;
          image_count?: number;
          person_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          stack_type?: string;
          cover_image_id?: string | null;
          image_count?: number;
          person_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      sections: {
        Row: {
          id: string;
          event_id: string;
          name: string;
          description: string | null;
          sort_order: number;
          is_auto: boolean;
          filter_query: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          name: string;
          description?: string | null;
          sort_order?: number;
          is_auto?: boolean;
          filter_query?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          name?: string;
          description?: string | null;
          sort_order?: number;
          is_auto?: boolean;
          filter_query?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      section_images: {
        Row: {
          section_id: string;
          image_id: string;
          sort_order: number;
          relevance_score: number | null;
        };
        Insert: {
          section_id: string;
          image_id: string;
          sort_order?: number;
          relevance_score?: number | null;
        };
        Update: {
          section_id?: string;
          image_id?: string;
          sort_order?: number;
          relevance_score?: number | null;
        };
        Relationships: [];
      };
      shares: {
        Row: {
          id: string;
          event_id: string;
          slug: string;
          password_hash: string | null;
          pin: string | null;
          expires_at: string | null;
          is_active: boolean;
          share_type: string;
          section_id: string | null;
          person_id: string | null;
          image_ids: string[] | null;
          allow_download: boolean;
          allow_favorites: boolean;
          download_quality: string;
          custom_message: string | null;
          download_pin: string | null;
          require_pin_bulk: boolean;
          require_pin_individual: boolean;
          view_count: number;
          last_viewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_id: string;
          slug: string;
          password_hash?: string | null;
          pin?: string | null;
          expires_at?: string | null;
          is_active?: boolean;
          share_type?: string;
          section_id?: string | null;
          person_id?: string | null;
          image_ids?: string[] | null;
          allow_download?: boolean;
          allow_favorites?: boolean;
          download_quality?: string;
          custom_message?: string | null;
          download_pin?: string | null;
          require_pin_bulk?: boolean;
          require_pin_individual?: boolean;
          view_count?: number;
          last_viewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          event_id?: string;
          slug?: string;
          password_hash?: string | null;
          pin?: string | null;
          expires_at?: string | null;
          is_active?: boolean;
          share_type?: string;
          section_id?: string | null;
          person_id?: string | null;
          image_ids?: string[] | null;
          allow_download?: boolean;
          allow_favorites?: boolean;
          download_quality?: string;
          custom_message?: string | null;
          download_pin?: string | null;
          require_pin_bulk?: boolean;
          require_pin_individual?: boolean;
          view_count?: number;
          last_viewed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      favorites: {
        Row: {
          id: string;
          share_id: string;
          image_id: string;
          client_name: string | null;
          client_email: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          share_id: string;
          image_id: string;
          client_name?: string | null;
          client_email?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          share_id?: string;
          image_id?: string;
          client_name?: string | null;
          client_email?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      user_profiles: {
        Row: {
          user_id: string;
          display_name: string | null;
          business_name: string | null;
          bio: string | null;
          logo_url: string | null;
          website: string | null;
          phone: string | null;
          location: string | null;
          branding: Json;
          gallery_defaults: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          display_name?: string | null;
          business_name?: string | null;
          bio?: string | null;
          logo_url?: string | null;
          website?: string | null;
          phone?: string | null;
          location?: string | null;
          branding?: Json;
          gallery_defaults?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          display_name?: string | null;
          business_name?: string | null;
          bio?: string | null;
          logo_url?: string | null;
          website?: string | null;
          phone?: string | null;
          location?: string | null;
          branding?: Json;
          gallery_defaults?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_templates: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          subject: string;
          body_html: string;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          subject?: string;
          body_html?: string;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          subject?: string;
          body_html?: string;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      event_templates: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          event_type: string | null;
          settings: Json;
          sections: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          event_type?: string | null;
          settings?: Json;
          sections?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string | null;
          event_type?: string | null;
          settings?: Json;
          sections?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_sends: {
        Row: {
          id: string;
          user_id: string;
          event_id: string | null;
          template_id: string | null;
          recipients: Json;
          subject: string;
          body_html: string;
          status: string;
          sent_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          event_id?: string | null;
          template_id?: string | null;
          recipients: Json;
          subject: string;
          body_html?: string;
          status?: string;
          sent_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          event_id?: string | null;
          template_id?: string | null;
          recipients?: Json;
          subject?: string;
          body_html?: string;
          status?: string;
          sent_at?: string;
        };
        Relationships: [];
      };
      activity_log: {
        Row: {
          id: string;
          user_id: string;
          event_id: string | null;
          share_id: string | null;
          image_id: string | null;
          action: string;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          event_id?: string | null;
          share_id?: string | null;
          image_id?: string | null;
          action: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          event_id?: string | null;
          share_id?: string | null;
          image_id?: string | null;
          action?: string;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_activity_totals: {
        Args: { p_user_id: string };
        Returns: Json;
      };
      get_daily_activity: {
        Args: {
          p_user_id: string;
          p_days?: number;
        };
        Returns: {
          day: string;
          action: string;
          total: number;
        }[];
      };
      increment_share_views: {
        Args: { p_share_id: string };
        Returns: undefined;
      };
      search_images_by_embedding: {
        Args: {
          query_embedding: string;
          target_event_id?: string | null;
          match_threshold?: number;
          match_count?: number;
        };
        Returns: {
          id: string;
          event_id: string;
          filename: string;
          original_filename: string;
          r2_key: string;
          similarity: number;
        }[];
      };
      search_faces_by_embedding: {
        Args: {
          query_embedding: string;
          target_event_id?: string | null;
          match_threshold?: number;
          match_count?: number;
        };
        Returns: {
          face_id: string;
          image_id: string;
          person_id: string;
          similarity: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
